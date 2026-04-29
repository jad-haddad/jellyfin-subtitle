# Jellyfin Plugin Subtitle Generator

A Jellyfin plugin that adds a **"Generate Subtitle"** button to movie and episode detail pages when no subtitles are available. It integrates with an external subtitle generation service to create `.srt` files on demand.

---

## Features

- **Smart Detection**: Automatically shows the button only when a movie or episode has **zero subtitle streams**.
- **Language Auto-Detection**: Populates the language dropdown from the item's **audio tracks**.
- **Progress Tracking**: Displays a real-time progress bar while the subtitle is being generated.
- **Error & Retry**: Shows clear error messages with a **Retry** button on failures.
- **Library Scan**: Automatically triggers a targeted Jellyfin library scan when a subtitle is completed so it appears immediately.
- **Configurable**: Service URL, max chars per line, and polling interval are all configurable from the Jellyfin dashboard.

---

## Requirements

- Jellyfin Server **10.11.x** (tested on 10.11.8)
- A running subtitle generation service exposing the API documented below
- [jellyfin-plugin-file-transformation](https://github.com/IAmParadox27/jellyfin-plugin-file-transformation) (for injecting the frontend script into the web client)

---

## Installation

### Option 1: Automated (Plugin Repository) - Recommended

Add this plugin to Jellyfin's **Plugin Repositories** and install/update automatically from the dashboard.

1. Open **Jellyfin Dashboard**.
2. Go to **Plugins → Repositories → (+) Add Repository**.
3. Fill in:
   - **Name**: `Subtitle Generator`
   - **URL**: [https://jad-haddad.github.io/jellyfin-plugin-subtitle-generator/plugins.json](https://raw.githubusercontent.com/jad-haddad/jellyfin-subtitle/main/plugins.json)
4. **Save**.
5. Go to **Plugins → Catalog**.
6. Find **Subtitle Generator** in the list and click **Install**.
7. Jellyfin will download and install the plugin automatically. Restart when prompted.

### Option 2: Manual (Build & Copy)

If you don't want to use a repository, you can manually install the DLL.

#### 1. Build

Using Docker:
```bash
docker run --rm -v "$(pwd):/workspace" -w /workspace/Jellyfin.Plugin.SubtitleGenerator \
  mcr.microsoft.com/dotnet/sdk:9.0 \
  dotnet build --configuration Release
```

Or use the provided build script:
```bash
./build.sh 1.0.0
```

#### 2. Install

Copy the DLL into your Jellyfin plugins directory:
```bash
cp Jellyfin.Plugin.SubtitleGenerator/bin/Release/net9.0/Jellyfin.Plugin.SubtitleGenerator.dll /path/to/jellyfin/plugins/SubtitleGenerator/
```

Restart Jellyfin. You should see **"Subtitle Generator"** in the Dashboard → Plugins section.

### 3. Configure

1. Open **Jellyfin Dashboard**.
2. Go to **Plugins → Subtitle Generator**.
3. Set the fields:
   - **Service URL**: Base URL of your subtitle generator (e.g. `http://subtitle-generator`)
   - **Max Chars Per Line**: Sent to the subtitle generator (default: `42`)
   - **Polling Interval (seconds)**: How often to check job status (default: `5`)
4. Click **Save**.

---

## File Transformation Setup

This plugin serves the frontend script at:

```
GET /SubtitleGenerator/Script
GET /SubtitleGenerator/Styles
```

You must inject these into the Jellyfin Web client using the **File Transformation** plugin.

### Example Configuration

In the File Transformation plugin, add a transformation for the **`index.html`** (or the detail page bundle) with an **Injection** action:

**Target**: `index.html`  
**Action**: Inject before `</body>` or `</head>`  
**Content**:

```html
<link rel="stylesheet" href="/SubtitleGenerator/Styles">
<script src="/SubtitleGenerator/Script"></script>
```

Save and restart Jellyfin. The button will now appear on movie/episode detail pages when no subtitles exist.

---

## How to Publish Your Own Repository

To make the plugin auto-installable, you'll need to host the Jellyfin-compatible `plugins.json`.

### GitHub Pages (Free & Simple)

1. Create a repo on GitHub.
2. In your repo, go to **Settings → Pages**.
3. Under **Build and deployment**, select:
   - **Source**: Deploy from a branch
   - **Branch**: `main` / `docs` folder (or create a `gh-pages` branch)
4. Update **`plugins.json`** with your actual release URL:
   ```json
   "sourceUrl": "https://github.com/jad-haddad/jellyfin-plugin-subtitle-generator/releases/download/v1.0.0/jellyfin-plugin-subtitle-generator_1.0.0.zip"
   ```
5. Push. Your repository file will be at:
   ```
   https://jad-haddad.github.io/jellyfin-plugin-subtitle-generator/plugins.json
   ```

### GitHub Actions Auto-Build

The included `.github/workflows/build.yml` automatically builds the plugin and uploads releases on tag push. To use it:

1. Push a git tag:
   ```bash
   git tag v1.0.0
   git push origin v1.0.0
   ```
2. GitHub Actions builds the plugin, creates a Release, and uploads `jellyfin-plugin-subtitle-generator_1.0.0.zip`.
3. Copy the release asset URL into `plugins.json`.
4. Push the updated `plugins.json` to your Pages branch.
5. Done! Jellyfin will now auto-update when you push new tags.

---

## How to Publish Your Own Repository

To make the plugin auto-installable, you'll need to host the Jellyfin-compatible `plugins.json`.

### GitHub Pages (Free & Simple)

1. Fork or create a repo on GitHub.
2. In your repo, go to **Settings → Pages**.
3. Under **Build and deployment**, select:
   - **Source**: Deploy from a branch
   - **Branch**: `main` / `docs` folder (or create a `gh-pages` branch)
4. Update **`plugins.json`** with your actual release URL:
   ```json
   "sourceUrl": "https://github.com/YOUR_USER/jellyfin-plugin-subtitle-generator/releases/download/v1.0.0/jellyfin-plugin-subtitle-generator_1.0.0.zip"
   ```
5. Push. Your repository file will be at:
   ```
   https://youruser.github.io/jellyfin-plugin-subtitle-generator/plugins.json
   ```

### GitHub Actions Auto-Build

The included `.github/workflows/build.yml` automatically builds the plugin and uploads releases on tag push. To use it:

1. Push a git tag:
   ```bash
   git tag v1.0.0
   git push origin v1.0.0
   ```
2. GitHub Actions builds the plugin, creates a Release, and uploads `jellyfin-plugin-subtitle-generator_1.0.0.zip`.
3. Copy the release asset URL into `plugins.json`.
4. Push the updated `plugins.json` to your Pages branch.
5. Done! Jellyfin will now auto-update when you push new tags.

---

## How It Works

1. **Detection**: When you navigate to a movie or episode, the injected JavaScript checks the item's `MediaSources`. If `MediaStreams` of type `Subtitle` count is `0`, the button is injected.
2. **Dialog**: Clicking the button opens a Jellyfin-styled dialog with a language `<select>` populated from audio tracks.
3. **Job Submission**: The plugin calls your subtitle service:
   ```http
   POST http://subtitle-generator/jobs/from-path
   Content-Type: application/json

   {
     "path": "/media/movies/Movie (2023)/Movie (2023).mkv",
     "language": "en",
     "max_chars_per_line": 42
   }
   ```
4. **Polling**: On `202 Accepted`, the frontend polls `GET /SubtitleGenerator/Jobs/{jobId}` every N seconds.
5. **Completion**: When the job returns `status: "completed"`, the plugin calls:
   ```http
   POST /SubtitleGenerator/Scan
   { "itemId": "..." }
   ```
   This triggers `ILibraryMonitor.ReportFileSystemChanged(path)` so Jellyfin detects the new `.srt` file immediately.

---

## Plugin API Endpoints

| Method | Endpoint | Description |
|--------|----------|-------------|
| `GET` | `/SubtitleGenerator/Script` | Returns the injected frontend JavaScript |
| `GET` | `/SubtitleGenerator/Styles` | Returns the dialog CSS |
| `GET` | `/SubtitleGenerator/Config` | Returns plugin settings (JSON) |
| `POST` | `/SubtitleGenerator/Jobs` | Submits a subtitle generation job |
| `GET` | `/SubtitleGenerator/Jobs/{jobId}` | Gets status of a running job |
| `POST` | `/SubtitleGenerator/Scan` | Triggers Jellyfin scan for a specific item path |

---

## Expected Subtitle Service API

Your subtitle generation service must implement these endpoints:

### Submit Job
```http
POST /jobs/from-path
Content-Type: application/json

{
  "path": "/media/movies/Movie (2023)/Movie (2023).mkv",
  "language": "en",
  "max_chars_per_line": 42
}
```

| Response | Meaning |
|----------|---------|
| `202 Accepted` | Job queued. Body may contain `{ "job_id": "..." }` or provide it via `Location` header. |
| `409 Conflict` | Subtitle already exists (e.g. `Movie (2023).en.srt`). |
| `404 Not Found` | Video path not found in container. |
| `415 Unsupported Media Type` | File extension not supported. |

### Check Job Status
```http
GET /jobs/{job_id}
```

```json
{
  "job_id": "abc-123",
  "status": "processing",
  "progress_pct": 65,
  "filename": "Movie (2023).mkv",
  "language": null,
  "error": null
}
```

| Status | Action |
|--------|--------|
| `processing` | Continue polling |
| `completed` | Done! The `.srt` is next to the video. |
| `failed` | Show error. |

---

## Troubleshooting

| Problem | Solution |
|---------|----------|
| Button does not appear | Ensure File Transformation is injecting the script into `index.html`. Check browser console for JS errors. |
| "Failed to connect" error | Check **Service URL** in plugin settings. Ensure Jellyfin can reach the subtitle service. |
| Subtitle not showing after completion | Check that the subtitle service wrote the `.srt` next to the video with correct naming (`{stem}.{lang}.srt`). Ensure volume mappings are identical. |
| 409 Conflict immediately | The subtitle already exists. Jellyfin may just need a library scan. |

---

## License

MIT
