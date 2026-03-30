const $ = id => document.getElementById(id);
const VIEWS = ['vDetect','vCourse','vDl','vDone'];
function show(v) { VIEWS.forEach(x => $(x).classList.remove('active')); $(v).classList.add('active'); }

let curriculum = null;
let logLen = 0;
let isPaused = false;

// ── Init ──────────────────────────────────────────────────────────────────────
document.addEventListener('DOMContentLoaded', async () => {
  // Show save-prompt warning if not dismissed
  const dismissed = await chrome.storage.local.get('warnDismissed');
  if (!dismissed.warnDismissed) $('saveWarn').classList.remove('hidden');

  const s = await bgGet();
  if (s?.isRunning || s?.isPaused) {
    isPaused = s.isPaused;
    applyState(s);
    show('vDl');
    updatePauseBtn(s.isPaused);
  } else if (s?.currentIndex >= s?.total && s?.total > 0) {
    applyState(s);
    show('vDone');
  } else {
    show('vDetect');
  }
});

// ── Warning banner ────────────────────────────────────────────────────────────
$('btnCloseWarn').onclick = async () => {
  $('saveWarn').classList.add('hidden');
  await chrome.storage.local.set({ warnDismissed: true });
};
$('btnFixSetting').onclick = (e) => {
  e.preventDefault();
  chrome.tabs.create({ url: 'chrome://settings/downloads' });
};

// ── Buttons ───────────────────────────────────────────────────────────────────
$('btnScan').onclick   = scanCourse;
$('btnRescan').onclick = () => { curriculum = null; show('vDetect'); };
$('btnStart').onclick  = startDownloads;
$('btnPause').onclick  = togglePause;
$('btnStop').onclick   = stopDownloads;
$('btnReset').onclick  = () => { curriculum = null; logLen = 0; isPaused = false; show('vDetect'); };

// ── Scan ──────────────────────────────────────────────────────────────────────
async function scanCourse() {
  hide('errScan');
  $('btnScan').disabled = true;
  $('btnScan').textContent = 'Scanning…';
  try {
    const tabs = await chrome.tabs.query({ url: 'https://*.thinkific.com/courses/take/*' });
    if (!tabs.length) {
      showErr('errScan', '⚠ No Thinkific course tab found.\nPlease open your course first.');
      return;
    }
    const tab = tabs[0];
    await chrome.scripting.executeScript({ target: { tabId: tab.id }, files: ['content.js'] }).catch(() => {});
    const res = await chrome.scripting.executeScript({
      target: { tabId: tab.id },
      func: () => typeof window.__thinkificGetCurriculum === 'function' ? window.__thinkificGetCurriculum() : null
    });
    const data = res?.[0]?.result;
    if (!data?.lessons?.length) {
      showErr('errScan', '⚠ Could not read curriculum.\nExpand the sidebar and try again.');
      return;
    }
    curriculum = { ...data, tabId: tab.id };
    renderCourse(data);
    show('vCourse');
  } catch (e) {
    showErr('errScan', '⚠ ' + e.message);
  } finally {
    $('btnScan').disabled = false;
    $('btnScan').innerHTML = '🔍 &nbsp;Scan Curriculum';
  }
}

// Clean Thinkific sidebar metadata from titles for display
function cleanForDisplay(title) {
  return (title || '').replace(/\s*[·•].*$/, '').replace(/\s{2,}/g, ' ').trim() || title;
}

function renderCourse({ lessons, courseTitle }) {
  $('cTitle').textContent  = courseTitle;
  $('cMeta').textContent   = `${lessons.length} lessons — ${lessons.filter(l => /video/i.test(l.lessonTitle)).length} video lessons detected`;
  $('folderPath').textContent = `Downloads / ${courseTitle} / 001_Lesson_Title.mp4`;

  const el = $('lessonList');
  el.innerHTML = '';
  lessons.forEach((l, i) => {
    const clean = cleanForDisplay(l.lessonTitle);
    el.insertAdjacentHTML('beforeend',
      `<div class="ll">
        <span class="ll-n">${String(i+1).padStart(3,'0')}</span>
        <div style="min-width:0">
          <div class="ll-t">${esc(clean)}</div>
          ${l.sectionTitle ? `<div class="ll-s">${esc(l.sectionTitle)}</div>` : ''}
        </div>
      </div>`);
  });
}

// ── Start ─────────────────────────────────────────────────────────────────────
async function startDownloads() {
  if (!curriculum) return;
  logLen = 0; isPaused = false;
  $('log').innerHTML = '';
  setPill('RUNNING', 'run');
  updatePauseBtn(false);
  await chrome.runtime.sendMessage({
    type: 'START_DOWNLOADS',
    queue: curriculum.lessons,
    courseTitle: curriculum.courseTitle,
    tabId: curriculum.tabId
  });
  $('dlCount').textContent = `0/${curriculum.lessons.length}`;
  $('dlLesson').textContent = 'Starting…';
  $('progBar').style.width = '0%';
  show('vDl');
}

// ── Pause / Resume — the key feature ─────────────────────────────────────────
async function togglePause() {
  if (isPaused) {
    // RESUME
    const r = await chrome.runtime.sendMessage({ type: 'RESUME' });
    if (r?.ok !== false) {
      isPaused = false;
      updatePauseBtn(false);
      setPill('RUNNING', 'run');
      $('dlLabel').textContent = 'DOWNLOADING';
      $('cfDot').className = 'cf-dot';
    }
  } else {
    // PAUSE
    const r = await chrome.runtime.sendMessage({ type: 'PAUSE' });
    if (r?.ok !== false) {
      isPaused = true;
      updatePauseBtn(true);
      setPill('PAUSED', 'pause');
      $('dlLabel').textContent = 'PAUSED';
      $('cfDot').className = 'cf-dot paused';
      $('cfText').textContent = 'Paused — click Resume to continue';
    }
  }
}

function updatePauseBtn(paused) {
  const btn = $('btnPause');
  if (paused) {
    btn.className = 'ctrl-btn resume';
    $('pauseIcon').textContent = '▶';
    $('pauseLabel').textContent = 'Resume';
  } else {
    btn.className = 'ctrl-btn pause';
    $('pauseIcon').textContent = '⏸';
    $('pauseLabel').textContent = 'Pause';
  }
}

// ── Stop ──────────────────────────────────────────────────────────────────────
async function stopDownloads() {
  await chrome.runtime.sendMessage({ type: 'STOP' });
  isPaused = false;
  setPill('IDLE', '');
  show('vCourse');
}

// ── State updates from background ─────────────────────────────────────────────
chrome.runtime.onMessage.addListener(msg => {
  if (msg.type === 'STATE_UPDATE') applyState(msg.state);
});

function applyState(s) {
  const cur = s.currentIndex || 0;
  const tot = s.total || 0;
  const pct = tot > 0 ? Math.round(cur / tot * 100) : 0;

  $('dlCount').textContent  = `${cur}/${tot}`;
  $('progBar').style.width  = pct + '%';

  const cleanLesson = cleanForDisplay(s.pendingItem?.lessonTitle || '—');
  $('dlLesson').textContent = cleanLesson;

  // Current file status
  if (!s.isPaused && s.waitingForVideo) {
    $('cfText').textContent = `Intercepting: ${cleanLesson}`;
    $('cfDot').className = 'cf-dot';
  } else if (s.isPaused) {
    $('cfText').textContent = 'Paused — click Resume to continue';
    $('cfDot').className = 'cf-dot paused';
  }

  // Sync pause state in case popup was reopened
  if (s.isPaused !== isPaused) {
    isPaused = s.isPaused;
    updatePauseBtn(isPaused);
  }

  // Append only new log entries
  const entries = s.log || [];
  if (entries.length > logLen) {
    const frag = document.createDocumentFragment();
    for (let i = logLen; i < entries.length; i++) {
      const e = entries[i];
      const tag = { dl:'[↓]', skip:'[—]', err:'[!]', info:'[i]' }[e.type] || '[i]';
      const div = document.createElement('div');
      div.className = 'lr ' + e.type;
      div.innerHTML = `<span class="tg">${tag}</span><span class="tx">${esc(e.text)}</span>`;
      frag.appendChild(div);
    }
    $('log').appendChild(frag);
    $('log').parentElement.scrollTop = 99999;
    logLen = entries.length;
  }

  // Show save-prompt warning if a USER_CANCELED error appeared
  const hasCancel = (s.log || []).some(e => e.text?.includes('USER_CANCELED'));
  if (hasCancel) $('saveWarn').classList.remove('hidden');

  // Finished
  if (!s.isRunning && !s.isPaused && cur >= tot && tot > 0) showDone(s);
}

function showDone(s) {
  setPill('DONE', 'done');
  show('vDone');
  $('doneMeta').textContent  = `${s.downloaded.length} video(s) downloaded`;
  $('doneFolder').textContent = `📁 Downloads / ${s.courseTitle || '…'}`;

  const realErrors = (s.errors || []).filter(e => !e.reason.includes('No video'));
  const skipCount  = (s.errors || []).filter(e =>  e.reason.includes('No video')).length;
  if (realErrors.length) {
    $('errBox').classList.remove('hidden');
    $('errList').innerHTML =
      realErrors.map(e => `<div class="ei"><strong>${esc(e.lesson)}</strong>: ${esc(e.reason)}</div>`).join('') +
      (skipCount ? `<div class="ei" style="margin-top:6px;color:var(--t3)">${skipCount} text/quiz lesson(s) skipped — normal</div>` : '');
  }
}

// ── Helpers ───────────────────────────────────────────────────────────────────
async function bgGet() { return chrome.runtime.sendMessage({ type: 'GET_STATE' }).catch(() => null); }
function esc(s) { return String(s||'').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;'); }
function showErr(id, msg) { $(id).textContent = msg; $(id).classList.remove('hidden'); }
function hide(id) { $(id).classList.add('hidden'); }
function setPill(label, cls) {
  const p = $('pill');
  p.textContent = label;
  p.className = 'pill' + (cls ? ' ' + cls : '');
}
