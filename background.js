/**
 * background.js  v7
 *
 * Changes from v6:
 *  1. Title cleaning — strips "· VIDEO · 15 MIN · PREREQUISITE" Thinkific metadata
 *  2. Numbering — clean 001_Title_Name.mp4 format
 *  3. saveAs:false — works when Chrome's "Ask where to save" is OFF (see popup notice)
 *  4. Pause / Resume fully functional with clear state
 */

const WISTIA_DELIVERY_RE = /^https?:\/\/[^/]*wistia\.(com|net)\/deliveries\/([a-f0-9]{30,})(\.m3u8|\.bin|\.mp4|\.webm)?(\?.*)?$/i;
const DIRECT_VIDEO_RE    = /^https?:\/\/.*\.(mp4|webm|m4v|mov)(\?.*)?$/i;
const DIRECT_VIDEO_DOMAINS = [
  'bunnycdn.com','b-cdn.net','mediadelivery.net',
  'vimeocdn.com','vimeo.com','cloudfront.net','amazonaws.com'
];

// ─── State ────────────────────────────────────────────────────────────────────
let state = {
  isRunning:        false,
  isPaused:         false,
  currentIndex:     0,
  total:            0,
  courseTitle:      '',
  queue:            [],
  courseTabId:      null,
  downloaded:       [],
  skipped:          [],
  errors:           [],
  log:              [],
  pendingItem:      null,
  waitingForVideo:  false,
  lastCapturedUrl:  '',
};

let lessonTimeout = null;
let advanceTimer  = null;
const activeDownloads = new Map();

// ─── webRequest interceptor ───────────────────────────────────────────────────
chrome.webRequest.onBeforeRequest.addListener(
  (details) => {
    if (!state.isRunning || !state.waitingForVideo) return;
    if (details.tabId !== state.courseTabId) return;

    const url = details.url;

    // Wistia HLS / delivery URL
    const wm = url.match(WISTIA_DELIVERY_RE);
    if (wm) {
      if (url.includes('/formats/')) return; // skip quality-probe requests
      const hash   = wm[2];
      const ext    = (wm[3] || '').toLowerCase();
      const mp4Url = `https://embed-cloudfront.wistia.com/deliveries/${hash}.mp4`;
      onVideoFound(mp4Url, `wistia${ext || '.m3u8'}→.mp4`);
      return;
    }

    // Direct CDN video
    if (DIRECT_VIDEO_RE.test(url)) {
      try {
        const host = new URL(url).hostname;
        if (DIRECT_VIDEO_DOMAINS.some(d => host === d || host.endsWith('.' + d))) {
          onVideoFound(url, 'direct-cdn');
        }
      } catch {}
    }
  },
  { urls: ['<all_urls>'] }
);

// ─── Download status tracking ─────────────────────────────────────────────────
chrome.downloads.onChanged.addListener((delta) => {
  if (!activeDownloads.has(delta.id)) return;
  const fname = activeDownloads.get(delta.id);

  if (delta.error) {
    const err = delta.error.current || 'unknown';
    addLog('err', `❌ FAILED "${fname}": ${err}`);
    if (err === 'USER_CANCELED') {
      addLog('err', '   → Chrome "Ask where to save" is ON. See the notice in the popup.');
    }
    activeDownloads.delete(delta.id);
  } else if (delta.state?.current === 'complete') {
    addLog('dl', `✅ Saved: ${fname}`);
    activeDownloads.delete(delta.id);
  } else if (delta.filename?.current) {
    addLog('info', `💾 Writing: ${delta.filename.current.split(/[/\\]/).pop()}`);
  }
  broadcastState();
});

// ─── Message handler ──────────────────────────────────────────────────────────
chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  (async () => {
    switch (msg.type) {

      case 'START_DOWNLOADS':
        clearTimers();
        activeDownloads.clear();
        state = {
          isRunning: true, isPaused: false,
          currentIndex: 0, total: msg.queue.length,
          courseTitle: msg.courseTitle,
          queue: msg.queue, courseTabId: msg.tabId,
          downloaded: [], skipped: [], errors: [], log: [],
          pendingItem: null, waitingForVideo: false, lastCapturedUrl: '',
        };
        addLog('info', `▶ Starting ${state.total} lessons — "${state.courseTitle}"`);
        addLog('info', `📁 Saving to: Downloads/${sanitize(state.courseTitle)}/`);
        broadcastState();
        processNext();
        sendResponse({ ok: true });
        break;

      case 'PAUSE':
        clearTimers();
        state.isPaused = true;
        state.waitingForVideo = false;
        addLog('info', '⏸ Paused — click Resume to continue');
        broadcastState();
        sendResponse({ ok: true });
        break;

      case 'RESUME':
        if (!state.isPaused) { sendResponse({ ok: true }); break; }
        state.isPaused = false;
        addLog('info', '▶ Resumed');
        broadcastState();
        processNext();
        sendResponse({ ok: true });
        break;

      case 'STOP':
        clearTimers();
        state.isRunning = false; state.isPaused = false; state.waitingForVideo = false;
        addLog('info', '⏹ Stopped');
        broadcastState();
        sendResponse({ ok: true });
        break;

      case 'GET_STATE':
        sendResponse({ ...state }); break;

      case 'PAGE_READY': {
        if (!state.isRunning || !state.waitingForVideo) { sendResponse({ ok: true }); break; }
        const fromTab = sender.tab?.id;
        if (fromTab && fromTab !== state.courseTabId) { sendResponse({ ok: true }); break; }
        clearTimers();
        lessonTimeout = setTimeout(onLessonTimeout, 25000);
        addLog('info', `📄 Loaded: ${state.pendingItem?.lessonTitle}`);
        // Auto-click play after ~2s for Wistia to initialise
        setTimeout(() => clickPlay(state.courseTabId), 2200);
        setTimeout(() => clickPlay(state.courseTabId), 4500);
        sendResponse({ ok: true }); break;
      }

      case 'SPA_NAVIGATE':
        sendResponse({ ok: true }); break;
    }
  })();
  return true;
});

// ─── Video found callback ─────────────────────────────────────────────────────
function onVideoFound(url, source) {
  if (!state.waitingForVideo || !state.pendingItem) return;
  if (state.lastCapturedUrl) return; // already captured one for this lesson

  state.lastCapturedUrl = url;
  addLog('info', `🎯 Captured (${source}): …${url.slice(-50)}`);
  clearTimers();
  state.waitingForVideo = false;
  broadcastState();

  downloadVideo(url, state.pendingItem).then(() => {
    scheduleAdvance(3500);
  });
}

// ─── Core loop ────────────────────────────────────────────────────────────────
async function processNext() {
  if (!state.isRunning || state.isPaused) return;
  if (state.currentIndex >= state.queue.length) { await finish(); return; }

  const item = state.queue[state.currentIndex];
  state.pendingItem     = item;
  state.waitingForVideo = true;
  state.lastCapturedUrl = '';
  broadcastState();

  addLog('info', `[${state.currentIndex + 1}/${state.total}] → ${item.lessonTitle}`);

  try {
    await chrome.tabs.update(state.courseTabId, { url: item.url, active: true });
  } catch (e) {
    addLog('err', `Navigation failed: ${e.message}`);
    skipLesson(item, 'Tab navigation failed');
    scheduleAdvance(2000);
    return;
  }

  lessonTimeout = setTimeout(onLessonTimeout, 35000);
}

function onLessonTimeout() {
  lessonTimeout = null;
  if (!state.pendingItem || !state.isRunning) return;
  const item = state.pendingItem;
  state.waitingForVideo = false;
  addLog('skip', `[—] No video on "${cleanTitle(item.lessonTitle)}" — skipping`);
  skipLesson(item, 'No video intercepted (text/quiz lesson)');
  scheduleAdvance(2000);
}

// ─── Download ─────────────────────────────────────────────────────────────────
async function downloadVideo(videoUrl, item) {
  // Pad number: 001, 002, ... 099, 100, ...
  const num   = String(state.currentIndex + 1).padStart(3, '0');
  const title = sanitize(cleanTitle(item.lessonTitle));
  const short = `${num}_${title}.mp4`;
  const fname = `${sanitize(state.courseTitle)}/${short}`;

  addLog('dl', `⬇ ${short}`);

  try {
    const dlId = await chrome.downloads.download({
      url:            videoUrl,
      filename:       fname,
      conflictAction: 'uniquify',
      saveAs:         false,      // ← requires Chrome "Ask where to save" = OFF
    });
    if (typeof dlId === 'number') {
      activeDownloads.set(dlId, short);
      state.downloaded.push(short);
      addLog('info', `📥 Queued id=${dlId}`);
    } else {
      throw new Error('No download ID');
    }
  } catch (e) {
    const reason = e.message || String(e);
    addLog('err', `❌ ${reason}`);
    addLog('err', `   URL: ${videoUrl.substring(0, 80)}`);
    state.errors.push({ lesson: item.lessonTitle, reason });
  }
  broadcastState();
}

// ─── Title cleaner ────────────────────────────────────────────────────────────
// Strips Thinkific sidebar metadata: "· VIDEO · 15 MIN · PREREQUISITE"
function cleanTitle(raw) {
  return (raw || '')
    .replace(/\s*[·•].*$/, '')   // remove everything from first · onwards
    .replace(/\s{2,}/g, ' ')
    .trim() || 'Untitled';
}

function skipLesson(item, reason) {
  state.skipped.push(item.lessonTitle);
  if (!state.errors.find(e => e.lesson === item.lessonTitle))
    state.errors.push({ lesson: item.lessonTitle, reason });
}

function scheduleAdvance(delay) {
  advanceTimer = setTimeout(() => {
    advanceTimer = null;
    state.currentIndex++;
    state.pendingItem = null;
    state.waitingForVideo = false;
    broadcastState();
    processNext();
  }, delay);
}

async function finish() {
  state.isRunning = false; state.waitingForVideo = false;
  addLog('info', `🎉 Done! ${state.downloaded.length} downloaded, ${state.skipped.length} skipped.`);
  broadcastState();
  chrome.notifications?.create('tdl-done', {
    type: 'basic', iconUrl: 'icons/icon48.png',
    title: 'Thinkific DL — Complete!',
    message: `${state.downloaded.length} video(s) saved to Downloads/${sanitize(state.courseTitle)}/`
  });
}

// ─── Auto-click play ──────────────────────────────────────────────────────────
async function clickPlay(tabId) {
  if (!tabId || !state.isRunning || state.isPaused) return;
  try {
    await chrome.scripting.executeScript({
      target: { tabId },
      func: () => {
        const selectors = [
          '.w-vulcan-v2-button',
          '[class*="WistiaPlayButton"]',
          '.wistia_click_to_play',
          '[aria-label="Play"]',
          '[aria-label="Play Video"]',
          'button[class*="play" i]',
          '[class*="PlayButton"]',
          'video',
        ];
        for (const sel of selectors) {
          const el = document.querySelector(sel);
          if (!el) continue;
          if (el.tagName === 'VIDEO') { el.muted = true; el.play().catch(() => {}); }
          else el.click();
          return;
        }
        try {
          if (window.Wistia) {
            document.querySelectorAll('[class*="wistia_embed"]').forEach(el => {
              const cls = [...el.classList].find(c => /wistia_async_([a-z0-9]+)/i.test(c));
              if (!cls) return;
              const id = cls.match(/wistia_async_([a-z0-9]+)/i)[1];
              const p  = window.Wistia.api(id);
              if (p) p.play();
            });
          }
        } catch {}
      }
    });
  } catch {}
}

// ─── Helpers ─────────────────────────────────────────────────────────────────
function clearTimers() {
  if (lessonTimeout) { clearTimeout(lessonTimeout); lessonTimeout = null; }
  if (advanceTimer)  { clearTimeout(advanceTimer);  advanceTimer  = null; }
}
function addLog(type, text) {
  state.log.push({ type, text });
  if (state.log.length > 400) state.log.shift();
  broadcastState();
}
function broadcastState() {
  chrome.runtime.sendMessage({ type: 'STATE_UPDATE', state: { ...state } }).catch(() => {});
}
function sanitize(s) {
  return (s || 'untitled')
    .replace(/[<>:"/\\|?*\x00-\x1f]/g, '')
    .replace(/\s+/g, '_').replace(/_+/g, '_')
    .trim().substring(0, 80);
}
