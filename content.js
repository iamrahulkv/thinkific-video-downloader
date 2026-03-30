/**
 * content.js  v6
 * Signals PAGE_READY to background so it starts the 25s interception window.
 * Also extracts the curriculum and exposes it for the popup scan.
 * No page-interceptor injection needed — webRequest handles detection.
 */
(function () {
  'use strict';

  // ── PAGE_READY signal ─────────────────────────────────────────────────────
  let lastUrl = location.href;
  let readyTimer = null;

  function scheduleReady() {
    if (readyTimer) clearTimeout(readyTimer);
    // Wait 1.5s for SPA to settle before signalling
    readyTimer = setTimeout(() => {
      chrome.runtime.sendMessage({ type: 'PAGE_READY', url: location.href }).catch(() => {});
    }, 1500);
  }

  // Initial signal
  if (document.readyState === 'complete') scheduleReady();
  else window.addEventListener('load', scheduleReady);

  // SPA navigation watcher (Thinkific is a React SPA)
  new MutationObserver(() => {
    if (location.href !== lastUrl) {
      lastUrl = location.href;
      scheduleReady();
    }
  }).observe(document.body || document.documentElement, { childList: true, subtree: true });

  // ── Curriculum extractor ──────────────────────────────────────────────────
  window.__thinkificGetCurriculum = function () {
    const lessons = [];
    let idx = 0;

    // Strategy A: data-testid (modern Thinkific)
    const chapters = document.querySelectorAll('[data-testid="chapter"]');
    if (chapters.length > 0) {
      chapters.forEach(ch => {
        const sTitle = ch.querySelector('[data-testid="chapter-name"]')?.innerText?.trim() || '';
        ch.querySelectorAll('a[href*="/courses/take/"]').forEach(a => {
          if (!lessons.some(l => l.url === a.href))
            lessons.push({ index: idx++, sectionTitle: sTitle, lessonTitle: a.innerText.trim() || `Lesson ${idx}`, url: a.href });
        });
      });
    }

    // Strategy B: class-based selectors
    if (lessons.length === 0) {
      document.querySelectorAll('[class*="chapter" i], [class*="section" i]').forEach(sec => {
        const sTitle = sec.querySelector('h2,h3,[class*="name" i],[class*="title" i]')?.innerText?.trim() || '';
        sec.querySelectorAll('a[href*="/courses/take/"]').forEach(a => {
          if (!lessons.some(l => l.url === a.href))
            lessons.push({ index: idx++, sectionTitle: sTitle, lessonTitle: a.innerText.trim() || `Lesson ${idx}`, url: a.href });
        });
      });
    }

    // Strategy C: all course links
    if (lessons.length === 0) {
      const seen = new Set();
      document.querySelectorAll('a[href*="/courses/take/"]').forEach(a => {
        if (seen.has(a.href)) return;
        if (a.closest('[class*="nav" i],[class*="button" i],[class*="pagination" i]')) return;
        seen.add(a.href);
        lessons.push({ index: idx++, sectionTitle: '', lessonTitle: a.innerText.trim() || `Lesson ${idx}`, url: a.href });
      });
    }

    const courseTitle =
      document.querySelector('[data-testid="course-name"],[class*="course-title" i],[class*="CourseName"],.course-sidebar__title')?.innerText?.trim() ||
      document.querySelector('h1')?.innerText?.trim() || 'Thinkific_Course';

    return { lessons, courseTitle };
  };

})();
