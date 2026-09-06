(() => {
  const m =
    location.pathname.match(/^\/dp\/([A-Z0-9]{10})/) ||
    location.pathname.match(/^\/gp\/product\/([A-Z0-9]{10})/) ||
    location.pathname.match(/^\/gp\/aw\/d\/([A-Z0-9]{10})/);
  if (!m) return;

  const asin = m[1];

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
    ...pub
  };

  chrome.runtime.sendMessage({ type: 'PRODUCT_PARSED', payload }).catch(() => {});
})();