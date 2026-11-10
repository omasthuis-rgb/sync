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

## Account verification email

Registration sends a 6-digit code through SMTP. Copy `.env.example` to `.env`, then set `SMTP_USER` and `SMTP_PASS`. Restart the server after changing the settings. Keep `.env` private; it is excluded from Git.

For Gmail, set `EMAIL_PROVIDER=gmail`. Turn on 2-Step Verification for the sending Google account and create an App Password; use that generated password for `SMTP_PASS`, not your regular Google password.

For Outlook.com, set `EMAIL_PROVIDER=outlook` and use the account's SMTP password or app password. For Microsoft 365 work or school accounts, use `SMTP_HOST=smtp.office365.com`, `SMTP_PORT=587`, and `SMTP_SECURE=false`; SMTP AUTH may need to be enabled by the account administrator.

Optional settings are `SMTP_FROM`, `SMTP_HOST`, `SMTP_PORT`, and `SMTP_SECURE`. The host/port/security settings can override the provider defaults. If SMTP is missing or sending fails, registration returns an error and does not create a verification code.

Usage:
- Choose role `Uploader` to upload video files and control playback.
- Choose role `Viewer` to join and watch in sync.

Notes:
- Uploaded files are stored in `/uploads`.
- This is a demo; add auth and validation for production use.
