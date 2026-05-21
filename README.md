# Sync Video Server

Small demo to upload videos to a folder and watch them in sync across clients.

Requirements:
- Node.js 18+ recommended

Install and run:

```bash
npm install
npm start
```

Open http://localhost:3000

Usage:
- Choose role `Uploader` to upload video files and control playback.
- Choose role `Viewer` to join and watch in sync.

Notes:
- Uploaded files are stored in `/uploads`.
- This is a demo; add auth and validation for production use.
