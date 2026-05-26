const express = require('express');
const http = require('http');
const path = require('path');
const fs = require('fs');
const crypto = require('crypto');
const multer = require('multer');
const { Server } = require('socket.io');

const app = express();
const server = http.createServer(app);
const io = new Server(server);

const UPLOAD_DIR = path.join(__dirname, 'uploads');
if (!fs.existsSync(UPLOAD_DIR)) fs.mkdirSync(UPLOAD_DIR);
const PLAYLISTS_PATH = path.join(__dirname, 'playlists.json');

// Multer setup
const storage = multer.diskStorage({
  destination: (req, file, cb) => cb(null, UPLOAD_DIR),
  filename: (req, file, cb) => cb(null, Date.now() + '-' + file.originalname.replace(/[^a-zA-Z0-9._-]/g, '_'))
});
const upload = multer({ storage });

app.use(express.json());
app.use(express.urlencoded({ extended: true }));
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
// playlists: map playlistName -> array of items { name, url }
function loadPlaylists() {
  try {
    const raw = fs.readFileSync(PLAYLISTS_PATH, 'utf8');
    const parsed = JSON.parse(raw);
    if (parsed && typeof parsed === 'object') return parsed;
  } catch (e) {}
  return { default: [] };
}

function savePlaylists() {
  fs.writeFileSync(PLAYLISTS_PATH, JSON.stringify(playlists, null, 2));
}

let playlists = loadPlaylists();
if (!playlists || typeof playlists !== 'object' || !Object.keys(playlists).length) {
  playlists = { default: [] };
}
if (!playlists.default) playlists.default = [];
savePlaylists();

const USERS_PATH = path.join(__dirname, 'users.json');
const sessions = new Map();
const pendingVerifications = new Map();

function loadUsers() {
  try {
    const raw = fs.readFileSync(USERS_PATH, 'utf8');
    const parsed = JSON.parse(raw);
    if (Array.isArray(parsed)) return parsed;
  } catch (e) {}
  return [];
}

function saveUsers() {
  fs.writeFileSync(USERS_PATH, JSON.stringify(users, null, 2));
}

function hashPassword(password, salt = crypto.randomBytes(16).toString('hex')) {
  const hash = crypto.pbkdf2Sync(password, salt, 100000, 64, 'sha512').toString('hex');
  return { salt, hash };
}

function verifyPassword(password, user) {
  const hash = crypto.pbkdf2Sync(password, user.salt, 100000, 64, 'sha512').toString('hex');
  const stored = Buffer.from(user.hash, 'hex');
  const current = Buffer.from(hash, 'hex');
  if (stored.length !== current.length) return false;
  return crypto.timingSafeEqual(stored, current);
}

function generateCode() {
  return String(crypto.randomInt(100000, 1000000)).padStart(6, '0');
}

function generateToken() {
  return crypto.randomBytes(32).toString('hex');
}

function getCookie(req, name) {
  const cookieHeader = req.headers.cookie || '';
  const match = cookieHeader.match(new RegExp(`(?:^|; )${name}=([^;]+)`));
  return match ? match[1] : null;
}

function issueSession(res, email) {
  const token = generateToken();
  sessions.set(token, { email, expiresAt: Date.now() + 1000 * 60 * 60 * 24 });
  res.setHeader('Set-Cookie', `sid=${token}; Path=/; HttpOnly; SameSite=Lax`);
}

function clearSession(res) {
  res.setHeader('Set-Cookie', 'sid=; Path=/; Expires=Thu, 01 Jan 1970 00:00:00 GMT; HttpOnly; SameSite=Lax');
}

function getSession(req) {
  const token = getCookie(req, 'sid');
  if (!token) return null;
  const session = sessions.get(token);
  if (!session) return null;
  if (session.expiresAt < Date.now()) {
    sessions.delete(token);
    return null;
  }
  return session;
}

function sendVerificationEmail(email, code) {
  console.log(`[AUTH] Verification code for ${email}: ${code}`);
  return { ok: true, mode: 'log' };
}

let users = loadUsers();

let state = {
  playlist: 'default',
  index: 0,
  playing: false,
  time: 0,
  lastUpdate: Date.now(),
  sourceType: 'file',
  currentUrl: null
};

function emitPlaylists() {
  io.emit('playlists', Object.keys(playlists).map(name => ({ name, items: playlists[name] })));
}

io.on('connection', (socket) => {
  socket.emit('playlists', Object.keys(playlists).map(name => ({ name, items: playlists[name] })));

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
    } else if (msg.type === 'setPlaylist') {
      state.playlist = msg.playlist || 'default';
      state.index = 0;
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
    // If uploads changed or playlist modifications happened, broadcast playlists
    emitPlaylists();
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

// REST endpoints for playlist management
app.get('/login', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'login.html'));
});

app.get('/logout', (req, res) => {
  clearSession(res);
  res.redirect('/');
});

app.get('/api/auth/me', (req, res) => {
  const session = getSession(req);
  if (!session) return res.json({ user: null });
  res.json({ user: { email: session.email } });
});

app.post('/api/auth/register', (req, res) => {
  const email = String(req.body.email || '').trim().toLowerCase();
  const password = String(req.body.password || '');
  const confirmPassword = String(req.body.confirmPassword || '');

  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    return res.status(400).json({ error: 'Please enter a valid email address.' });
  }
  if (password.length < 8) {
    return res.status(400).json({ error: 'Password must be at least 8 characters.' });
  }
  if (password !== confirmPassword) {
    return res.status(400).json({ error: 'Passwords do not match.' });
  }
  if (users.some(u => u.email === email)) {
    return res.status(409).json({ error: 'An account with that email already exists.' });
  }

  const code = generateCode();
  const { salt, hash } = hashPassword(password);
  pendingVerifications.set(email, {
    code,
    salt,
    hash,
    expiresAt: Date.now() + 1000 * 60 * 10
  });

  sendVerificationEmail(email, code);
  res.json({ ok: true, message: 'Verification code sent. Enter it to finish creating your account.' });
});

app.post('/api/auth/verify', (req, res) => {
  const email = String(req.body.email || '').trim().toLowerCase();
  const code = String(req.body.code || '').trim();
  const pending = pendingVerifications.get(email);

  if (!pending) {
    return res.status(400).json({ error: 'No verification code was requested for this email.' });
  }
  if (pending.expiresAt < Date.now()) {
    pendingVerifications.delete(email);
    return res.status(400).json({ error: 'Verification code expired. Please request a new one.' });
  }
  if (pending.code !== code) {
    return res.status(400).json({ error: 'Incorrect verification code.' });
  }

  users.push({ email, salt: pending.salt, hash: pending.hash, createdAt: Date.now() });
  saveUsers();
  pendingVerifications.delete(email);
  issueSession(res, email);
  res.json({ ok: true, user: { email } });
});

app.post('/api/auth/login', (req, res) => {
  const email = String(req.body.email || '').trim().toLowerCase();
  const password = String(req.body.password || '');
  const user = users.find((entry) => entry.email === email);

  if (!user || !verifyPassword(password, user)) {
    return res.status(401).json({ error: 'Invalid email or password.' });
  }

  issueSession(res, email);
  res.json({ ok: true, user: { email } });
});

app.get('/playlists', (req, res) => {
  res.json(Object.keys(playlists).map(name => ({ name, items: playlists[name] })));
});

app.post('/playlists', express.json(), (req, res) => {
  const name = (req.body && req.body.name || '').trim();
  if (!name) return res.status(400).json({ error: 'name required' });
  if (playlists[name]) return res.status(409).json({ error: 'already exists' });
  playlists[name] = [];
  savePlaylists();
  emitPlaylists();
  res.json({ ok: true, name });
});

app.post('/playlists/:name/add', express.json(), (req, res) => {
  const name = req.params.name;
  if (!playlists[name]) return res.status(404).json({ error: 'playlist not found' });
  const { filename, url, title } = req.body || {};
  if (filename) {
    const filePath = path.join(UPLOAD_DIR, filename);
    if (!fs.existsSync(filePath)) return res.status(404).json({ error: 'file not found' });
    playlists[name].push({ name: title || filename, url: `/video/${encodeURIComponent(filename)}` });
  } else if (url) {
    playlists[name].push({ name: title || url, url });
  } else {
    return res.status(400).json({ error: 'filename or url required' });
  }
  savePlaylists();
  emitPlaylists();
  res.json({ ok: true });
});

app.post('/playlists/:name/remove', express.json(), (req, res) => {
  const name = req.params.name;
  if (!playlists[name]) return res.status(404).json({ error: 'playlist not found' });
  const { index } = req.body || {};
  if (typeof index !== 'number' || index < 0 || index >= playlists[name].length) return res.status(400).json({ error: 'invalid index' });
  playlists[name].splice(index, 1);
  savePlaylists();
  emitPlaylists();
  res.json({ ok: true });
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => console.log(`Server listening on http://localhost:${PORT}`));
