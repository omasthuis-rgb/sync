const socket = io();

let playlists = [];
let currentPlaylist = [];
let selectedPlaylist = 'default';
let currentIndex = 0;
let currentSource = { type: 'file', url: '' };
let isUploader = false;
let ignoreSync = false;

const video = document.getElementById('video');
const playlistEl = document.getElementById('playlist');
const playlistsHomeEl = document.getElementById('playlists-home');
const newPlaylistName = document.getElementById('newPlaylistName');
const createPlaylistBtn = document.getElementById('createPlaylistBtn');
const uploadPanel = document.getElementById('upload-panel');
const openUploadBtn = document.getElementById('openUploadBtn');
const watchTogetherBtn = document.getElementById('watchTogetherBtn');
const browseAnimeBtn = document.getElementById('browseAnimeBtn');
const heroBrowseCardBtn = document.getElementById('heroBrowseCardBtn');
const videoFileInput = document.getElementById('videoFile');
const videoUrlInput = document.getElementById('videoUrl');
const uploadBtn = document.getElementById('uploadBtn');
const addUrlBtn = document.getElementById('addUrlBtn');
const uploadStatus = document.getElementById('uploadStatus');
const playlistSelect = document.getElementById('playlistSelect');
const addToPlaylistBtn = document.getElementById('addToPlaylistBtn');
const addUrlToPlaylistBtn = document.getElementById('addUrlToPlaylistBtn');
const browseScreen = document.getElementById('browse-screen');
const browsePlaylistsList = document.getElementById('browse-playlists-list');
const watchScreen = document.getElementById('watch-screen');
const homeScreen = document.getElementById('home-screen');
const backHomeBtn = document.getElementById('backHomeBtn');
const browseHomeBtn = document.getElementById('browseHomeBtn');

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
  browseScreen.classList.toggle('active', screen === 'browse');
  watchScreen.classList.toggle('active', screen === 'watch');
}

watchTogetherBtn.addEventListener('click', () => showScreen('watch'));
browseAnimeBtn && browseAnimeBtn.addEventListener('click', () => {
  renderBrowseList();
  showScreen('browse');
});
heroBrowseCardBtn && heroBrowseCardBtn.addEventListener('click', () => {
  renderBrowseList();
  showScreen('browse');
});

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
    const json = await res.json();
    uploadStatus.textContent = 'Upload complete.';
    videoFileInput.value = '';
    // remember last uploaded filename so user can add it to a playlist
    lastUploadedFile = json.file;
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

let lastUploadedFile = null;

// Add uploaded file to selected playlist
addToPlaylistBtn && addToPlaylistBtn.addEventListener('click', async () => {
  if (!lastUploadedFile) {
    uploadStatus.textContent = 'No recent upload to add.';
    return;
  }
  const target = playlistSelect.value || selectedPlaylist || 'default';
  const res = await fetch(`/playlists/${encodeURIComponent(target)}/add`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ filename: lastUploadedFile }) });
  if (res.ok) {
    uploadStatus.textContent = 'Added upload to playlist.';
    socket.emit('requestState');
  } else {
    uploadStatus.textContent = 'Failed to add to playlist.';
  }
});

// Add URL to playlist
addUrlToPlaylistBtn && addUrlToPlaylistBtn.addEventListener('click', async () => {
  const url = videoUrlInput.value.trim();
  if (!url) {
    uploadStatus.textContent = 'Enter a video URL first.';
    return;
  }
  const target = playlistSelect.value || selectedPlaylist || 'default';
  const res = await fetch(`/playlists/${encodeURIComponent(target)}/add`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ url, title: url }) });
  if (res.ok) {
    uploadStatus.textContent = 'Added URL to playlist.';
    socket.emit('requestState');
  } else {
    uploadStatus.textContent = 'Failed to add URL to playlist.';
  }
});

// Back to home button
if (backHomeBtn) backHomeBtn.addEventListener('click', () => showScreen('home'));
if (browseHomeBtn) browseHomeBtn.addEventListener('click', () => showScreen('home'));

function renderPlaylist() {
  playlistEl.innerHTML = '';
  currentPlaylist.forEach((item, idx) => {
    const wrap = document.createElement('div');
    wrap.style.display = 'flex';
    wrap.style.gap = '8px';
    wrap.style.alignItems = 'center';

    const btn = document.createElement('button');
    btn.textContent = `${idx + 1}. ${item.name}`;
    btn.style.flex = '1';
    btn.addEventListener('click', () => {
      setIndex(idx, true);
      if (isUploader) socket.emit('control', { type: 'setIndex', index: idx, playlist: selectedPlaylist });
    });

    wrap.appendChild(btn);

    if (isUploader) {
      const del = document.createElement('button');
      del.textContent = 'Remove';
      del.className = 'secondary-btn';
      del.style.padding = '8px 10px';
      del.addEventListener('click', async () => {
        await fetch(`/playlists/${encodeURIComponent(selectedPlaylist)}/remove`, {
          method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ index: idx })
        });
        socket.emit('requestState');
      });
      wrap.appendChild(del);
    }

    playlistEl.appendChild(wrap);
  });
}

function setIndex(idx, autoplay = false) {
  if (!currentPlaylist[idx]) return;
  currentIndex = idx;
  currentSource = { type: 'file', url: currentPlaylist[idx].url };
  ignoreSync = true;
  video.src = currentPlaylist[idx].url;
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
  socket.emit('control', { type: 'play', time: video.currentTime, index: currentIndex, playlist: selectedPlaylist });
});
video.addEventListener('pause', () => {
  if (!isUploader || ignoreSync) return;
  socket.emit('control', { type: 'pause', time: video.currentTime, index: currentIndex, playlist: selectedPlaylist });
});
video.addEventListener('seeking', () => {
  if (!isUploader || ignoreSync) return;
  socket.emit('control', { type: 'seek', time: video.currentTime, index: currentIndex, playlist: selectedPlaylist });
});
video.addEventListener('ended', () => {
  const next = currentIndex + 1;
  if (currentSource.type === 'file' && next < currentPlaylist.length) {
    setIndex(next, true);
    if (isUploader) socket.emit('control', { type: 'setIndex', index: next, playlist: selectedPlaylist });
    if (isUploader) socket.emit('control', { type: 'play', time: 0, index: next, playlist: selectedPlaylist });
  }
});

socket.on('playlist', (pl) => {
  // legacy support: single playlist payload
  currentPlaylist = pl;
  renderPlaylist();
  if (currentSource.type === 'file' && !currentPlaylist[currentIndex]) {
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
    if (msg.playlist) {
      // switch to the playlist specified by the server message
      const found = playlists.find(p => p.name === msg.playlist);
      if (found) {
        selectedPlaylist = found.name;
        currentPlaylist = found.items || [];
      }
    }
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

// Fetch initial playlists from server
fetch('/playlists').then(r => r.json()).then(pls => {
  playlists = pls || [];
  const found = playlists.find(p => p.name === selectedPlaylist) || playlists[0] || { name: 'default', items: [] };
  selectedPlaylist = found.name;
  currentPlaylist = found.items || [];
  renderPlaylistsHome();
  renderPlaylist();
  if (currentPlaylist.length) setIndex(0, false);
});

function updatePlaylistCardTitle() {
  const playlistCardTitle = document.getElementById('playlist-card-title');
  if (playlistCardTitle) {
    playlistCardTitle.textContent = `${selectedPlaylist || 'default'} (${currentPlaylist.length})`;
  }
}

function renderPlaylistsHome() {
  updatePlaylistCardTitle();
  if (!playlistsHomeEl) return;
  playlistsHomeEl.innerHTML = '';
  // update playlist select
  if (playlistSelect) {
    playlistSelect.innerHTML = '';
    playlists.forEach(p => {
      const opt = document.createElement('option');
      opt.value = p.name;
      opt.textContent = `${p.name} (${p.items.length})`;
      playlistSelect.appendChild(opt);
    });
    // ensure selectedPlaylist is selected
    if (selectedPlaylist) playlistSelect.value = selectedPlaylist;
  }
  playlists.forEach(p => {
    const b = document.createElement('div');
    b.style.display = 'flex';
    b.style.justifyContent = 'space-between';
    b.style.alignItems = 'center';
    b.style.marginBottom = '8px';

    const left = document.createElement('div');
    left.textContent = p.name + ` (${p.items.length})`;
    left.style.cursor = 'pointer';
    left.addEventListener('click', () => {
      selectedPlaylist = p.name;
      currentPlaylist = p.items;
      renderPlaylist();
      updatePlaylistCardTitle();
      if (isUploader) socket.emit('control', { type: 'setPlaylist', playlist: selectedPlaylist });
    });

    b.appendChild(left);
    playlistsHomeEl.appendChild(b);
  });
}

function renderBrowseList() {
  if (!browsePlaylistsList) return;
  browsePlaylistsList.innerHTML = '';
  if (!playlists.length) {
    const empty = document.createElement('div');
    empty.textContent = 'No playlists available yet.';
    empty.style.color = 'var(--muted)';
    browsePlaylistsList.appendChild(empty);
    return;
  }

  playlists.forEach(p => {
    const item = document.createElement('div');
    item.style.display = 'flex';
    item.style.justifyContent = 'space-between';
    item.style.alignItems = 'center';
    item.style.padding = '14px 16px';
    item.style.borderBottom = '1px solid rgba(255,255,255,0.08)';

    const left = document.createElement('div');
    left.innerHTML = `<strong>${p.name}</strong><div style="color: var(--muted); font-size: 0.95rem;">${p.items.length} anime</div>`;

    const open = document.createElement('button');
    open.textContent = 'Open';
    open.className = 'secondary-btn';
    open.addEventListener('click', () => {
      selectedPlaylist = p.name;
      currentPlaylist = p.items;
      renderPlaylist();
      updatePlaylistCardTitle();
      if (currentPlaylist.length) setIndex(0, false);
      socket.emit('requestState');
      showScreen('watch');
    });

    item.appendChild(left);
    item.appendChild(open);
    browsePlaylistsList.appendChild(item);
  });
}

createPlaylistBtn && createPlaylistBtn.addEventListener('click', async () => {
  const name = (newPlaylistName.value || '').trim();
  if (!name) return;
  await fetch('/playlists', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ name }) });
  newPlaylistName.value = '';
  socket.emit('requestState');
});

socket.on('playlists', (pls) => {
  playlists = pls || [];
  const found = playlists.find(p => p.name === selectedPlaylist) || playlists[0] || { name: 'default', items: [] };
  selectedPlaylist = found.name;
  currentPlaylist = found.items || [];
  renderPlaylistsHome();
  renderPlaylist();
});

socket.emit('requestState');
