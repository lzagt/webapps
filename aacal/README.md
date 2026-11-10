# AACal

React + Vite + Firebase (Auth, Firestore, Cloud Functions, Hosting) web app.

## 1. Prerequisites

- Node.js 24 (Cloud Functions require it)
- Firebase CLI: `npm i -g firebase-tools`
- Java 11+ (needed by the Firestore emulator)

## 2. Quick start (local, no Firebase account needed)

```bash
npm install
(cd functions && npm install && npm run build)

# terminal 1: emulators (Auth, Firestore, Functions, Hosting)
npm run emulator

# terminal 2: web app
npm run dev
```

Open http://localhost:3000 (Vite dev server). Emulator UI: http://localhost:5700.

`npm run dev` uses `.env.development`, which points at a fake `demo-aacal` project
and the local emulators, so nothing touches real Firebase data.
Data is lost when the emulators stop (add `--export-on-exit` / `--import` to keep it).

## 3. How configuration works

Vite loads env files by mode (later wins):
`.env` < `.env.[mode]` < `.env.local` < `.env.[mode].local`

| Command | Mode | Env file | Target |
|---|---|---|---|
| `npm run dev` | development | `.env.development` | emulators, project `demo-aacal` |
| `npm run build` | production | `.env.production` | real Firebase project |

Put personal overrides in `.env.local` (git-ignored). See `.env.example` for all variables.

### Firebase web config (`VITE_FIREBASE_*`)

`API_KEY`, `PROJECT_ID`, `APP_ID` are required; the rest are optional
(`AUTH_DOMAIN`, `STORAGE_BUCKET`, `MESSAGING_SENDER_ID`, `MEASUREMENT_ID`, `DATABASE_URL`).
Find them in Firebase console > Project settings > Your apps. The app fails fast with a
clear error if a required one is missing. Web API keys are not secrets.

### Emulator settings

Ports default to the ones in `firebase.json` (Firestore 5703, Auth 5705), so you
normally don't set anything. Optional overrides:

| Variable | Meaning |
|---|---|
| `VITE_USE_EMULATORS` | `true` / `false` / `auto` (auto = only on localhost) |
| `VITE_EMULATOR_HOST` | host for all emulators (default `127.0.0.1`) |
| `VITE_FIRESTORE_EMULATOR_HOST` / `_PORT` | Firestore only |
| `VITE_AUTH_EMULATOR_HOST` / `_PORT` | Auth only |

Ports are read when Vite starts: restart `npm run dev` after editing `firebase.json` or env files.

### Recipes

- **Dev against the real project** – `.env.local`:
  ```
  VITE_USE_EMULATORS=false
  VITE_FIREBASE_API_KEY=...
  VITE_FIREBASE_AUTH_DOMAIN=...
  VITE_FIREBASE_PROJECT_ID=...
  VITE_FIREBASE_APP_ID=...
  ```
- **Emulators on another machine** – `.env.local`: `VITE_EMULATOR_HOST=192.168.1.5`
- **Different emulator project id** – change `VITE_FIREBASE_PROJECT_ID` and the
  `--project` flag in the `emulator` script in `package.json` so they match.

## 4. Production

```bash
npm run build                      # type-check + build into dist/ using .env.production
(cd functions && npm run build)
firebase login
firebase use --add                 # choose your project (creates git-ignored .firebaserc)
firebase deploy                    # hosting + functions + firestore rules/indexes
```

To use your own Firebase project, edit `.env.production` with its web config.

## 5. Project layout

```
src/lib/firebase.ts         Firebase init (reads VITE_FIREBASE_*)
src/lib/emulatorConfig.ts   Emulator host/port resolution
src/components/             Login, Dashboard, Editor, ...
functions/src/index.ts      Cloud Function `api` (served under /aac/**)
firebase.json               Hosting, functions, emulator ports
firestore.rules             Security rules
```

## Troubleshooting

- **"Missing Firebase config"** – required `VITE_FIREBASE_*` var is absent for the current mode.
- **Auth/Firestore connection refused** – emulators not running, or ports differ from `firebase.json`/env.
- **Firestore emulator won't start** – install Java.
- **Port already in use** – change ports in `firebase.json` and restart both processes.
