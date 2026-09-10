/**
 * Multi-market trademark registry directory (rules v1, rule 5).
 *
 * Every marketplace has an official trademark database; several share a
 * regional one (EUIPO covers FR/DE/IT/ES). marcaria.com is the aggregator
 * that covers all of them from one UI. v1 deep-links the user to a
 * pre-filled registry search per market (prefillsTerm) or to the empty
 * search (manual term entry) — we do NOT scrape registries (ToS + legal
 * exposure); the AI sweep + local list provide the in-tool risk read.
 *
 * Pure module: no chrome APIs, safe to unit-test.
 */

export const TRADEMARK_REGISTRIES = {
  us: {
    label: 'US',
    country: 'United States',
    registry: 'USPTO (US Patent & Trademark Office)',
    url: 'https://tmsearch.uspto.gov/search/search-information',
    prefilledUrl: (term) => `https://tmsearch.uspto.gov/search/search-results?query=${encodeURIComponent(term)}`,
    prefillsTerm: true,
    classHint: 'Class 16 — Printed matter (books)'
  },
  uk: {
    label: 'UK',
    country: 'United Kingdom',
    registry: 'UKIPO (UK Intellectual Property Office)',
    url: 'https://trademarks.ipo.gov.uk/ipo-tmtext',
    prefilledUrl: (term) => `https://trademarks.ipo.gov.uk/ipo-tmtext?selectedWords=${encodeURIComponent(term)}`,
    prefillsTerm: true,
    classHint: 'Class 16 — Printed matter (books)'
  },
  fr: {
    label: 'FR',
    country: 'France',
    registry: 'EUIPO eSearch (European Union)',
    url: 'https://euipo.europa.eu/eSearch/',
    prefilledUrl: (term) => `https://euipo.europa.eu/eSearch/#basic/${encodeURIComponent(term)}+AND+ niceClass%3D16`,
    prefillsTerm: true,
    classHint: 'Class 16 — Printed matter (books)'
  },
  de: {
    label: 'DE',
    country: 'Germany',
    registry: 'EUIPO eSearch (European Union)',
    url: 'https://euipo.europa.eu/eSearch/',
    prefilledUrl: (term) => `https://euipo.europa.eu/eSearch/#basic/${encodeURIComponent(term)}+AND+ niceClass%3D16`,
    prefillsTerm: true,
    classHint: 'Class 16 — Printed matter (books)'
  },
  it: {
    label: 'IT',
    country: 'Italy',
    registry: 'EUIPO eSearch (European Union)',
    url: 'https://euipo.europa.eu/eSearch/',
    prefilledUrl: (term) => `https://euipo.europa.eu/eSearch/#basic/${encodeURIComponent(term)}+AND+ niceClass%3D16`,
    prefillsTerm: true,
    classHint: 'Class 16 — Printed matter (books)'
  },
  es: {
    label: 'ES',
    country: 'Spain',
    registry: 'EUIPO eSearch (European Union)',
    url: 'https://euipo.europa.eu/eSearch/',
    prefilledUrl: (term) => `https://euipo.europa.eu/eSearch/#basic/${encodeURIComponent(term)}+AND+ niceClass%3D16`,
    prefillsTerm: true,
    classHint: 'Class 16 — Printed matter (books)'
  },
  ca: {
    label: 'CA',
    country: 'Canada',
    registry: 'CIPO (Canadian Intellectual Property Office)',
    url: 'https://www.ic.gc.ca/app/opic-cipo/trdmrks/srch/home',
    prefilledUrl: (term) => `https://www.ic.gc.ca/app/opic-cipo/trdmrks/srch/browser?r=${encodeURIComponent(term)}`,
    prefillsTerm: false,
    classHint: 'Class 16 — Printed matter'
  },
  jp: {
    label: 'JP',
    country: 'Japan',
    registry: 'J-PlatPat (Japan Patent Office)',
    url: 'https://www.j-platpat.inpit.go.jp/t0000',
    prefilledUrl: (term) => `https://www.j-platpat.inpit.go.jp/t0100?q=${encodeURIComponent(term)}`,
    prefillsTerm: false,
    classHint: '区分16 — 印刷物 (printed matter)'
  },
  au: {
    label: 'AU',
    country: 'Australia',
    registry: 'IP Australia Trade Mark Search',
    url: 'https://search.ipaustralia.gov.au/trademarks/search/quick',
    prefilledUrl: (term) => `https://search.ipaustralia.gov.au/trademarks/search/quick?q=${encodeURIComponent(term)}`,
    prefillsTerm: true,
    classHint: 'Class 16 — Printed matter (books)'
  },
  mx: {
    label: 'MX',
    country: 'Mexico',
    registry: 'IMPI (Marcas en línea)',
    url: 'https://marcasenlinea.impi.gob.mx/',
    prefilledUrl: () => 'https://marcasenlinea.impi.gob.mx/',
    prefillsTerm: false,
    classHint: 'Clase 16 — Impresos'
  },
  br: {
    label: 'BR',
    country: 'Brazil',
    registry: 'INPI Busca de Marcas',
    url: 'https://busca.inpi.gov.br/pePI/', // BR isn't a supported market yet; kept for symmetry
    prefilledUrl: (term) => `https://busca.inpi.gov.br/pePI/#processo?marca=${encodeURIComponent(term)}`,
    prefillsTerm: false,
    classHint: 'Classe 16 — Impressos'
  },
  // ---- Extended storefronts (rules v1 rule 5: every market gets an official
  // database; EU members share EUIPO, others use their national office) ----
  nl: {
    label: 'NL',
    country: 'Netherlands',
    registry: 'EUIPO eSearch (European Union) + BOIP (Benelux)',
    url: 'https://euipo.europa.eu/eSearch/',
    prefilledUrl: (term) => `https://euipo.europa.eu/eSearch/#basic/${encodeURIComponent(term)}+AND+ niceClass%3D16`,
    prefillsTerm: true,
    classHint: 'Class 16 — Printed matter (books)'
  },
  se: {
    label: 'SE',
    country: 'Sweden',
    registry: 'EUIPO eSearch (European Union) + PRV (Sweden)',
    url: 'https://euipo.europa.eu/eSearch/',
    prefilledUrl: (term) => `https://euipo.europa.eu/eSearch/#basic/${encodeURIComponent(term)}+AND+ niceClass%3D16`,
    prefillsTerm: true,
    classHint: 'Class 16 — Printed matter (books)'
  },
  pl: {
    label: 'PL',
    country: 'Poland',
    registry: 'EUIPO eSearch (European Union) + UPRP (Poland)',
    url: 'https://euipo.europa.eu/eSearch/',
    prefilledUrl: (term) => `https://euipo.europa.eu/eSearch/#basic/${encodeURIComponent(term)}+AND+ niceClass%3D16`,
    prefillsTerm: true,
    classHint: 'Class 16 — Printed matter (books)'
  },
  in: {
    label: 'IN',
    country: 'India',
    registry: 'IP India Trade Mark Search',
    url: 'https://tmrsearch.ipindia.gov.in/tmrpublicsearch/frmmain.aspx',
    prefilledUrl: () => 'https://tmrsearch.ipindia.gov.in/tmrpublicsearch/frmmain.aspx',
    prefillsTerm: false,
    classHint: 'Class 16 — Printed matter'
  },
  tr: {
    label: 'TR',
    country: 'Turkey',
    registry: 'TÜRKPATENT (Turkish Patent and Trademark Office)',
    url: 'https://online.turkpatent.gov.tr/trademark-search/',
    prefilledUrl: () => 'https://online.turkpatent.gov.tr/trademark-search/',
    prefillsTerm: false,
    classHint: 'Class 16 — Printed matter'
  },
  sa: {
    label: 'SA',
    country: 'Saudi Arabia',
    registry: 'SAIP (Saudi Authority for Intellectual Property)',
    url: 'https://www.saip.gov.sa/en/ip-services/trademarks/',
    prefilledUrl: () => 'https://www.saip.gov.sa/en/ip-services/trademarks/',
    prefillsTerm: false,
    classHint: 'Class 16 — Printed matter'
  },
  ae: {
    label: 'AE',
    country: 'United Arab Emirates',
    registry: 'UAE Ministry of Economy (Trademarks)',
    url: 'https://www.economy.gov.ae/english/Pages/default.aspx',
    prefilledUrl: () => 'https://www.economy.gov.ae/english/Pages/default.aspx',
    prefillsTerm: false,
    classHint: 'Class 16 — Printed matter'
  },
  sg: {
    label: 'SG',
    country: 'Singapore',
    registry: 'IPOS (Intellectual Property Office of Singapore)',
    url: 'https://www.ipos.gov.sg/search-ip/trade-marks',
    prefilledUrl: (term) => `https://www.ipos.gov.sg/search-ip/trade-marks?q=${encodeURIComponent(term)}`,
    prefillsTerm: false,
    classHint: 'Class 16 — Printed matter'
  },
  eg: {
    label: 'EG',
    country: 'Egypt',
    registry: 'EGYPO (Egyptian Patent Office / Trademarks)',
    url: 'http://www.egypo.gov.eg/',
    prefilledUrl: () => 'http://www.egypo.gov.eg/',
    prefillsTerm: false,
    classHint: 'Class 16 — Printed matter'
  }
};

/**
 * Rule 5 (v0.8): copyright screen note. Trademark registries do NOT cover
 * copyright (book text, illustrations, lyrics, character likeness in prose).
 * A niche can be trademark-clean and still infringe copyright when its books
 * reuse protected text/art. Always verify the interior, not just the title.
 */
export const COPYRIGHT_NOTE = 'Trademark registries do not cover copyright: book text, illustrations, song lyrics and character artwork need a separate originality check, even when the title itself is clear.';

/** Aggregator covering every market from one search UI (rules v1, rule 5). */
export const AGGREGATOR = {
  name: 'Marcaria International Trademark Search',
  url: 'https://trademark-search.marcaria.com/en',
  prefilledUrl: (term) => `https://trademark-search.marcaria.com/en/search?q=${encodeURIComponent(term)}`,
  prefillsTerm: false
};

/**
 * Build the registry lookup list for a keyword. Includes the aggregator plus
 * one entry per requested market (defaults to every market in the directory).
 * @returns {{ key, label, country, registry, classHint, searchUrl, prefilled }[]}
 */
export function buildRegistryLookups(keyword, markets = Object.keys(TRADEMARK_REGISTRIES)) {
  const term = String(keyword || '').trim();
  const out = [];

  (markets || [])
    .map((mc) => String(mc).toLowerCase())
    .filter((mc) => TRADEMARK_REGISTRIES[mc])
    .forEach((mc) => {
      const r = TRADEMARK_REGISTRIES[mc];
      out.push({
        key: mc,
        label: r.label,
        country: r.country,
        registry: r.registry,
        classHint: r.classHint,
        searchUrl: r.prefillsTerm && term ? r.prefilledUrl(term) : r.url,
        prefilled: r.prefillsTerm && !!term
      });
    });

  if (term) {
    out.push({
      key: 'marcaria',
      label: 'ALL',
      country: 'All markets (aggregator)',
      registry: AGGREGATOR.name,
      classHint: 'Multi-market screening',
      searchUrl: AGGREGATOR.prefilledUrl(term),
      prefilled: false
    });
  }
  return out;
}

/**
 * Local per-market famous-marks screen (keyless fallback for rule 5).
 * The GLOBAL list applies everywhere; per-market lists catch marks that are
 * only famous regionally. Pure substring screening — conservative by design.
 */
const FAMOUS_GLOBAL = [
  { term: 'disney', owner: 'The Walt Disney Company' },
  { term: 'pixar', owner: 'Pixar / Disney' },
  { term: 'marvel', owner: 'Marvel Entertainment' },
  { term: 'dc comics', owner: 'DC Comics' },
  { term: 'harry potter', owner: 'J.K. Rowling / Warner Bros.' },
  { term: 'pokemon', owner: 'The Pokémon Company' },
  { term: 'star wars', owner: 'Lucasfilm / Disney' },
  { term: 'lego', owner: 'LEGO Group' },
  { term: 'barbie', owner: 'Mattel' },
  { term: 'nintendo', owner: 'Nintendo' },
  { term: 'minecraft', owner: 'Mojang / Microsoft' },
  { term: 'fortnite', owner: 'Epic Games' },
  { term: 'roblox', owner: 'Roblox Corp.' },
  { term: 'peppa pig', owner: 'Hasbro / Entertainment One' },
  { term: 'paw patrol', owner: 'Spin Master / Nickelodeon' },
  { term: 'bluey', owner: 'BBC Studios' },
  { term: 'cocomelon', owner: 'Moonbug Entertainment' },
  { term: 'dr. seuss', owner: 'Dr. Seuss Enterprises' },
  { term: 'eric carle', owner: 'Eric Carle Estate' },
  { term: 'star trek', owner: 'Paramount' },
  { term: 'lord of the rings', owner: 'The Tolkien Estate / Middle-earth Enterprises' },
  { term: 'the hobbit', owner: 'The Tolkien Estate' },
  { term: 'game of thrones', owner: 'George R.R. Martin / HBO' },
  { term: 'sherlock holmes', owner: 'Conan Doyle Estate' },
  { term: 'doctor who', owner: 'BBC' },
  { term: 'spiderman', owner: 'Marvel / Sony' },
  { term: 'batman', owner: 'DC / Warner Bros.' },
  { term: 'superman', owner: 'DC / Warner Bros.' },
  { term: 'wonka', owner: 'Roald Dahl Estate / Warner Bros.' },
  { term: 'taylor swift', owner: 'Taylor Swift (celebrity)' },
  { term: 'the beatles', owner: 'Apple Corps / Sony' }
];

const FAMOUS_PER_MARKET = {
  us: [
    { term: 'leapfrog', owner: 'LeapFrog Enterprises' },
    { term: ' Highlights', owner: 'Highlights for Children' },
    { term: "childcraft", owner: 'World Book / Childcraft' },
    { term: 'scholastic', owner: 'Scholastic Inc.' },
    { term: 'moleskine', owner: 'Moleskine SpA' },
    { term: 'crayola', owner: 'Crayola LLC' }
  ],
  uk: [
    { term: 'orchard toys', owner: 'Orchard Toys' },
    { term: 'usborne', owner: "Usborne Publishing" },
    { term: 'egmont', owner: 'Egmont Publishing' }
  ],
  fr: [
    { term: 'asterix', owner: 'Les Éditions Albert René' },
    { term: 'tintin', owner: 'Moulinsart / Hergé Estate' },
    { term: 'petit ours brun', owner: 'Bayard Jeunesse' },
    { term: 'martine', owner: 'Casterman' }
  ],
  de: [
    { term: 'die drei ???', owner: 'Kosmos / Europa' },
    { term: 'playmobil', owner: 'Brandstätter Group' },
    { term: 'ravensburger', owner: 'Ravensburger AG' }
  ],
  it: [
    { term: 'gormiti', owner: 'Giochi Preziosi' },
    { term: 'winx', owner: 'Rainbow SpA / Iginio Straffi' }
  ],
  es: [
    { term: 'mortadelo', owner: 'Ediciones B' },
    { term: 'zipi y zape', owner: 'Ediciones B' }
  ],
  jp: [
    { term: 'doraemon', owner: 'Fujiko F. Fujio Productions' },
    { term: 'anpanman', owner: 'Froebel-kan / Takashi Yanase' },
    { term: 'kamen rider', owner: 'Toei / Shotaro Ishinomori' },
    { term: 'sailor moon', owner: 'Naoko Takeuchi / Toei' },
    { term: 'dragon ball', owner: 'Akira Toriyama / Shueisha / Toei' },
    { term: 'one piece', owner: 'Eiichiro Oda / Shueisha' },
    { term: 'hello kitty', owner: 'Sanrio' }
  ],
  au: [
    { term: 'grug', owner: 'Ted Prior / Scholastic AU' },
    { term: 'wiggles', owner: 'The Wiggles Pty Ltd' }
  ],
  ca: [
    { term: 'franklin the turtle', owner: 'Kids Can Press / Paulette Bourgeois' },
    { term: 'scaredy squirrel', owner: 'Kids Can Press / Mélanie Watt' }
  ],
  mx: [
    { term: 'el chavo', owner: 'Grupo Chespirito' },
    { term: 'cantinflas', owner: 'Cantinflas Estate' }
  ],
  br: [
    { term: 'turma da mônica', owner: 'Mauricio de Sousa Produções' },
    { term: 'chico bento', owner: 'Mauricio de Sousa Produções' }
  ]
};

/**
 * Local multi-market screen. Returns per-market flag lists for every market
 * passed (default: all). Pure — used by the keyless fallback and as a fast
 * pre-pass before the AI sweep.
 */
export function localTrademarkScreen(keyword, markets = Object.keys(TRADEMARK_REGISTRIES), extraText = '') {
  const text = `${keyword || ''} ${extraText || ''}`.toLowerCase();
  const perMarket = {};

  (markets || Object.keys(TRADEMARK_REGISTRIES)).forEach((mc) => {
    const key = String(mc).toLowerCase();
    const localList = FAMOUS_PER_MARKET[key] || [];
    const flagged = FAMOUS_GLOBAL.concat(localList)
      .filter((p) => text.includes(String(p.term).toLowerCase().trim()))
      .map((p) => ({ term: p.term, owner: p.owner, why: `Contains the protected name "${p.term}".` }));
    const risk = flagged.length > 2 ? 'high' : flagged.length ? 'medium' : 'low';
    perMarket[key] = {
      risk,
      safe: risk === 'low',
      verdict: flagged.length
        ? `Local screen flagged ${flagged.length} protected term${flagged.length === 1 ? '' : 's'} in ${key.toUpperCase()}.`
        : `No common protected terms found in ${key.toUpperCase()}.`,
      flagged
    };
  });

  const worst = Object.values(perMarket).reduce(
    (acc, v) => (v.risk === 'high' || acc === 'high' ? 'high' : v.risk === 'medium' || acc === 'medium' ? 'medium' : 'low'),
    'low'
  );

  return {
    keyword,
    ai: false,
    risk: worst,
    safe: worst === 'low',
    verdict: worst === 'low'
      ? 'Local multi-market screen: no common protected terms found in any market.'
      : `Local multi-market screen: flagged terms in ${Object.values(perMarket).filter((v) => v.risk !== 'low').length} market(s). Verify with a trademark attorney before publishing.`,
    flagged: Object.values(perMarket).flatMap((v) => v.flagged),
    perMarket,
    notes: ['Local keyword-match screen, not a legal opinion. Use the registry links for official records.']
  };
}
