export const SCORE_WEIGHTS = {
  demand: 0.45,
  competition: 0.35,
  margin: 0.2
};

const NORMALIZE_MAX = {
  reviewCount: 2000,
  bsr: 50000,
  listingCount: 200,
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

/**
 * Rating of how "reinforced" the top of the niche is: what share of the
 * top listings carry serious review moats. Mirrors Productor's rank-percent
 * "average quality of the top results" signal.
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

/**
 * Rough monthly unit estimate for a book niche from its median BSR.
 * Heuristic: demand decays roughly inverse to rank in the Books category.
 */
export function estimateMonthlySales(bsr) {
  if (bsr == null || bsr <= 0) return null;
  return Math.max(1, Math.round((120000 / bsr) * 0.62));
}

export function computeDemand(metrics = {}) {
  const reviewFactor = normalize(metrics.totalReviews ?? metrics.reviewCount, NORMALIZE_MAX.reviewCount);
  const bsr = metrics.medianRank ?? metrics.avgBsr ?? metrics.bsr;
  const bsrFactor = bsr != null ? 1 - normalize(bsr, NORMALIZE_MAX.bsr) : 0.5;
  const ratingFactor = metrics.avgRating ? clamp(metrics.avgRating / 5, 0, 1) : 0.5;
  const demand = reviewFactor * 0.4 + bsrFactor * 0.4 + ratingFactor * 0.2;
  return clamp(demand, 0, 1);
}

export function computeCompetition(metrics = {}) {
  const listingFactor = normalize(metrics.listingCount, NORMALIZE_MAX.listingCount);
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
  const signals = [
    'listingCount',
    'totalReviews',
    'avgRating',
    'avgPrice',
    'topConcentration'
  ].filter((k) => {
    const v = metrics[k];
    return v != null && v !== undefined;
  }).length;
  return clamp(signals / 5, 0, 1);
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

export function preprocessMetrics(listings) {
  const stats = computeListingsStats(listings);
  const withKindle = listings.filter((l) => l.mediaType === 'kindle' || l.mediaType === 'ebook').length;
  stats.kindleShare = listings.length ? withKindle / listings.length : 0;
  stats.estimatedMonthlySales = estimateMonthlySales(stats.medianRank ?? stats.avgBsr);
  stats.sample = listings.slice(0, 12);
  return stats;
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
  const processed = metrics && metrics.listingCount != null
    ? metrics
    : preprocessMetrics(metrics.sample || []);

  const demand = computeDemand(processed);
  const competition = computeCompetition(processed);
  const margin = computeMargin(processed);
  const base = computeOpportunityScore({ ...processed, demand, competition, margin });
  const boost = options.longTail ? longTailKeywordBoost(keyword) : 1;

  return {
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
}