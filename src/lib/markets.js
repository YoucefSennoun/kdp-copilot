export const MARKETS = {
  us: {
    code: 'us',
    domain: 'www.amazon.com',
    marketplaceId: 'ATVPDKIKX0DER',
    mid: 1,
    currency: 'USD',
    language: 'en',
    country: 'us',
    label: 'US',
    zipCode: '10001' // New York, NY (rule 7: realistic domestic results)
  },
  uk: {
    code: 'uk',
    domain: 'www.amazon.co.uk',
    marketplaceId: 'A1F83G8C2ARO7P',
    mid: 2,
    currency: 'GBP',
    language: 'en-GB',
    country: 'gb',
    label: 'UK',
    zipCode: 'SW1A 1AA' // London
  },
  de: {
    code: 'de',
    domain: 'www.amazon.de',
    marketplaceId: 'A1PA6795UKMFR9',
    mid: 3,
    currency: 'EUR',
    language: 'de',
    country: 'de',
    label: 'DE',
    zipCode: '10115' // Berlin
  },
  fr: {
    code: 'fr',
    domain: 'www.amazon.fr',
    marketplaceId: 'A13V1IB3VIYZZH',
    mid: 4,
    currency: 'EUR',
    language: 'fr',
    country: 'fr',
    label: 'FR',
    zipCode: '75001' // Paris
  },
  it: {
    code: 'it',
    domain: 'www.amazon.it',
    marketplaceId: 'APJ6JRA9NG5V4',
    mid: 5,
    currency: 'EUR',
    language: 'it',
    country: 'it',
    label: 'IT',
    zipCode: '00186' // Rome
  },
  es: {
    code: 'es',
    domain: 'www.amazon.es',
    marketplaceId: 'A1RKKUPIHCS9HS',
    mid: 6,
    currency: 'EUR',
    language: 'es',
    country: 'es',
    label: 'ES',
    zipCode: '28001' // Madrid
  },
  ca: {
    code: 'ca',
    domain: 'www.amazon.ca',
    marketplaceId: 'A2EUQ1WTGCTBG2',
    mid: 7,
    currency: 'CAD',
    language: 'en-CA',
    country: 'ca',
    label: 'CA',
    zipCode: 'K1A 0A9' // Ottawa
  },
  jp: {
    code: 'jp',
    domain: 'www.amazon.co.jp',
    marketplaceId: 'A1VC38T7YXB528',
    mid: 8,
    currency: 'JPY',
    language: 'ja',
    country: 'jp',
    label: 'JP',
    zipCode: '100-0001' // Tokyo (Chiyoda)
  },
  au: {
    code: 'au',
    domain: 'www.amazon.com.au',
    marketplaceId: 'A39IBJ37TRP1C6',
    mid: 9,
    currency: 'AUD',
    language: 'en-AU',
    country: 'au',
    label: 'AU',
    zipCode: '2000' // Sydney
  },
  mx: {
    code: 'mx',
    domain: 'www.amazon.com.mx',
    marketplaceId: 'A1AM78C7UMHX3',
    mid: 10,
    currency: 'MXN',
    language: 'es',
    country: 'mx',
    label: 'MX',
    zipCode: '06000' // Mexico City
  },
  br: {
    code: 'br',
    domain: 'www.amazon.com.br',
    marketplaceId: 'A2Q3Y263D00KWC',
    mid: 11,
    currency: 'BRL',
    language: 'pt',
    country: 'br',
    label: 'BR',
    zipCode: '70040-900' // Brasília
  },
  // ---- Extended storefronts (rules v1 rule 5+7: every market gets a capital
  // ZIP + a registry entry; marketplaceIds are Amazon's public MWS IDs) ----
  in: {
    code: 'in',
    domain: 'www.amazon.in',
    marketplaceId: 'A21TJRUUN4KGV',
    mid: 12,
    currency: 'INR',
    language: 'en-IN',
    country: 'in',
    label: 'IN',
    zipCode: '110001' // New Delhi
  },
  nl: {
    code: 'nl',
    domain: 'www.amazon.nl',
    marketplaceId: 'A1805IZSGTT6HS',
    mid: 13,
    currency: 'EUR',
    language: 'nl',
    country: 'nl',
    label: 'NL',
    zipCode: '1012 JS' // Amsterdam
  },
  se: {
    code: 'se',
    domain: 'www.amazon.se',
    marketplaceId: 'ANU9KP01APNAG',
    mid: 14,
    currency: 'SEK',
    language: 'sv',
    country: 'se',
    label: 'SE',
    zipCode: '111 52' // Stockholm
  },
  pl: {
    code: 'pl',
    domain: 'www.amazon.pl',
    marketplaceId: 'A1C3SOZRARQ6R3',
    mid: 15,
    currency: 'PLN',
    language: 'pl',
    country: 'pl',
    label: 'PL',
    zipCode: '00-001' // Warsaw
  },
  tr: {
    code: 'tr',
    domain: 'www.amazon.com.tr',
    marketplaceId: 'A33AVAJ2PDY3EV',
    mid: 16,
    currency: 'TRY',
    language: 'tr',
    country: 'tr',
    label: 'TR',
    zipCode: '06000' // Ankara
  },
  sa: {
    code: 'sa',
    domain: 'www.amazon.sa',
    marketplaceId: 'A17E79C6D8HU7M',
    mid: 17,
    currency: 'SAR',
    language: 'ar',
    country: 'sa',
    label: 'SA',
    zipCode: '12211' // Riyadh
  },
  ae: {
    code: 'ae',
    domain: 'www.amazon.ae',
    marketplaceId: 'A2VIGQ35RCS4UG',
    mid: 18,
    currency: 'AED',
    language: 'ar',
    country: 'ae',
    label: 'AE',
    zipCode: '00000' // UAE has no postal codes — Dubai placeholder
  },
  sg: {
    code: 'sg',
    domain: 'www.amazon.sg',
    marketplaceId: 'A19VAU5U5O7RUS',
    mid: 19,
    currency: 'SGD',
    language: 'en-SG',
    country: 'sg',
    label: 'SG',
    zipCode: '018956' // Singapore
  },
  eg: {
    code: 'eg',
    domain: 'www.amazon.eg',
    marketplaceId: 'A2CQZ5RBY40XE',
    mid: 20,
    currency: 'EGP',
    language: 'ar',
    country: 'eg',
    label: 'EG',
    zipCode: '11511' // Cairo
  }
};

// Rule 7: append the market capital's postal code to SERP URLs so results are
// delivered for a realistic domestic location. Set via setSearchZip() from the
// background (pure module stays testable).
let activeZip = '';
export function setSearchZip(zip) {
  activeZip = (zip || '').trim();
}

export const DEFAULT_MARKET = 'us';

// Amazon sort parameter constants for SERP scraping.
export const SORT_RELEVANCE = '';
export const SORT_BESTSELLERS = 'exact-awareness-rank';
export const SORT_NEW_RELEASES = 'date-desc-rank';

export function getMarket(code) {
  return MARKETS[code || DEFAULT_MARKET] || MARKETS[DEFAULT_MARKET];
}

export function marketFromDomain(hostname) {
  const host = (hostname || '').toLowerCase();
  for (const key of Object.keys(MARKETS)) {
    const m = MARKETS[key];
    if (host === m.domain || host.endsWith('.' + m.domain)) return m;
  }
  return MARKETS[DEFAULT_MARKET];
}

/**
 * Rule 6: EVERY search is scoped to Books (`i=stripbooks`) — never All.
 * Rule 7 (v0.8.3): the market's capital-city ZIP travels in the `zipcode`
 * param as the pin instruction — the SERP content script reads it and sets
 * Amazon's real "Deliver to" location via the address-change endpoint before
 * scraping, so results reflect a real domestic location per market.
 */
export function searchUrl(market, keyword, extraParams = {}) {
  const m = getMarket(market);
  const params = new URLSearchParams({ k: keyword, i: 'stripbooks' });
  Object.entries({ ...(activeZip ? { zipcode: activeZip } : {}), ...extraParams }).forEach(([k, v]) => {
    if (v != null && v !== '') params.set(k, v);
  });
  return `https://${m.domain}/s?${params.toString()}`;
}

/**
 * Rule 7 (v0.8): MyResearchBase deep link — filters the same Books search
 * through myresearchbase.com to strip FBA/Amazon-retail noise and surface
 * the self-published (KDP) competition pool only. Opened on demand from the
 * dashboard detail drawer; never scraped automatically.
 */
export function myResearchBaseUrl(market, keyword) {
  const m = getMarket(market);
  const q = encodeURIComponent(String(keyword || '').trim());
  return `https://myresearchbase.com/search?market=${encodeURIComponent(m.code)}&q=${q}`;
}

/**
 * Rule 7 (v0.8.3): Amazon's REAL delivery-location setter. The `zipcode`
 * query param on /s is ignored by Amazon (it was a placebo) — the "Deliver
 * to" location lives in session cookies and can only be changed same-origin
 * via this AJAX endpoint. The SERP content script POSTs here automatically
 * for extension-opened tabs (which carry the market's zip in their URL), so
 * the location flips per market with zero manual work.
 * Pure helper — the content script mirrors this payload.
 */
export function locationChangeEndpoint(market) {
  const m = getMarket(market);
  return `https://${m.domain}/gp/delivery/ajax/address-change.html`;
}

/** Form payload for the location-change POST (URL-encoded by the caller). */
export function buildLocationPayload(zipCode) {
  return {
    locationType: 'LOCATION_INPUT',
    zipCode: String(zipCode || '').trim(),
    storeContext: 'generic',
    deviceType: 'web',
    pageType: 'Gateway',
    actionSource: 'glow'
  };
}

/**
 * True when the page's "Deliver to" glow text already reflects the desired
 * zip (whitespace-insensitive: "SW1A 1AA" matches "SW1A1AA"). Pure helper —
 * the content script uses the same normalization on the live glow text.
 */
export function glowMatchesZip(glowText, zipCode) {
  const norm = (s) => String(s || '').toLowerCase().replace(/\s+/g, '');
  const glow = norm(glowText);
  const zip = norm(zipCode);
  return !!(glow && zip && glow.includes(zip));
}

export function productUrl(market, asin) {
  const m = getMarket(market);
  return `https://${m.domain}/dp/${encodeURIComponent(asin)}`;
}

/**
 * v0.8.2 fix: Amazon's search-suggest API is marketplace-specific.
 * completion.amazon.com only answers for the US mid — every other market
 * returns HTTP 200 with ZERO suggestions there, which used to make Research
 * look dead outside the US. Each storefront has its own completion host
 * (verified live: uk/fr/de/jp/ca/au/it/es/mx/br/nl/se/pl/tr/sa/ae/sg/eg).
 */
export function suggestHost(market) {
  const m = getMarket(market);
  if (m.suggestHost) return m.suggestHost;
  // Default pattern: www.amazon.xx → completion.amazon.xx
  return String(m.domain || 'www.amazon.com').replace(/^www\./, 'completion.');
}

export function autocompleteUrl(market, prefix) {
  const m = getMarket(market);
  const host = suggestHost(m.code);
  return (
    `https://${host}/api/2017/suggestions?session-id=131-0000000-0000000&customer-id=&request-id=` +
    `&page-type=Gateway&lop=desktop&site-variant=desktop&client-info=amazon-search-ui` +
    `&mid=${m.marketplaceId}&alias=stripbooks&b2b=0&fresh=0&ks=71&prefix=${encodeURIComponent(prefix)}` +
    `&event=onKeyPress&limit=11&fb=1&suggestion-type=KEYWORD`
  );
}

export function googleSuggestUrl(seed, market) {
  const m = getMarket(market);
  return (
    `https://suggestqueries.google.com/complete/search?client=chrome&hl=${encodeURIComponent(m.language)}` +
    `&gl=${encodeURIComponent(m.country)}&num=20&q=${encodeURIComponent(seed)}`
  );
}

// ---- Discovery pages (Best Sellers / Movers & Shakers / New Releases) ----

export function bestsellersUrl(market, nodeId) {
  const m = getMarket(market);
  return `https://${m.domain}/gp/bestsellers/books/${encodeURIComponent(nodeId)}`;
}

export function moversUrl(market, nodeId) {
  const m = getMarket(market);
  return `https://${m.domain}/gp/movers-and-shakers/books/${encodeURIComponent(nodeId)}`;
}

export function newReleasesUrl(market, nodeId) {
  const m = getMarket(market);
  return `https://${m.domain}/gp/new-releases/books/${encodeURIComponent(nodeId)}`;
}