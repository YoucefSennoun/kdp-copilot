(() => {
  const m =
    location.pathname.match(/^\/dp\/([A-Z0-9]{10})/) ||
    location.pathname.match(/^\/gp\/product\/([A-Z0-9]{10})/) ||
    location.pathname.match(/^\/gp\/aw\/d\/([A-Z0-9]{10})/);
  if (!m) return;

  const asin = m[1];

  // Marketplace code from the hostname — needed to parse the locale-formatted
  // "Publication date" (rules v1, rule 1).
  const MARKET_BY_HOST = {
    'www.amazon.com': 'us',
    'www.amazon.co.uk': 'uk',
    'www.amazon.de': 'de',
    'www.amazon.fr': 'fr',
    'www.amazon.it': 'it',
    'www.amazon.es': 'es',
    'www.amazon.ca': 'ca',
    'www.amazon.co.jp': 'jp',
    'www.amazon.com.au': 'au',
    'www.amazon.com.mx': 'mx',
    'www.amazon.com.br': 'br',
    'www.amazon.in': 'in',
    'www.amazon.nl': 'nl',
    'www.amazon.se': 'se',
    'www.amazon.pl': 'pl',
    'www.amazon.com.tr': 'tr',
    'www.amazon.sa': 'sa',
    'www.amazon.ae': 'ae',
    'www.amazon.sg': 'sg',
    'www.amazon.eg': 'eg'
  };

  function marketCode() {
    return MARKET_BY_HOST[location.hostname] || 'us';
  }

  // Month names for every marketplace language (rules v1, rule 1: pub dates
  // render in the market's locale, and Date.parse fails on most of them).
  const MONTHS = {
    en: ['january', 'february', 'march', 'april', 'may', 'june', 'july',
      'august', 'september', 'october', 'november', 'december'],
    de: ['januar', 'februar', 'märz', 'maerz', 'april', 'mai', 'juni', 'juli',
      'august', 'september', 'oktober', 'november', 'dezember'],
    fr: ['janvier', 'février', 'fevrier', 'mars', 'avril', 'mai', 'juin',
      'juillet', 'août', 'aout', 'septembre', 'octobre', 'novembre', 'décembre', 'decembre'],
    it: ['gennaio', 'febbraio', 'marzo', 'aprile', 'maggio', 'giugno', 'luglio',
      'agosto', 'settembre', 'ottobre', 'novembre', 'dicembre'],
    es: ['enero', 'febrero', 'marzo', 'abril', 'mayo', 'junio', 'julio',
      'agosto', 'septiembre', 'setiembre', 'octubre', 'noviembre', 'diciembre'],
    pt: ['janeiro', 'fevereiro', 'março', 'marco', 'abril', 'maio', 'junho', 'julho',
      'agosto', 'setembro', 'septembro', 'outubro', 'novembro', 'dezembro'],
    ja: ['1月', '2月', '3月', '4月', '5月', '6月', '7月', '8月', '9月', '10月', '11月', '12月']
  };
  const MARKET_LANG = {
    us: 'en', uk: 'en', ca: 'en', au: 'en',
    de: 'de', fr: 'fr', it: 'it', es: 'es', mx: 'es',
    jp: 'ja', br: 'pt'
  };

  function epochUtc(y, mo, d) {
    if (mo < 1 || mo > 12 || d < 1 || d > 31) return null;
    return Date.UTC(y, mo - 1, d);
  }

  function monthIndexForToken(token) {
    const t = String(token || '').toLowerCase().replace(/\./g, '');
    for (const lang of Object.keys(MONTHS)) {
      const idx = MONTHS[lang].indexOf(t);
      if (idx !== -1) return idx;
    }
    return null;
  }

  function parsePubDate(text, market) {
    const raw = String(text || '').trim();
    if (!raw) return null;

    const iso = raw.match(/(\d{4})-(\d{1,2})-(\d{1,2})/);
    if (iso) return epochUtc(+iso[1], +iso[2], +iso[3]);

    const jp = raw.match(/(\d{4})年\s*(\d{1,2})月\s*(\d{1,2})日/);
    if (jp) return epochUtc(+jp[1], +jp[2], +jp[3]);

    const monthName =
      raw.match(/([A-Za-zÀ-ÿ]+)\.?\s*(\d{1,2})\s*(?:st|nd|rd|th)?\s*,?\s*(\d{4})/) ||
      raw.match(/(\d{1,2})\s*\.?\s*([A-Za-zÀ-ÿ]+)\.?\s*(\d{4})/);
    if (monthName) {
      const token = /^\d/.test(monthName[1]) ? monthName[2] : monthName[1];
      const day = /^\d/.test(monthName[1]) ? +monthName[1] : +monthName[2];
      const year = +monthName[3];
      const idx = monthIndexForToken(token);
      if (idx != null) return epochUtc(year, idx + 1, day);
    }

    const num = raw.match(/(\d{1,2})[/.](\d{1,2})[/.](\d{4})/);
    if (num) {
      const a = +num[1], b = +num[2], y = +num[3];
      const monthFirst = ['us', 'ca', 'au'].includes((market || '').toLowerCase());
      return epochUtc(y, monthFirst ? a : b, monthFirst ? b : a);
    }

    const yearOnly = raw.match(/^(\d{4})$/);
    if (yearOnly) return epochUtc(+yearOnly[1], 1, 1);

    const native = Date.parse(raw);
    return Number.isNaN(native) ? null : native;
  }

  function parseCurrency(text) {
    const match = (text || '').match(/[\d,]+(\.\d+)?/);
    return match ? parseFloat(match[0].replace(/,/g, '')) : null;
  }

  function parseNumber(text) {
    const match = (text || '').match(/[\d,.]+/);
    return match ? parseFloat(match[0].replace(/,/g, '')) : null;
  }

  function isBlockedPage() {
    const text = (document.body && document.body.textContent) || '';
    return (
      /Enter the characters you see below|helps protect our website|automated access|unusual traffic/i.test(text)
    );
  }

  function getTitle() {
    const el = document.querySelector('#productTitle') || document.querySelector('h1');
    return el ? el.textContent.trim() : '';
  }

  function getPrice() {
    const el =
      document.querySelector('#corePrice_feature_div .a-offscreen') ||
      document.querySelector('.a-price .a-offscreen');
    return parseCurrency(el ? el.textContent : null);
  }

  function getReviews() {
    const el =
      document.querySelector('#acrCustomerReviewText') ||
      document.querySelector('a[data-hook="total-review-count"] span') ||
      document.querySelector('#acrCustomerReviewLink span');
    return parseNumber(el ? el.textContent : null) || 0;
  }

  function getRating() {
    const el =
      document.querySelector('#acrPopover') ||
      document.querySelector('span[data-hook="rating-out-of-text"]') ||
      document.querySelector('i[data-hook="average-star-rating"]');
    const text = el ? el.textContent || el.getAttribute('aria-label') || '' : '';
    const match = text.match(/(\d(\.\d)?)/);
    return match ? parseFloat(match[1]) : null;
  }

  function getBsr() {
    const rows = document.querySelectorAll(
      '#productDetails_detailBullets_sections1 tr, #detailBullets_feature_div li li'
    );
    const found = [];
    for (const row of rows) {
      const txt = row.textContent || '';
      if (/Best Sellers Rank/i.test(txt)) {
        const rankText = txt.replace(/Best Sellers Rank\s*/i, '');
        const ranks = rankText.match(/#([\d,]+)(?:[^\d]*(in\s+[^,.#]+))?/g) || [];
        ranks.forEach((r) => {
          const rankMatch = r.match(/#([\d,]+)/);
          const catMatch = r.match(/in\s+(.+)$/);
          const rank = rankMatch ? parseInt(rankMatch[1].replace(/,/g, ''), 10) : null;
          if (rank) {
            found.push({ rank, category: catMatch ? catMatch[1].trim().replace(/\.$/, '') : null });
          }
        });
      }
    }
    return found.length ? found : null;
  }

  function getPublicationData() {
    const rows = document.querySelectorAll(
      '#productDetails_detailBullets_sections1 tr, #detailBullets_feature_div li li'
    );
    const data = { author: null, publisher: null, language: null, pages: null, pubDate: null, isbn: null };
    for (const row of rows) {
      const txt = row.textContent || '';
      const label = /^(Author|Publisher|Language|Print length|Publication date|ISBN|ASIN):?\s*/i;
      const mm = txt.match(label);
      if (!mm) continue;
      const value = txt.replace(label, '').trim().replace(/\s+\(.*?\)\s*$/, '').split(':')[0].trim();
      const key = mm[1].toLowerCase().replace(/\s/g, '');
      if (key === 'author') data.author = value;
      else if (key === 'publisher') data.publisher = value;
      else if (key === 'language') data.language = value;
      else if (key === 'printlength') data.pages = parseInt(value) || null;
      else if (key === 'publicationdate') data.pubDate = value;
      else if (key === 'isbn') data.isbn = value;
    }
    return data;
  }

  function getFormats() {
    const formats = new Set();
    const text = document.body ? document.body.textContent : '';
    if (text.includes('Kindle')) formats.add('kindle');
    if (/\bPaperback\b/.test(text)) formats.add('paperback');
    if (/\bHardcover\b/.test(text)) formats.add('hardcover');
    if (/\bAudible\b|\bAudiobook\b/i.test(text)) formats.add('audible');
    return [...formats];
  }

  function getCategoryBreadcrumb() {
    const links = document.querySelectorAll('#wayfinding-breadcrumbs_feature_div a[href*="/Books/"], #wayfinding-breadcrumbs_feature_div a');
    const cats = [];
    links.forEach((a) => {
      const t = (a.textContent || '').trim();
      if (t && cats.length < 6) cats.push(t);
    });
    return cats.length ? cats : null;
  }

  const bsr = getBsr();
  const pub = getPublicationData();
  const market = marketCode();

  const payload = {
    asin,
    title: getTitle(),
    price: getPrice(),
    reviewCount: getReviews(),
    avgRating: getRating(),
    bsr: bsr && bsr.length ? bsr[0].rank : null,
    bsrCategory: bsr && bsr.length ? bsr[0].category : null,
    bsrAll: bsr,
    formats: getFormats(),
    category: getCategoryBreadcrumb(),
    url: location.href,
    blocked: isBlockedPage(),
    market,
    pubDateEpoch: parsePubDate(pub.pubDate, market),
    ...pub
  };

  chrome.runtime.sendMessage({ type: 'PRODUCT_PARSED', payload }).catch(() => {});
})();