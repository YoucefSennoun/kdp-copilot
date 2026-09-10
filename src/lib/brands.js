/**
 * Rule 3 (v0.7): big-brand removal. Books whose sales come from an existing
 * Amazon brand (licensed media, toy brands, major publishers, stationery
 * megabrands) rank high on brand power, not organic search traffic. A niche
 * led by such a brand is excluded from the shortlist.
 *
 * Pure module: no chrome APIs, safe to unit-test.
 */

export const DEFAULT_BRAND_BLOCKLIST = [
  // Licensed media (official merch dominates its niche when present)
  'disney', 'marvel', 'dc comics', 'warner bros', 'warner brothers',
  'star wars', 'harry potter', 'nintendo', 'pokemon', 'mario', 'zelda',
  'sonic the hedgehog', 'lego', 'barbie', 'hello kitty', 'sanrio',
  'peppa pig', 'paw patrol', 'bluey', 'cocomelon', 'roblox', 'fortnite',
  'minecraft', 'squishmallows', 'dr. seuss', 'eric carle',
  // Major publishers / branded education lines
  'scholastic', 'penguin random house', 'random house', 'harpercollins',
  'hachette', 'simon & schuster', 'usborne', 'dk publishing', 'dorling kindersley',
  'national geographic', 'natgeo', 'kumon', 'sidemen',
  // Stationery / notebook megabrands
  'moleskine', 'leuchtturm', 'rocketbook', 'paperblanks', 'faber-castell',
  'crayola', 'strathmore', 'rhodia', 'muji',
  // Retailer house brands
  'amazon basics', 'amazon essentials'
];

/**
 * Rule 3 (v0.8): famous AUTHOR brands. These authors sell on name recognition,
 * not organic keyword traffic — a niche led by one of them is not winnable
 * for an unknown indie, even when the title itself looks generic. Full-name
 * substring match only (first+last), so "james" alone never fires.
 */
export const FAMOUS_AUTHOR_BLOCKLIST = [
  'james clear', 'stephen king', 'colleen hoover', 'j.k. rowling', 'jk rowling',
  'george r.r. martin', 'george rr martin', 'sarah j. maas', 'sarah j maas',
  'rebecca yarros', 'freida mcfadden', 'taylor jenkins reid', 'kristin hannah',
  'james patterson', 'john grisham', 'dan brown', 'lee child', 'david baldacci',
  'harlan coben', 'gillian flynn', 'paula hawkins', 'andy weir', 'blake crouch',
  'brandon sanderson', 'joe dispenza', 'mark manson', 'james allen',
  'dale carnegie', 'napoleon hill', 'robert kiyosaki', 'dave ramsey',
  'suze orman', 'tony robbins', 'brene brown',
  'adam grant', 'malcolm gladwell', 'yuval noah harari',
  'michelle obama', 'barack obama', 'prince harry', 'britney spears',
  'matthew mcconaughey', 'will smith', 'trevor noah',
  'dr. seuss', 'eric carle', 'julia donaldson', 'david walliams',
  'jeff kinney', 'rick riordan', 'dav pilkey', 'james dean',
  'joanna gaines', 'marie kondo', 'gordon ramsay', 'jamie oliver',
  'ina garten', 'ree drummond', 'bethenny frankel'
];

export function normalizeBrandText(text) {
  return String(text || '')
    .toLowerCase()
    .replace(/[^a-z0-9&.\s]/g, ' ');
}

/** Return the first blocked brand found in a title/publisher/author blob. */
export function matchBlockedBrand(text, blocklist = DEFAULT_BRAND_BLOCKLIST) {
  const clean = normalizeBrandText(text);
  if (!clean) return null;
  for (const brand of blocklist || []) {
    const b = String(brand).trim().toLowerCase();
    if (b && clean.includes(b)) return brand;
  }
  return null;
}

function normalizeAuthorName(name) {
  return String(name || '')
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

/**
 * Rule 3 (v0.8): author-frequency brand detection. When ONE author name owns
 * >=3 books in the sample (or >=50% of the cards that carry author info),
 * the niche's sales come from that author's following, not organic keyword
 * traffic — even if the name is not on any static blocklist. Returns the
 * dominating author or null.
 */
export function computeAuthorFrequencyRisk(samples = [], { minRepeats = 3, minShare = 0.5 } = {}) {
  const counts = new Map();
  let withAuthor = 0;
  for (const s of Array.isArray(samples) ? samples : []) {
    const raw = s && typeof s === 'object' ? s.author : null;
    const norm = normalizeAuthorName(raw);
    // Ignore stubs ("by", single initials, empty).
    if (!norm || norm.length < 3 || norm.split(' ').length < 1) continue;
    if (/^(by|author|unknown)$/.test(norm)) continue;
    withAuthor++;
    counts.set(norm, (counts.get(norm) || 0) + 1);
  }
  if (!counts.size) return null;
  let best = null;
  for (const [author, count] of counts.entries()) {
    if (count >= minRepeats || (withAuthor >= 4 && count / withAuthor >= minShare)) {
      if (!best || count > best.count) best = { author, count, share: withAuthor ? count / withAuthor : 1 };
    }
  }
  return best;
}

/** True when a title/publisher/author blob names a famous author. */
export function matchFamousAuthor(text, list = FAMOUS_AUTHOR_BLOCKLIST) {
  const clean = ` ${normalizeBrandText(text)} `;
  if (!clean.trim()) return null;
  for (const name of list || []) {
    const n = String(name).trim().toLowerCase();
    if (n && clean.includes(` ${n} `) || clean.includes(` ${n}.`) || clean === ` ${n} `) return name;
    // Fallback: plain substring for multi-word names (punctuation already stripped).
    if (n && n.includes(' ') && normalizeBrandText(text).includes(n)) return name;
  }
  return null;
}

/**
 * Brand-risk fingerprint for a set of titles (SERP cards or BSR samples).
 * topBranded = true when ANY of the sampled products carries a blocked brand,
 * names a famous author, or when one author dominates the sample by frequency
 * (rule 3: sales from fame, not organic traffic). Conservative: a single
 * leaked trademark suffices, because publishing next to it in the same niche
 * still competes against the brand's demand pool.
 */
export function computeBrandRisk(titlesOrSamples = [], blocklist = DEFAULT_BRAND_BLOCKLIST) {
  if (!Array.isArray(titlesOrSamples)) titlesOrSamples = [];
  const texts = titlesOrSamples
    .map((x) => {
      if (typeof x === 'string') return x;
      if (!x) return '';
      // Concatenate ALL identity fields (title + publisher + author) so a
      // brand living in the publisher/author line alone is still caught.
      const parts = [x.title, x.publisher, x.author, x.keyword].filter((p) => typeof p === 'string' && p.trim());
      return parts.join(' · ');
    })
    .filter(Boolean);
  const text = texts.join(' · ');
  if (!text) return { matched: [], count: 0, topBranded: false, authorBrand: null };

  const matched = new Set();
  const normText = normalizeBrandText(text);
  for (const brand of blocklist || []) {
    const b = String(brand).trim().toLowerCase().replace(/[^a-z0-9&.\s]/g, ' ');
    if (b && normText.includes(b)) matched.add(brand);
  }
  // Famous-author pass over the same blob.
  const famousHit = matchFamousAuthor(text);
  if (famousHit) matched.add(`author:${famousHit}`);

  // Author-frequency pass over structured samples (needs .author fields).
  const authorBrand = computeAuthorFrequencyRisk(
    titlesOrSamples.filter((x) => x && typeof x === 'object')
  );
  if (authorBrand) matched.add(`author-dominance:${authorBrand.author} (${authorBrand.count} books)`);

  return {
    matched: [...matched],
    count: matched.size,
    topBranded: matched.size > 0,
    authorBrand
  };
}

/**
 * Per-ASIN brand flags: which enriched samples are themselves branded books.
 * A branded book is excluded from the fresh-hits count (rule 1+2+3 combo) and
 * surfaced with a ⚠ badge in the detail drawer — the niche is judged on its
 * ORGANIC sellers only.
 */
export function flagBrandedSamples(samples = [], blocklist = DEFAULT_BRAND_BLOCKLIST) {
  const out = new Map();
  for (const s of Array.isArray(samples) ? samples : []) {
    if (!s || !s.asin) continue;
    const blob = `${s.title || ''} ${s.publisher || ''} ${s.author || ''}`;
    const hit = matchBlockedBrand(blob, blocklist) || matchFamousAuthor(blob);
    if (hit) out.set(s.asin, hit);
  }
  return out;
}