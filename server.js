const express = require('express');
const http = require('http');
const path = require('path');
const fs = require('fs');
const multer = require('multer');
const { Server } = require('socket.io');

const app = express();
const server = http.createServer(app);
const io = new Server(server);

const UPLOAD_DIR = path.join(__dirname, 'uploads');
if (!fs.existsSync(UPLOAD_DIR)) fs.mkdirSync(UPLOAD_DIR);

// Multer setup
const storage = multer.diskStorage({
  destination: (req, file, cb) => cb(null, UPLOAD_DIR),
  filename: (req, file, cb) => cb(null, Date.now() + '-' + file.originalname.replace(/[^a-zA-Z0-9._-]/g, '_'))
});
const upload = multer({ storage });

app.use(express.static(path.join(__dirname, 'public')));

// List videos
app.get('/videos', (req, res) => {
  fs.readdir(UPLOAD_DIR, (err, files) => {
    if (err) return res.status(500).json({ error: 'unable to read uploads' });
    const vids = files.filter(f => !f.startsWith('.'))
      .map(f => ({ name: f, url: `/video/${encodeURIComponent(f)}` }));
    vids.sort((a, b) => a.name.localeCompare(b.name));
    res.json(vids);
  });
});

// Upload endpoint (single file)
app.post('/upload', upload.single('video'), (req, res) => {
  if (!req.file) return res.status(400).send('No file uploaded');
  emitPlaylist();
  res.json({ ok: true, file: req.file.filename });
});

// Stream video with Range support
app.get('/video/:name', (req, res) => {
  const name = req.params.name;
  const filePath = path.join(UPLOAD_DIR, name);
  if (!fs.existsSync(filePath)) return res.status(404).send('Not found');

  const stat = fs.statSync(filePath);
  const fileSize = stat.size;
  const range = req.headers.range;
  if (range) {
    const parts = range.replace(/bytes=/, '').split('-');
    const start = parseInt(parts[0], 10);
    const end = parts[1] ? parseInt(parts[1], 10) : fileSize - 1;
    const chunkSize = (end - start) + 1;
    const file = fs.createReadStream(filePath, { start, end });
    res.writeHead(206, {
      'Content-Range': `bytes ${start}-${end}/${fileSize}`,
      'Accept-Ranges': 'bytes',
      'Content-Length': chunkSize,
      'Content-Type': 'video/mp4'
    });
    file.pipe(res);
  } else {
    res.writeHead(200, {
      'Content-Length': fileSize,
      'Content-Type': 'video/mp4'
    });
    fs.createReadStream(filePath).pipe(res);
  }
});

// In-memory state for sync
let playlist = [];
let state = {
  index: 0,
  playing: false,
  time: 0,
  lastUpdate: Date.now(),
  sourceType: 'file',
  currentUrl: null
};

function loadPlaylist() {
  try {
    const files = fs.readdirSync(UPLOAD_DIR).filter(f => !f.startsWith('.'));
    files.sort();
    playlist = files;
  } catch (e) {
    playlist = [];
  }
}

function emitPlaylist() {
  loadPlaylist();
  io.emit('playlist', playlist.map(f => ({ name: f, url: `/video/${encodeURIComponent(f)}`})));
}

loadPlaylist();

io.on('connection', (socket) => {
  socket.emit('playlist', playlist.map(f => ({ name: f, url: `/video/${encodeURIComponent(f)}`})));

  const now = Date.now();
  const currentState = { ...state };
  if (state.playing) {
    const elapsed = (now - state.lastUpdate) / 1000;
    currentState.time = state.time + elapsed;
  }
  socket.emit('state', { ...currentState, serverTime: Date.now() });

  socket.on('control', (msg) => {
    if (msg.type === 'play') {
      state.playing = true;
      state.time = msg.time || 0;
      state.lastUpdate = Date.now();
    } else if (msg.type === 'pause') {
      const now = Date.now();
      const elapsed = (now - state.lastUpdate) / 1000;
      if (state.playing) state.time = state.time + elapsed;
      state.playing = false;
      state.lastUpdate = now;
    } else if (msg.type === 'seek') {
      state.time = msg.time || 0;
      state.lastUpdate = Date.now();
    } else if (msg.type === 'setIndex') {
      state.index = msg.index || 0;
      state.time = 0;
      state.lastUpdate = Date.now();
      state.sourceType = 'file';
      state.currentUrl = null;
    } else if (msg.type === 'loadUrl') {
      state.sourceType = 'url';
      state.currentUrl = msg.url || null;
      state.index = 0;
      state.time = msg.time || 0;
      state.lastUpdate = Date.now();
    }
    if (typeof msg.index === 'number') state.index = msg.index;

    const stamped = { ...msg, serverTime: Date.now() };
    socket.broadcast.emit('control', stamped);
    emitPlaylist();
  });

  socket.on('timesync', (clientSent) => {
    socket.emit('timesync', { clientSent, serverTime: Date.now() });
  });

  socket.on('requestState', () => {
    const now = Date.now();
    const s = { ...state };
    if (state.playing) {
      const elapsed = (now - state.lastUpdate) / 1000;
      s.time = state.time + elapsed;
    }
    socket.emit('state', { ...s, serverTime: Date.now() });
  });
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => console.log(`Server listening on http://localhost:${PORT}`));
