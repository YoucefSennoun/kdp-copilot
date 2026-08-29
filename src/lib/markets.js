export const MARKETS = {
  us: {
    code: 'us',
    domain: 'www.amazon.com',
    marketplaceId: 'ATVPDKIKX0DER',
    mid: 1,
    currency: 'USD',
    language: 'en',
    country: 'us',
    label: 'US'
  },
  uk: {
    code: 'uk',
    domain: 'www.amazon.co.uk',
    marketplaceId: 'A1F83G8C2ARO7P',
    mid: 2,
    currency: 'GBP',
    language: 'en-GB',
    country: 'gb',
    label: 'UK'
  },
  de: {
    code: 'de',
    domain: 'www.amazon.de',
    marketplaceId: 'A1PA6795UKMFR9',
    mid: 3,
    currency: 'EUR',
    language: 'de',
    country: 'de',
    label: 'DE'
  },
  fr: {
    code: 'fr',
    domain: 'www.amazon.fr',
    marketplaceId: 'A13V1IB3VIYZZH',
    mid: 4,
    currency: 'EUR',
    language: 'fr',
    country: 'fr',
    label: 'FR'
  },
  it: {
    code: 'it',
    domain: 'www.amazon.it',
    marketplaceId: 'APJ6JRA9NG5V4',
    mid: 5,
    currency: 'EUR',
    language: 'it',
    country: 'it',
    label: 'IT'
  },
  es: {
    code: 'es',
    domain: 'www.amazon.es',
    marketplaceId: 'A1RKKUPIHCS9HS',
    mid: 6,
    currency: 'EUR',
    language: 'es',
    country: 'es',
    label: 'ES'
  },
  ca: {
    code: 'ca',
    domain: 'www.amazon.ca',
    marketplaceId: 'A2EUQ1WTGCTBG2',
    mid: 7,
    currency: 'CAD',
    language: 'en-CA',
    country: 'ca',
    label: 'CA'
  },
  jp: {
    code: 'jp',
    domain: 'www.amazon.co.jp',
    marketplaceId: 'A1VC38T7YXB528',
    mid: 8,
    currency: 'JPY',
    language: 'ja',
    country: 'jp',
    label: 'JP'
  },
  au: {
    code: 'au',
    domain: 'www.amazon.com.au',
    marketplaceId: 'A39IBJ37TRP1C6',
    mid: 9,
    currency: 'AUD',
    language: 'en-AU',
    country: 'au',
    label: 'AU'
  },
  mx: {
    code: 'mx',
    domain: 'www.amazon.com.mx',
    marketplaceId: 'A1AM78C7UMHX3',
    mid: 10,
    currency: 'MXN',
    language: 'es',
    country: 'mx',
    label: 'MX'
  },
  br: {
    code: 'br',
    domain: 'www.amazon.com.br',
    marketplaceId: 'A2Q3Y263D00KWC',
    mid: 11,
    currency: 'BRL',
    language: 'pt',
    country: 'br',
    label: 'BR'
  }
};

export const DEFAULT_MARKET = 'us';

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

export function searchUrl(market, keyword, extraParams = {}) {
  const m = getMarket(market);
  const params = new URLSearchParams({ k: keyword, i: 'stripbooks' });
  Object.entries(extraParams).forEach(([k, v]) => {
    if (v != null && v !== '') params.set(k, v);
  });
  return `https://${m.domain}/s?${params.toString()}`;
}

export function autocompleteUrl(market, prefix) {
  const m = getMarket(market);
  return (
    `https://completion.amazon.com/api/2017/suggestions?session-id=131-0000000-0000000&customer-id=&request-id=` +
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