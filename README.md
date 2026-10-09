# WHAT DID I MISS?

A local-first catch-up app for WhatsApp-style text exports, CSV transcripts, and supported JSON chat exports. Create a local account, import a conversation, and review a locally generated summary, urgency-ranked highlights, decisions, mentions, deadlines, and action items.

**Private by default:** the API binds only to `127.0.0.1`; imported messages and account data are saved in `%LOCALAPPDATA%\WhatDidIMiss\private-store.json` on Windows, outside the project folder (including if the project is in OneDrive). No chat content is sent to a hosted API. The first AI summary downloads the model files from Hugging Face; after that, inference runs on your computer using Transformers.js and CPU. The initial model download needs internet and disk space. Do not describe first-run setup as fully offline.

## Requirements

- Windows 10/11 and VS Code (other operating systems can run the same Node commands).
- Node.js **20.19+**, **22.12+**, or **24.x** (LTS recommended) and the npm version bundled with it.
- No Python installation is required.
- Allow several hundred megabytes of free disk space for model files on first use. The exact size depends on model assets and runtime files.

Check versions in the VS Code terminal:

```powershell
node --version
npm.cmd --version
```

## Install and run on Windows

1. Open this project folder in VS Code.
2. In the integrated PowerShell terminal, install the locked dependencies:

   ```powershell
   npm.cmd ci
   ```

3. Optionally copy `.env.example` to `.env` if you want to set a backend port or a non-default local data location. The default port is `3001`; the service remains bound to loopback only. The default data directory on Windows is `%LOCALAPPDATA%\WhatDidIMiss`, which is not normally synchronized by OneDrive.

   ```powershell
   Copy-Item .env.example .env
   ```

4. Start the app:

   ```powershell
   npm.cmd run dev:api
   ```

   In a second terminal:

   ```powershell
   npm.cmd run dev
   ```

5. Open the Vite URL printed in the terminal (normally `http://127.0.0.1:5173`).

`start.bat` is an alternative one-step Windows launcher. It checks the Node version, installs dependencies if `node_modules` is missing, starts the local API, and runs Vite. Keep its terminal open while using the app.

To run the production build locally:

```powershell
npm.cmd run build
npm.cmd start
```

Then open `http://127.0.0.1:3001`. The Express process serves both the production frontend and local API. `npm.cmd run preview` previews only the Vite frontend and is not the full production-mode app.

## WhatsApp import

1. In WhatsApp, use the chat's **Export chat** action and choose **Without media**.
2. Save the `.txt` export on this computer.
3. In WHAT DID I MISS?, choose **Import conversation**, select the file, review the preview, and start analysis.
4. Wait for the local model to finish its first-time download and inference. Later analyses use the cached model.
5. Open a signal to inspect its supporting original message. Export a local copy or delete one conversation/all of your conversations from the app.

Supported imports:

- `.txt`: timestamped WhatsApp-style exports and simple `Sender: message` lines. Untimestamped lines are retained with a warning.
- `.csv`: one header row with a `text`, `message`, or `body` column. Optional columns: `sender`/`author`/`from`/`user`, `timestamp`/`time`/`date`/`ts`, and `source`/`conversation`/`chat`/`channel`.
- `.json`: arrays or nested objects containing message objects with `text`, `message`, or `body`, plus optional sender and timestamp fields. Slack-like message arrays are supported; archives that depend on separate user lookup files may show IDs as sender names.

Each file is limited to 5 MB and 25,000 messages. WhatsApp ZIP archives, attachments, voice notes, and media are not imported. CSV records must fit on a single line; multiline quoted CSV fields are not supported. The app does not fabricate a summary if model inference fails: available extracted signals remain visible, alongside a clear model error.

Signal extraction (urgency, tasks, decisions, date mentions, and name/handle mentions) uses local text rules. English summaries use `Xenova/distilbart-cnn-6-6` through Transformers.js with CPU inference. Indian-language input and output use `Xenova/nllb-200-distilled-600M` locally: translate to English, summarize, then translate the summary back. The locally supported set is English and 19 scheduled Indian languages. Bodo, Dogri, and Konkani are listed but not supported by this model; the app rejects them and does not silently use a cloud fallback. Model quality varies by language and script; verify important results against source messages.

The NLLB ONNX model repository is marked CC-BY-NC-4.0. Review its current license and get appropriate permission before commercial use or redistribution. Its first download is substantially larger than the English summarizer and requires additional disk and memory.

## Local backend API

The API is served on `http://127.0.0.1:3001` by default. Vite proxies `/api` and `/socket.io` to this local process during development.

- `GET /api/health` — local service/model health.
- `POST /api/auth/signup`, `POST /api/auth/login`, `GET /api/auth/me`, `POST /api/auth/logout` — local account/session.
- `POST /api/import` — authenticated multipart file import.
- `GET /api/conversations` and `/api/conversations/:id` — reports and original messages.
- `GET /api/conversations/:id/summary`, `/highlights`, `/tasks` — report-specific views.
- `PATCH /api/conversations/:id/tasks/:taskId` — update an action item's state.
- `GET /api/conversations/:id/export`, `DELETE /api/conversations/:id`, `DELETE /api/conversations` — export/delete.
- `GET /api/model/status` — local model download/load state.

Socket.IO updates for model download and analysis progress are authenticated and scoped to the signed-in local account.

## Data storage and privacy

- Account hashes and conversation messages/reports are stored in `%LOCALAPPDATA%\WhatDidIMiss\private-store.json` by default on Windows. It is local plaintext data, not encrypted at rest. Keep your Windows account and disk protected.
- Passwords are hashed with Node's `scrypt`; the application does not store raw passwords. Session tokens are held in server memory and an HttpOnly, SameSite cookie. Restarting the server signs you out.
- The model cache is stored under `%LOCALAPPDATA%\WhatDidIMiss\models`. Both the store and model cache stay outside the project directory. Set `WHAT_DID_I_MISS_DATA_DIR` in `.env` to override the location; choose a local, non-synced folder.
- Data remains after refresh, browser restart, and server restart. It is removed when you delete it in the app or remove the `WhatDidIMiss` data folder. Clearing browser site data alone does not delete the server's local data.
- A second device does not receive or synchronize any data. This app is a local application, not a hosted sync service.
- No cloud AI provider is configured. The one-time model asset download requests model files from Hugging Face; conversation text is only processed by the local Node process/model. No network inference endpoint is used.
- The Listen control uses the browser's Web Speech API to read the generated summary and can be stopped at any time. Speech is not sent to this app's backend; the selected browser/operating-system voice may have its own privacy behavior, so review that provider's settings.
- Urgent results are shown visually and announced through a screen-reader live region. Optional desktop notifications contain counts only, never imported message text.
- Indian Sign Language (ISL) is not generated or translated by this app, and no ISL clips are bundled. The accessibility panel links to an official ISL resource.

### Vercel: hosted HTTPS interface, local private companion

Vercel hosts only the static frontend. Accounts, sessions, imported conversations, summaries, and AI models stay on each user's own computer. This is not a shared online account service. Each user must install and run the local companion for the app's private features to work.

1. Push the project to GitHub and import the repository in Vercel (or, after Git is installed and authenticated, run `vercel` in the project folder).
2. Use the Vite defaults: install `npm install`, build `npm run build`, output `dist`. `vercel.json` configures SPA rewrites and security headers.
3. In the Vercel project's Production and Preview environment settings, set `VITE_LOCAL_API_URL` to `http://127.0.0.1:3001`, then redeploy. This value points each visitor's browser to that visitor's own computer, not to a hosted API.
4. On each user's computer, install Node.js and this project, run `npm.cmd ci`, and copy `.env.example` to `.env`. Set `WHAT_DID_I_MISS_ALLOWED_ORIGINS` to the exact deployed HTTPS origin, e.g. `https://your-project.vercel.app` (no trailing slash). Add a custom HTTPS domain as an additional comma-separated origin only if needed. Do not use `*` or a wildcard for all Vercel sites.
5. Start the local companion with `npm.cmd run dev:api` and leave it running. Visit the Vercel HTTPS URL and allow the browser's local-network/loopback permission if prompted. Create/sign in to an account stored on that computer.
6. Verify direct navigation/refresh of a nested URL and the app's API health, sign-in, import, and deletion while the companion is running. Stop the companion and confirm the UI reports that local service as unavailable.

The companion binds only to loopback and allows the configured HTTPS origin plus known local development origins. HTTPS cross-origin sessions use `SameSite=None; Secure` cookies. Browser support for private-network requests, loopback access from an HTTPS site, and third-party cookies varies. If the browser blocks the connection/cookie, features will not work in that browser; this app does not bypass the restriction by exposing a public backend. No imported chat content is sent to Vercel. Standard website request metadata may still appear in hosting access logs.

**Do not deploy the Node backend as a public Vercel function.** It uses a persistent local store and CPU inference and deliberately rejects non-loopback requests. A public backend would change the privacy model and would require a separate design for remote account/data storage, security, deletion, inference, and disclosure. Vercel CLI account setup and project linking must be done by the repository owner.

## Development, tests, and build

```powershell
npm.cmd test
npm.cmd run build
npm.cmd start
```

The tests cover supported parsers, signal extraction, and local authentication/storage behavior. Import/API integration should also be checked from the running app on the supported Windows setup.

## Troubleshooting

- **`npm.ps1 cannot be loaded`:** use `npm.cmd` in PowerShell, as shown above.
- **Node version rejected:** install Node.js 20.19+ or 22.12+, close/reopen VS Code, and check `node --version`.
- **Port already in use:** close the other local app using port 3001/5173, or set another `PORT` in `.env`; if changing the API port, update both targets in `vite.config.js` to match.
- **Frontend says the local service is unavailable:** start `npm.cmd run dev:api` in a second terminal and keep it running.
- **Vercel page cannot reach the local companion:** confirm `VITE_LOCAL_API_URL` was set before the last deployment, the companion is running, `WHAT_DID_I_MISS_ALLOWED_ORIGINS` exactly matches the HTTPS origin, and the browser allowed local-network access and cookies. Some browser configurations block this flow; there is no safe public-backend fallback configured.
- **Model download fails:** check internet access to Hugging Face, free disk space, and restart the analysis. The app will show a model error and will not invent a summary; local rule-based signals may still be available.
- **Model inference runs out of memory or is too slow:** close memory-intensive apps and import smaller exports. CPU inference time varies with message count and the laptop.
- **No messages found:** check the file extension/format, export WhatsApp without media, and ensure the file contains text message entries. ZIP exports and media are not supported.
- **Want to remove private data:** delete conversations in the app. For a full reset including accounts and cached model files, stop the API first and then remove only `%LOCALAPPDATA%\WhatDidIMiss`.

## Deployment checklist

- [ ] Install supported Node.js and run `npm.cmd ci`.
- [ ] Run `npm.cmd test` and `npm.cmd run build`.
- [ ] Start `npm.cmd start` and open `http://127.0.0.1:3001`.
- [ ] Create/sign in to a local account, import a small supported export, and confirm report evidence matches the source.
- [ ] Confirm imported content is saved only in the local app-data directory, outside any synchronized project folder.
- [ ] Delete the test conversation and confirm it no longer appears.
- [ ] Keep the API bound to loopback; do not publish it or forward its port.
- [ ] For Vercel, deploy only `dist`, set `VITE_LOCAL_API_URL`, and configure the exact allowed origin on each local companion.

No live Vercel deployment is claimed. The GitHub repository was not linked in this workspace when these instructions were written.
