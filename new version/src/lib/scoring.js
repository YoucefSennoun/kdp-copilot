export const SCORE_WEIGHTS = {
  demand: 0.45,
  competition: 0.35,
  margin: 0.2
};

const NORMALIZE_MAX = {
  reviewCount: 2000,
  bsr: 50000,
  listingCount: 200,        // legacy alias; normalized sample size
  totalResultsCount: 10000, // Amazon's real total-result distribution for Books
  price: 20
};

export function clamp(value, min, max) {
  return Math.min(max, Math.max(min, value));
}

export function normalize(value, max) {
  if (value == null || Number.isNaN(value)) return 0;
  return clamp(value / max, 0, 1);
}

function avg(arr, fn) {
  const mapper = fn || ((v) => v);
  const vals = arr.map(mapper).filter((v) => v != null && !Number.isNaN(v));
  return vals.length ? vals.reduce((a, b) => a + b, 0) / vals.length : null;
}

function median(arr, fn) {
  const mapper = fn || ((v) => v);
  const vals = arr.map(mapper).filter((v) => v != null && !Number.isNaN(v)).sort((a, b) => a - b);
  if (!vals.length) return null;
  const mid = Math.floor(vals.length / 2);
  return vals.length % 2 ? vals[mid] : (vals[mid - 1] + vals[mid]) / 2;
}

function normalizeTitle(title) {
  return String(title || '').toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
}

/**
 * Amazon SERPs show one card per format (hardcover / paperback / Kindle /
 * audiobook) for what is really a single title. Count how many *actual books*
 * the sample represents by deduping on normalized title.
 */
export function computeDistinctTitleCount(listings = []) {
  const seen = new Set();
  listings.forEach((l) => {
    const key = normalizeTitle(l.title);
    if (key) seen.add(key);
  });
  return seen.size;
}

/**
 * Rating of how "reinforced" the top of the niche is: what share of the
 * top listings carry serious review moats.
 */
export function computeTopConcentration(listings = []) {
  if (!listings.length) return 0;
  const moated = listings.filter((l) => (l.reviewCount || 0) >= 300).length;
  return moated / listings.length;
}

export function computeListingsStats(listings = []) {
  const ranks = listings.map((l) => l.bsr).filter((v) => v != null);
  const medRank = median(ranks);
  return {
    listingCount: listings.length,
    sampleSize: listings.length,
    distinctTitleCount: computeDistinctTitleCount(listings),
    avgPrice: avg(listings, (l) => l.price),
    lowPrice: Math.min(...listings.map((l) => l.price).filter((v) => v != null)),
    highPrice: Math.max(...listings.map((l) => l.price).filter((v) => v != null)),
    avgReviewCount: avg(listings, (l) => l.reviewCount),
    highReviews: Math.max(...listings.map((l) => l.reviewCount || 0)),
    lowReviews: Math.min(...listings.map((l) => l.reviewCount || 0)),
    avgRating: avg(listings, (l) => l.avgRating),
    totalReviews: listings.reduce((a, l) => a + (l.reviewCount || 0), 0),
    avgBsr: avg(ranks),
    medianRank: medRank,
    medianRankBelow: medRank != null ? median(ranks.filter((r) => r > medRank)) : null,
    medianRankAbove: medRank != null ? median(ranks.filter((r) => r < medRank)) : null,
    topConcentration: computeTopConcentration(listings),
    returns4StarLess: listings.filter((l) => (l.avgRating || 0) < 4).length,
    sponsoredCount: listings.filter((l) => l.sponsored).length
  };
}

function isTopLevelRank(category) {
  const c = (category || '').toLowerCase().trim();
  return c === 'books' || /^(kindle store|audible|prime video)\b/.test(c);
}

/**
 * BSR enrichment aggregation (Phase 2). Each sample: { asin, bsr, bsrCategory,
 * allRanks[] }. bestSubcategoryBsr = the lowest sub-category rank across the
 * enriched subset ("< 200" criterion). medianRank = median overall Books rank
 * (used for the sales heuristic).
 */
export function computeBsrStats(bsrSamples = [], sampleSize = 0) {
  const withRank = (bsrSamples || []).filter((s) => s && s.bsr != null);
  if (!withRank.length) {
    return { bestSubcategoryBsr: null, medianRank: null, bsrCoverage: 0, bsrSamples: [] };
  }

  const perSample = withRank.map((s) => {
    const ranks = Array.isArray(s.allRanks) ? s.allRanks : [];
    const subRanks = ranks.filter((r) => r && r.rank != null && !isTopLevelRank(r.category));
    const bestRank = subRanks.length
      ? Math.min(...subRanks.map((r) => r.rank))
      : ranks.length
        ? Math.min(...ranks.map((r) => r.rank))
        : s.bsr;
    return { ...s, bestRank };
  });

  const overall = perSample.map((s) => s.bsr).sort((a, b) => a - b);
  const mid = Math.floor(overall.length / 2);
  const medianRank = overall.length % 2
    ? overall[mid]
    : (overall[mid - 1] + overall[mid]) / 2;

  const coverageDenom = sampleSize > 0 ? sampleSize : perSample.length;
  const bsrCoverage = clamp(perSample.length / coverageDenom, 0, 1);

  return {
    bestSubcategoryBsr: Math.min(...perSample.map((s) => s.bestRank)),
    medianRank,
    bsrCoverage,
    bsrSamples: perSample
  };
}

/**
 * Rough monthly unit estimate for a book niche from its median BSR.
 */
export function estimateMonthlySales(bsr) {
  if (bsr == null || bsr <= 0) return null;
  return Math.max(1, Math.round((120000 / bsr) * 0.62));
}

export function computeDemand(metrics = {}) {
  const reviewFactor = normalize(metrics.totalReviews ?? metrics.reviewCount, NORMALIZE_MAX.reviewCount);
  const bsr = metrics.bestSubcategoryBsr ?? metrics.medianRank ?? metrics.avgBsr ?? metrics.bsr;
  const bsrFactor = bsr != null ? 1 - normalize(bsr, NORMALIZE_MAX.bsr) : 0.5;
  const ratingFactor = metrics.avgRating ? clamp(metrics.avgRating / 5, 0, 1) : 0.5;
  const proxyFactor = metrics.demandProxyScore != null
    ? clamp(metrics.demandProxyScore / 100, 0, 1)
    : 0.5;
  const demand = reviewFactor * 0.2 + bsrFactor * 0.3 + ratingFactor * 0.1 + proxyFactor * 0.4;
  return clamp(demand, 0, 1);
}

export function computeCompetition(metrics = {}) {
  // True Amazon result count (Gap A fix) is the primary competition-volume
  // signal. The ≤48-card sample size is only a fallback when it is missing.
  const total = metrics.totalResultsCount;
  const listingFactor = total != null
    ? normalize(total, NORMALIZE_MAX.totalResultsCount)
    : normalize(metrics.sampleSize ?? metrics.listingCount, NORMALIZE_MAX.listingCount);
  const reviewFactor = normalize(metrics.totalReviews ?? metrics.reviewCount, NORMALIZE_MAX.reviewCount);
  const concentration = metrics.topConcentration ?? 0;
  const priceFactor = 1 - normalize(metrics.avgPrice, NORMALIZE_MAX.price);
  const adFactor = metrics.sponsoredCount ? clamp(metrics.sponsoredCount / 4, 0, 1) : 0;
  const competition =
    listingFactor * 0.3 + reviewFactor * 0.25 + concentration * 0.25 + priceFactor * 0.1 + adFactor * 0.1;
  return clamp(competition, 0, 1);
}

export function computeMargin(metrics = {}) {
  const priceFactor = metrics.avgPrice
    ? clamp((metrics.avgPrice - 2) / (NORMALIZE_MAX.price - 2), 0, 1)
    : 0.35;
  const lowCompetition = 1 - computeCompetition(metrics);
  const kindleFactor = metrics.kindleShare != null ? metrics.kindleShare : 0.35;
  const margin = priceFactor * 0.5 + lowCompetition * 0.35 + kindleFactor * 0.15;
  return clamp(margin, 0, 1);
}

export function computeConfidence(metrics = {}) {
  const baseSignals = [
    ['sampleSize', 'listingCount'],
    'totalReviews',
    'avgRating',
    'avgPrice',
    'topConcentration'
  ];
  let met = 0;
  baseSignals.forEach((sig) => {
    if (Array.isArray(sig)) {
      if (sig.some((k) => metrics[k] != null && metrics[k] !== undefined)) met += 1;
    } else if (metrics[sig] != null && metrics[sig] !== undefined) {
      met += 1;
    }
  });
  let total = baseSignals.length;

  // Real BSR coverage (from enrichment) boosts confidence when it exists.
  const cov = metrics.bsrCoverage;
  if (cov != null && cov > 0) {
    met += 1;
    total += 1;
  }

  return clamp(met / total, 0, 1);
}

export function computeOpportunityScore(metrics = {}) {
  const demand = metrics.demand ?? computeDemand(metrics);
  const competition = metrics.competition ?? computeCompetition(metrics);
  const margin = metrics.margin ?? computeMargin(metrics);

  const score =
    demand * SCORE_WEIGHTS.demand +
    (1 - competition) * SCORE_WEIGHTS.competition +
    margin * SCORE_WEIGHTS.margin;

  return {
    score: clamp(score, 0, 1) * 100,
    demand,
    competition,
    margin,
    confidence: computeConfidence(metrics)
  };
}

export function verdict(score) {
  if (score == null) return { label: 'Unknown', tone: 'muted' };
  if (score >= 75) return { label: 'Excellent niche', tone: 'excellent' };
  if (score >= 60) return { label: 'Promising niche', tone: 'good' };
  if (score >= 40) return { label: 'Competitive niche', tone: 'fair' };
  return { label: 'Hard niche', tone: 'poor' };
}

/**
 * §3 qualification contract. All gates (including the KDP-publishable
 * content-type gate) must be true for qualifies.all. Thresholds come from
 * Settings, not hardcoded.
 */
export function computeQualifies(metrics = {}, thresholds = {}) {
  const bsrThreshold = thresholds.bsrThreshold ?? 200;
  const listingsThreshold = thresholds.listingsThreshold ?? 1000;
  const volumeThreshold = thresholds.volumeThreshold ?? 50;
  const contentTypeEnabled = thresholds.contentTypeEnabled !== false;

  const excluded =
    metrics.contentType === 'high-content-excluded' ||
    metrics.requiresExpertise === true;

  const q = {
    bsr: metrics.bestSubcategoryBsr != null
      ? metrics.bestSubcategoryBsr <= bsrThreshold
      : false,
    listings: metrics.totalResultsCount != null
      ? metrics.totalResultsCount <= listingsThreshold
      : false,
    volume: metrics.demandProxyScore != null
      ? metrics.demandProxyScore >= volumeThreshold
      : false,
    contentType: contentTypeEnabled ? !excluded : true
  };
  q.all = q.bsr && q.listings && q.volume && q.contentType;
  return q;
}

export function attachQualifies(record, thresholds = {}) {
  if (!record || typeof record !== 'object') return record;
  record.qualifies = computeQualifies(record.metrics || {}, thresholds);
  return record;
}

export function preprocessMetrics(listings, extra = {}) {
  const stats = computeListingsStats(listings);
  const withKindle = listings.filter((l) => l.mediaType === 'kindle' || l.mediaType === 'ebook').length;
  stats.kindleShare = listings.length ? withKindle / listings.length : 0;
  stats.estimatedMonthlySales = estimateMonthlySales(stats.medianRank ?? stats.avgBsr);
  stats.sample = listings.slice(0, 12);
  stats.sampleSize = stats.listingCount;
  if (extra.totalResultsCount != null) {
    stats.totalResultsCount = extra.totalResultsCount;
    stats.resultsCountIsApprox = !!extra.resultsCountIsApprox;
  }
  return stats;
}

/** Merge a freshly-parsed BSR sample into an existing metrics object. */
export function applyBsrSamples(metrics = {}, bsrSamples = [], sampleSize = 0, thresholds = {}) {
  const bsrStats = computeBsrStats(bsrSamples, sampleSize);
  const merged = { ...metrics, ...bsrStats };
  merged.estimatedMonthlySales = estimateMonthlySales(merged.medianRank ?? merged.avgBsr);
  merged.bestSubcategoryBsr = bsrStats.bestSubcategoryBsr;
  return merged;
}

/**
 * Long-tail keyword bonus: keywords with 3+ words usually signal a more
 * specific buyer and weaker head-term competition.
 */
export function longTailKeywordBoost(keyword) {
  const words = (keyword || '').trim().split(/\s+/).filter(Boolean);
  if (words.length >= 5) return 1.08;
  if (words.length >= 3) return 1.04;
  return 1;
}

export function scoreKeyword(keyword, metrics = {}, options = {}) {
  const processed = metrics && (metrics.listingCount != null || metrics.sampleSize != null)
    ? metrics
    : preprocessMetrics(metrics.sample || []);

  const demand = computeDemand(processed);
  const competition = computeCompetition(processed);
  const margin = computeMargin(processed);
  const base = computeOpportunityScore({ ...processed, demand, competition, margin });
  const boost = options.longTail ? longTailKeywordBoost(keyword) : 1;

  const scored = {
    keyword,
    metrics: processed,
    demand,
    competition,
    margin,
    confidence: base.confidence,
    estimatedMonthlySales: processed.estimatedMonthlySales ?? null,
    verdict: verdict(base.score * boost),
    score: clamp(base.score * boost, 0, 100)
  };
  if (options.thresholds) attachQualifies(scored, options.thresholds);
  return scored;
}