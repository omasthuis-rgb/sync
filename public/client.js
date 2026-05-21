const socket = io();

let playlist = [];
let currentIndex = 0;
let currentSource = { type: 'file', url: '' };
let isUploader = false;
let ignoreSync = false;

const video = document.getElementById('video');
const playlistEl = document.getElementById('playlist');
const uploadPanel = document.getElementById('upload-panel');
const openUploadBtn = document.getElementById('openUploadBtn');
const watchTogetherBtn = document.getElementById('watchTogetherBtn');
const goWatchBtn = document.getElementById('goWatchBtn');
const videoFileInput = document.getElementById('videoFile');
const videoUrlInput = document.getElementById('videoUrl');
const uploadBtn = document.getElementById('uploadBtn');
const addUrlBtn = document.getElementById('addUrlBtn');
const uploadStatus = document.getElementById('uploadStatus');
const watchScreen = document.getElementById('watch-screen');
const homeScreen = document.getElementById('home-screen');

const roleInputs = document.querySelectorAll('input[name=role]');

let clockOffset = 0;
let rtt = 0;

function doTimeSync() {
  const clientSent = Date.now();
  socket.emit('timesync', clientSent);
}

socket.on('timesync', ({ clientSent, serverTime }) => {
  const now = Date.now();
  const measuredRtt = now - clientSent;
  rtt = measuredRtt;
  clockOffset = serverTime - (clientSent + measuredRtt / 2);
});

setInterval(doTimeSync, 5000);
doTimeSync();

function showScreen(screen) {
  homeScreen.classList.toggle('active', screen === 'home');
  watchScreen.classList.toggle('active', screen === 'watch');
}

watchTogetherBtn.addEventListener('click', () => showScreen('watch'));
goWatchBtn.addEventListener('click', () => showScreen('watch'));

openUploadBtn.addEventListener('click', () => {
  uploadPanel.classList.toggle('hidden');
});

roleInputs.forEach(r => r.addEventListener('change', (e) => {
  isUploader = e.target.value === 'uploader';
  if (!isUploader) uploadPanel.classList.add('hidden');
}));

uploadBtn.addEventListener('click', async () => {
  if (!videoFileInput.files.length) {
    uploadStatus.textContent = 'Choose a file first.';
    return;
  }

  const fd = new FormData();
  fd.append('video', videoFileInput.files[0]);
  uploadStatus.textContent = 'Uploading...';
  const res = await fetch('/upload', { method: 'POST', body: fd });
  if (res.ok) {
    uploadStatus.textContent = 'Upload complete.';
    videoFileInput.value = '';
    socket.emit('requestState');
  } else {
    uploadStatus.textContent = 'Upload failed.';
  }
});

addUrlBtn.addEventListener('click', () => {
  const url = videoUrlInput.value.trim();
  if (!url) {
    uploadStatus.textContent = 'Enter a video URL first.';
    return;
  }
  loadUrl(url, true);
  uploadStatus.textContent = 'URL loaded for everyone.';
});

function renderPlaylist() {
  playlistEl.innerHTML = '';
  playlist.forEach((item, idx) => {
    const btn = document.createElement('button');
    btn.textContent = `${idx + 1}. ${item.name}`;
    btn.addEventListener('click', () => {
      setIndex(idx, true);
      if (isUploader) socket.emit('control', { type: 'setIndex', index: idx });
    });
    playlistEl.appendChild(btn);
  });
}

function setIndex(idx, autoplay = false) {
  if (!playlist[idx]) return;
  currentIndex = idx;
  currentSource = { type: 'file', url: playlist[idx].url };
  ignoreSync = true;
  video.src = playlist[idx].url;
  video.load();
  if (autoplay) video.play().catch(() => {});
  setTimeout(() => ignoreSync = false, 500);
}

function loadUrl(url, broadcast = false) {
  currentSource = { type: 'url', url };
  currentIndex = 0;
  ignoreSync = true;
  video.src = url;
  video.load();
  video.play().catch(() => {});
  setTimeout(() => ignoreSync = false, 500);
  if (broadcast && isUploader) {
    socket.emit('control', { type: 'loadUrl', url, time: 0 });
  }
}

function applySyncTarget(desiredTime, index, playing, sourceType, sourceUrl) {
  if (sourceType === 'url' && sourceUrl) {
    if (currentSource.type !== 'url' || currentSource.url !== sourceUrl) {
      loadUrl(sourceUrl, false);
    }
  } else {
    if (typeof index === 'number' && index !== currentIndex) {
      setIndex(index, false);
    }
  }

  const setTimeWhenReady = (time) => {
    const doAdjust = () => {
      const local = video.currentTime || 0;
      const diff = time - local;
      const abs = Math.abs(diff);
      if (abs > 0.5) {
        ignoreSync = true;
        try { video.currentTime = Math.max(0, time); } catch (e) {}
        setTimeout(() => ignoreSync = false, 300);
      } else if (abs > 0.05) {
        const original = video.playbackRate || 1;
        const fast = diff > 0 ? 1.05 : 0.95;
        video.playbackRate = fast;
        setTimeout(() => { video.playbackRate = original; }, 1500);
      } else {
        video.playbackRate = 1;
      }
    };

    if (video.readyState < 1) {
      video.addEventListener('loadedmetadata', function onmeta() {
        video.removeEventListener('loadedmetadata', onmeta);
        doAdjust();
      });
    } else {
      doAdjust();
    }
  };

  setTimeWhenReady(desiredTime);
  if (playing) video.play().catch(() => {});
  else video.pause();
}

video.addEventListener('play', () => {
  if (!isUploader || ignoreSync) return;
  socket.emit('control', { type: 'play', time: video.currentTime, index: currentIndex });
});
video.addEventListener('pause', () => {
  if (!isUploader || ignoreSync) return;
  socket.emit('control', { type: 'pause', time: video.currentTime, index: currentIndex });
});
video.addEventListener('seeking', () => {
  if (!isUploader || ignoreSync) return;
  socket.emit('control', { type: 'seek', time: video.currentTime, index: currentIndex });
});
video.addEventListener('ended', () => {
  const next = currentIndex + 1;
  if (currentSource.type === 'file' && next < playlist.length) {
    setIndex(next, true);
    if (isUploader) socket.emit('control', { type: 'setIndex', index: next });
    if (isUploader) socket.emit('control', { type: 'play', time: 0, index: next });
  }
});

socket.on('playlist', (pl) => {
  playlist = pl;
  renderPlaylist();
  if (currentSource.type === 'file' && !playlist[currentIndex]) {
    setIndex(0, false);
  }
});

socket.on('state', (s) => {
  if (s.sourceType === 'url' && s.currentUrl) {
    currentSource = { type: 'url', url: s.currentUrl };
    const serverNow = Date.now() + clockOffset;
    const elapsed = (serverNow - (s.serverTime || Date.now())) / 1000;
    const targetTime = (s.time || 0) + elapsed;
    applySyncTarget(targetTime, 0, s.playing, 'url', s.currentUrl);
  } else {
    currentIndex = s.index || 0;
    setIndex(currentIndex, false);
    const serverNow = Date.now() + clockOffset;
    const elapsed = (serverNow - (s.serverTime || Date.now())) / 1000;
    const targetTime = (s.time || 0) + elapsed;
    applySyncTarget(targetTime, currentIndex, s.playing, 'file');
  }
});

socket.on('control', (msg) => {
  if (!msg) return;
  const serverNow = Date.now() + clockOffset;
  const elapsed = (serverNow - (msg.serverTime || Date.now())) / 1000;
  const desiredTime = (msg.time || 0) + elapsed;
  if (msg.type === 'setIndex') {
    setIndex(msg.index, false);
  } else if (msg.type === 'seek') {
    applySyncTarget(desiredTime, msg.index, true, currentSource.type, currentSource.url);
  } else if (msg.type === 'play') {
    applySyncTarget(desiredTime, msg.index, true, currentSource.type, currentSource.url);
  } else if (msg.type === 'pause') {
    applySyncTarget(desiredTime, msg.index, false, currentSource.type, currentSource.url);
  } else if (msg.type === 'loadUrl') {
    applySyncTarget(desiredTime, 0, true, 'url', msg.url);
  }
});

fetch('/videos').then(r => r.json()).then(pl => {
  playlist = pl;
  renderPlaylist();
  if (playlist.length) setIndex(0, false);
});

socket.emit('requestState');
