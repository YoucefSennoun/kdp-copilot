/**
 * Discovery Mode fetcher (Phase 4): reads Amazon's public Best Sellers /
 * Movers & Shakers / New Releases pages without a search query. These pages
 * are server-rendered, so plain fetches from the service worker (host
 * permissions already granted) are enough — no tabs or content scripts needed.
 */

const UA =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36';

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export function extractFaceouts(doc) {
  const out = [];
  const seen = new Set();
  const anchors = doc.querySelectorAll(
    'div.p13n-sc-uncoverable-faceout a.a-link-normal, ' +
    'div[id^="gridItemRoot"] a.a-link-normal, ' +
    'div[data-component-type="ProductList"] a.a-link-normal, ' +
    'a[href*="/dp/"]'
  );
  anchors.forEach((a) => {
    const href = a.getAttribute('href') || '';
    const m = href.match(/\/dp\/([A-Z0-9]{10})/);
    if (!m) return;
    const asin = m[1];
    if (seen.has(asin)) return;
    seen.add(asin);
    const title = (a.getAttribute('title') || a.getAttribute('aria-label') || a.textContent || '').trim();
    if (!title) return;
    out.push({ asin, title });
  });
  return out;
}

/**
 * Turn a marketplace title into a low-noise keyword-like seed.
 *
 * Rule 8 (v0.8 fix): content-FAMILY words (journal, planner, notebook, log,
 * coloring book, activity book, puzzle, …) are the niche itself and must be
 * PRESERVED — stripping them turned "Gratitude Journal for Women" into the
 * meaningless "gratitude for women". Only packaging is stripped: edition /
 * format labels, franchise tie-in markers, series numbering, and trailing
 * "by Author" suffixes. Fiction markers ("a novel") are KEPT so the
 * content-type classifier can exclude them before they reach the scraper.
 */
export function cleanTitleToKeyword(title) {
  let t = String(title || '')
    .replace(/\(.*?\)/g, ' ')
    .replace(/\[[^\]]*\]/g, ' ')
    .replace(/\b(paperback|hardcover|kindle edition|kindle|audible audiobook|audible|audio cd|audiobook|box set|boxed set|mp3 cd|unknown binding|large print|spiral-bound|board book edition)\b/gi, ' ')
    .replace(/\b(an unofficial|unofficial|official|companion|video game|movie tie-in|tv tie-in|film tie-in|netflix tie-in)\b/gi, ' ')
    .replace(/\b(book one|book two|book three|book 1|book 2|book 3|volume 1|volume 2|vol\.?\s*\d+|series|trilogy|collection|anthology|boxset)\b/gi, ' ')
    .replace(/\s+by\s+[A-Z][\w\s.'-]+$/i, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .replace(/^[^a-z0-9]+|[^a-z0-9]+$/gi, '')
    .toLowerCase();
  // Keep only useful keyword-length phrases (2-8 words).
  const words = t.split(/\s+/).filter(Boolean);
  if (words.length < 2 || words.length > 8) return '';
  return words.join(' ');
}

/**
 * Fetch a discovery list page and extract distinct { asin, title } faceouts.
 * Fails loudly on CAPTCHA/block so the caller can skip and log rather than
 * silently scoring poisoned data (Phase 7).
 */
export async function fetchListPage(url) {
  for (let attempt = 1; attempt <= 2; attempt++) {
    const res = await fetch(url, {
      headers: { 'User-Agent': UA, 'Accept-Language': 'en-US,en;q=0.9' },
      credentials: 'omit'
    });
    if (!res.ok) throw new Error(`Discovery fetch ${res.status}`);
    const html = await res.text();
    if (/Enter the characters you see below|helps protect our website|unusual traffic/i.test(html.slice(0, 30000))) {
      throw new Error('Discovery blocked (CAPTCHA)');
    }
    const doc = new DOMParser().parseFromString(html, 'text/html');
    const faceouts = extractFaceouts(doc);
    if (faceouts.length) return faceouts;
    if (attempt === 1) await sleep(1200);
  }
  throw new Error('No product links parsed');
}

export function isDiscoveryUrl(url) {
  return /\/gp\/(bestsellers|movers-and-shakers|new-releases)/.test(url || '');
}