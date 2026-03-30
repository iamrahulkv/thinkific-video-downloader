# Thinkific Video Auto-Downloader

A Chrome extension that **automatically downloads all video lessons** from any playlist in sequence — fully hands-free, no manual clicking required.

> Works like [Video DownloadHelper](https://www.downloadhelper.net/) but fully automated: intercepts Wistia HLS network requests at the browser level and converts them to direct MP4 downloads.

![Version](https://img.shields.io/badge/version-7.0.0-green)
![Manifest](https://img.shields.io/badge/manifest-v3-blue)
![License](https://img.shields.io/badge/license-MIT-orange)

---

## Features

- 🎯 **Network-level interception** — captures Wistia `.m3u8` HLS requests before page JavaScript runs
- 📂 **Auto-numbered filenames** — saves as `001_Lesson_Title.mp4`, `002_Lesson_Title.mp4`, etc.
- ⏸ **Pause / Resume** — stop and continue at any time without losing progress
- ⏭ **Auto-skips** text, quiz, and non-video lessons
- 📁 **Organized folders** — all videos saved inside `Downloads/<Course_Title>/`
- 🔁 **SPA-aware** — handles Thinkific's React single-page navigation correctly

---

## Installation

> This extension is not on the Chrome Web Store. Install it in **Developer Mode**.

1. [Download the latest release](../../releases/latest) and unzip it
2. Open Chrome → go to `chrome://extensions/`
3. Enable **Developer Mode** (toggle, top-right corner)
4. Click **Load unpacked** → select the unzipped `thinkific-downloader` folder
5. The extension icon appears in your toolbar

### One-time Chrome Setting (Required)

Go to `chrome://settings/downloads` → turn OFF **"Ask where to save each file before downloading"**

---

## How to Use

1. Log in and open your Thinkific course tab
2. Click the extension icon → **Scan Curriculum**
3. Review the lesson list → **▶ Start Download**
4. Use **⏸ Pause** / **▶ Resume** as needed

---

## How It Works

```
Wistia player requests HLS stream:
  embed-cloudfront.wistia.com/deliveries/{hash}.m3u8
          ↓
chrome.webRequest intercepts before page JS runs
          ↓
Extension converts to direct MP4:
  embed-cloudfront.wistia.com/deliveries/{hash}.mp4
          ↓
Saved as: Downloads/<Course>/001_Lesson_Title.mp4
```

---

## File Structure

```
thinkific-downloader/
├── manifest.json     # Chrome Extension Manifest v3
├── background.js     # Service worker: webRequest + download queue
├── content.js        # Curriculum extractor + page signal
├── popup.html/css/js # Extension UI
└── icons/
```

---

## Contributing

Pull requests are welcome. Please open an issue first for major changes.

---

## Disclaimer

For **personal use only** — for course videos you have legitimately purchased. Respect the platform's terms of service.

---

## License

MIT License — see [LICENSE](LICENSE) for details.
