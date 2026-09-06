const MARKETS = [
  { code: 'us', name: 'Amazon.com (US)', domain: 'amazon.com' },
  { code: 'uk', name: 'Amazon.co.uk (UK)', domain: 'amazon.co.uk' },
  { code: 'de', name: 'Amazon.de (DE)', domain: 'amazon.de' },
  { code: 'fr', name: 'Amazon.fr (FR)', domain: 'amazon.fr' },
  { code: 'it', name: 'Amazon.it (IT)', domain: 'amazon.it' },
  { code: 'es', name: 'Amazon.es (ES)', domain: 'amazon.es' },
  { code: 'ca', name: 'Amazon.ca (CA)', domain: 'amazon.ca' },
  { code: 'au', name: 'Amazon.com.au (AU)', domain: 'amazon.com.au' },
  { code: 'in', name: 'Amazon.in (IN)', domain: 'amazon.in' },
  { code: 'mx', name: 'Amazon.com.mx (MX)', domain: 'amazon.com.mx' },
  { code: 'br', name: 'Amazon.com.br (BR)', domain: 'amazon.com.br' },
  { code: 'nl', name: 'Amazon.nl (NL)', domain: 'amazon.nl' },
  { code: 'se', name: 'Amazon.se (SE)', domain: 'amazon.se' },
  { code: 'pl', name: 'Amazon.pl (PL)', domain: 'amazon.pl' },
  { code: 'tr', name: 'Amazon.com.tr (TR)', domain: 'amazon.com.tr' },
  { code: 'sa', name: 'Amazon.sa (SA)', domain: 'amazon.sa' },
  { code: 'ae', name: 'Amazon.ae (AE)', domain: 'amazon.ae' },
  { code: 'sg', name: 'Amazon.sg (SG)', domain: 'amazon.sg' },
  { code: 'eg', name: 'Amazon.eg (EG)', domain: 'amazon.eg' },
  { code: 'jp', name: 'Amazon.co.jp (JP)', domain: 'amazon.co.jp' }
];

export function getMarkets() {
  return MARKETS;
}

export function marketOptions() {
  return MARKETS.map((m) => `<option value="${m.code}">${m.name}</option>`).join('');
}