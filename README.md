# Hack-Canada (Frontend Extension Repo)

This repository contains the Firefox extension frontend for iTrack.

Current active implementation:
- `itrack-extension` (main extension code)

Legacy folders (not part of current production flow):
- `eye-tracking`
- `cloudinary`
- `serpapi`

The backend API runs from a separate repository:
- `D:\Repositories\Hackathons\itrack-backend` (Windows example path)

## What This Repo Does

The extension injects a right-side product panel into Instagram, runs gaze tracking in an embedded page, and sends screenshot data to the backend `/dwell` pipeline.

The extension supports:
- Manual upload (`Upload image` button in Dev mode)
- Auto-capture (400x400 anchored screenshot window, 2s dwell)
- Gaze modes (`Calibrate`, `Dev`, `Normal`)

## Prerequisites

- Node.js 18+ (Node 20+ recommended)
- npm
- Firefox (temporary extension loading via `about:debugging`)
- iTrack backend running (default: `http://127.0.0.1:8000`)

No Python virtual environment is required for the current extension flow.

## Setup (Windows)

```powershell
cd D:\Repositories\Hackathons\Hack-Canada\itrack-extension
npm install
npm run build
```

Optional development watch mode:

```powershell
npm run watch
```

Load extension in Firefox:
1. Open `about:debugging#/runtime/this-firefox`
2. Click `Load Temporary Add-on...`
3. Select: `D:\Repositories\Hackathons\Hack-Canada\itrack-extension\manifest.json`

## Setup (macOS)

```bash
cd ~/Repositories/Hackathons/Hack-Canada/itrack-extension
npm install
npm run build
```

Optional development watch mode:

```bash
npm run watch
```

Load extension in Firefox:
1. Open `about:debugging#/runtime/this-firefox`
2. Click `Load Temporary Add-on...`
3. Select: `~/Repositories/Hackathons/Hack-Canada/itrack-extension/manifest.json`

## Run With Backend

1. Start the backend repo first (`itrack-backend`) on `127.0.0.1:8000`.
2. Build and load this extension.
3. Open Instagram:
   - `https://www.instagram.com/?hl=en`
4. Open the iTrack panel.
5. Use modes:
   - `Calibrate`: calibration overlay, sidebar sections hidden
   - `Dev`: debug mode; upload and auto-capture controls visible
   - `Normal`: runtime tracking mode; debug controls hidden

## Upload Workflow (Manual)

When you choose a file in `Upload image`, the extension does:
1. Resolve runtime config:
   - first from `window.ITRACK_RUNTIME_CONFIG` if present
   - fallback from backend `GET /runtime/client-config`
2. If Cloudinary direct upload is available:
   - upload file directly to Cloudinary from browser
   - fetch Cloudinary `secure_url`
   - convert that image back to base64 for `/dwell`
3. If Cloudinary direct upload is not available:
   - convert local file directly to base64
4. Send payload to backend `POST /dwell`:
   - `screenshot_b64`
   - optional `screenshot_url` and `screenshot_public_id`
   - page metadata and dwell metadata

## Auto-Capture Workflow

In Dev mode, auto-capture can trigger the same pipeline as manual upload:
1. Anchor a 400x400 box at current gaze point.
2. Hold for 2 seconds.
3. If gaze remains inside anchor box for the window:
   - capture viewport screenshot via background script (`tabs.captureVisibleTab`)
   - crop anchored 400x400 region in canvas
   - build a `File`
   - call the same image upload handler used by manual upload
4. If gaze leaves anchor box before window ends:
   - skip capture for that cycle

## Key Files

- `itrack-extension/content.ts`: main extension logic (UI, modes, upload flow, auto-capture)
- `itrack-extension/background.js`: privileged APIs (`captureVisibleTab`, proxy fetch bridge)
- `itrack-extension/gaze-page.html`: extension page hosting gaze runtime
- `itrack-extension/gaze.js`: gaze relay script posting samples to content script
- `itrack-extension/manifest.json`: Firefox extension manifest

## Troubleshooting

- Extension icon is greyed out:
  - Expected if no toolbar popup is defined.
  - The extension runs as a content script on matching Instagram pages.
- Nothing hits backend on upload:
  - Confirm backend is running on `http://127.0.0.1:8000`
  - Check browser console for `[iTrack] sending /dwell`
  - Reload temporary extension after rebuild (`npm run build`)
- Cloudinary direct upload not used:
  - Backend must expose Cloudinary client config via `/runtime/client-config`
  - Missing/disabled config causes local base64 fallback automatically
