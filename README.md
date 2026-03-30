# thinkific-video-downloader
A Chrome extension that automatically downloads all videos from any playlist in sequence — fully hands-free, no manual clicking required.
Works like Video DownloadHelper but fully automated: intercepts Wistia HLS network requests at the browser level and converts them to direct MP4 downloads.

**Features:**
🎯 Network-level interception — captures Wistia .m3u8 HLS requests before page JavaScript runs
📂 Auto-numbered filenames — saves as 001_Lesson_Title.mp4, 002_Lesson_Title.mp4, etc.
⏸ Pause / Resume — stop and continue at any time without losing progress
⏭ Auto-skips text, quiz, and non-video lessons
📁 Organized folders — all videos saved inside Downloads/<Course_Title>/

**Installation**
This extension is not on the Chrome Web Store. Install it in Developer Mode.

1. Download the latest release and unzip it
2. Open Chrome → go to chrome://extensions/
3. Enable Developer Mode (toggle, top-right corner)
4. Click Load unpacked → select the unzipped thinkific-downloader folder
5. The extension icon appears in your toolbar

One-time Chrome Setting (Required)
Go to chrome://settings/downloads → turn OFF "Ask where to save each file before downloading"
