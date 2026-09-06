// Discovery-parser: reads Amazon's Zeitgeist Best Sellers / Movers & Shakers /
// New Releases pages. These are client-rendered in a real tab, so unlike a
// fetch-from-service-worker they render fully here. The grid posts via
// MutationObserver + poll and reports exactly once to the background worker,
// which closes the tab through the scrape queue.

(() => {
  const m = location.pathname.match(/^\/gp\/(bestsellers|movers-and-shakers|new-releases)\//);
  if (!m) return;
  const KIND = m[1];

  const MAX_TITLE_LEN = 120;
  const CAP = 60;

  function isBlockedPage() {
    const text = (document.body && document.body.textContent) || '';
    return (
      /Enter the characters you see below|helps protect our website|automated access|unusual traffic/i.test(text)
    );
  }

  const GRID_SELECTOR =
    'div[id^="gridItemRoot"], div[id*="gridItemRoot"], ' +
    'div.zg-grid-general-faceout, div.p13n-sc-uncoverable-faceout';

  function parseRank(anchor) {
    const item =
      anchor.closest('[id^="gridItemRoot"], [id*="gridItemRoot"], .zg-grid-general-faceout') ||
      anchor.closest(GRID_SELECTOR) ||
      anchor;
    const badge = item && item.querySelector('.zg-bdg-text, span[class*="zg-rank"], ._cDEzb_zg-bdg-text');
    return badge ? parseInt((badge.textContent || '').replace(/[^\d]/g, ''), 10) || null : null;
  }

  function extractFaceouts() {
    const out = [];
    const seen = new Set();

    const anchors = document.querySelectorAll(
      `${GRID_SELECTOR} a[href*="/dp/"], a[href*="/dp/"]`
    );
    anchors.forEach((a) => {
      const href = a.getAttribute('href') || '';
      const mm = href.match(/\/dp\/([A-Z0-9]{10})/);
      if (!mm) return;
      const asin = mm[1];
      if (seen.has(asin)) return;
      seen.add(asin);

      const item =
        a.closest('[id^="gridItemRoot"], [id*="gridItemRoot"], .zg-grid-general-faceout') ||
        a.parentElement ||
        a;

      let title = (a.getAttribute('title') || a.getAttribute('aria-label') || '').trim();
      if (!title) {
        const clue = item.querySelector(
          'span[class*="p13n-sc-css-line-clamp"], div[class*="p13n-sc-css-line-clamp"], ' +
            '._cDEzb_p13n-sc-css-line-clamp, span.p13n-sc-truncate, h3, .a-link-normal'
        );
        title = clue ? (clue.textContent || '').trim() : '';
      }
      if (!title && item) {
        const img = item.querySelector('img[alt]');
        title = img ? (img.getAttribute('alt') || '').trim() : '';
      }
      if (!title || title.length > 200) return;

      out.push({ asin, title: title.slice(0, MAX_TITLE_LEN), rank: parseRank(a) });
    });

    return out.slice(0, CAP);
  }

  function deliver(faceouts) {
    chrome.runtime.sendMessage({
      type: 'DISCOVERY_PARSED',
      payload: {
        url: location.href,
        kind: KIND,
        faceouts,
        blocked: isBlockedPage()
      }
    }).catch(() => {});
  }

  let sent = false;
  function trySend() {
    if (sent) return;
    const faces = extractFaceouts();
    if (faces.length >= 5) {
      sent = true;
      deliver(faces);
      return;
    }
  }

  // Client-rendered list: watch the container until it populates.
  if (window.MutationObserver && document.body) {
    const obs = new MutationObserver(
      debounce(() => trySend(), 350)
    );
    obs.observe(document.body, { childList: true, subtree: true });
    setTimeout(() => obs.disconnect(), 30000);
  }

  // Bounded poll as a safety net, and a final fire-and-forget delivery.
  let polls = 0;
  const iv = setInterval(() => {
    polls++;
    if (sent) return clearInterval(iv);
    trySend();
    if (polls > 50) {
      clearInterval(iv);
      if (!sent) {
        sent = true;
        deliver(extractFaceouts());
      }
    }
  }, 400);

  function debounce(fn, ms) {
    let t;
    return (...args) => {
      clearTimeout(t);
      t = setTimeout(() => fn(...args), ms);
    };
  }

  window.addEventListener('load', trySend);
  trySend();
})();