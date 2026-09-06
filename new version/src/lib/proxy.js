import { clamp } from './scoring.js';

export const PROXY_LABEL = 'Interest proxy';

const MAX_TERMS_PER_ENGINE = 120;
const MAX_WEIGHTED_SUM = 1000; // 100 terms at position 1 (weight 10) each

function normalizeTerm(term) {
  return (term || '').toLowerCase().trim().replace(/\s+/g, ' ').replace(/[.,!?]+$/, '');
}

function positionWeight(position) {
  // Position 1 = strongest signal (weight 10), position 11 = weakest (weight 1).
  const p = Number.isFinite(position) ? position : 1;
  return Math.max(1, 11 - p);
}

/**
 * Score one engine's autocomplete corpus (alphabet-soup depth + position).
 * Entries may be plain suggestion strings or { term, position } objects.
 * Returns [0..1] normalized score plus a breakdown for transparency.
 */
export function engineCorpusScore(entries) {
  if (typeof entries === 'number') {
    return [clamp(entries / MAX_TERMS_PER_ENGINE, 0, 1), { count: entries, weightedSum: 0 }];
  }
  const list = (entries || []).slice(0, MAX_TERMS_PER_ENGINE);
  if (!list.length) return [0, { count: 0, weightedSum: 0 }];

  const weightedSum = list.reduce((acc, entry, idx) => {
    const position = entry && typeof entry === 'object' && entry.position != null
      ? entry.position
      : idx + 1;
    return acc + positionWeight(position);
  }, 0);

  return [clamp(weightedSum / MAX_WEIGHTED_SUM, 0, 1), { count: list.length, weightedSum }];
}

function crossEngineMatches(amazon, google) {
  if (!Array.isArray(amazon) || !Array.isArray(google)) return 0;
  const gTerms = new Set(google.map((g) => normalizeTerm(g && typeof g === 'object' ? g.term : g)));
  const seen = new Set();
  let matches = 0;
  amazon.forEach((a) => {
    const t = normalizeTerm(a && typeof a === 'object' ? a.term : a);
    if (t && gTerms.has(t) && !seen.has(t)) {
      seen.add(t);
      matches++;
    }
  });
  return matches;
}

/**
 * Combined "interest proxy" (0-100). Honestly labeled — this is NOT a monthly
 * search-volume number (no free/official source exists). It is a composite of:
 *   - autocomplete depth & suggestion-position within the seed's alphabet soup (Amazon)
 *   - the same signal from Google Suggest
 *   - cross-engine confirmation (same term in both = stronger signal)
 */
export function computeDemandProxyScore({ amazon = [], google = [] } = {}) {
  const [amScore, amDetail] = engineCorpusScore(amazon);
  const [goScore, goDetail] = engineCorpusScore(google);
  const cross = crossEngineMatches(amazon, google);
  const crossFactor = cross > 0 ? clamp(0.3 + cross * 0.14, 0, 1) : 0;

  const composite = amScore * 0.4 + goScore * 0.25 + crossFactor * 0.35;

  return {
    score: Math.round(clamp(composite, 0, 1) * 100),
    breakdown: {
      amazon: amDetail,
      google: goDetail,
      crossMatches: cross
    }
  };
}

function normalizeTermOrEntry(entry) {
  return normalizeTerm(entry && typeof entry === 'object' ? entry.term : entry);
}

function bestPosition(term, corpus) {
  const t = normalizeTerm(term);
  if (!t || !Array.isArray(corpus)) return null;
  for (let i = 0; i < corpus.length; i++) {
    const et = normalizeTermOrEntry(corpus[i]);
    if (et === t) {
      const entry = corpus[i];
      return entry && typeof entry === 'object' && entry.position != null ? entry.position : i + 1;
    }
  }
  return null;
}

/**
 * Per-suggestion proxy derived from a shared alphabet-soup corpus (Phase 3).
 * A single soup run costs ~54 fetches; running a full soup per *suggestion*
 * would be prohibitively chatty. Instead each suggestion inherits the depth of
 * its seed's neighborhood (`seedProxyScore`) and gains position weight from
 * where it actually appears in the soup + cross-engine confirmation.
 *
 * Returns `null` when the term appears in NEITHER engine's soup — there is no
 * signal at all here, and the caller must either probe the term directly or
 * leave it "not yet measured" instead of inheriting a shared constant that
 * would make every unrelated suggestion look identically interesting
 * (the duplicate-tuple bug from Revision 2).
 */
export function deriveSuggestionProxy(term, corpus = {}, seedProxyScore = 0) {
  const amazonPos = bestPosition(term, corpus.amazon);
  const googlePos = bestPosition(term, corpus.google);
  if (amazonPos == null && googlePos == null) return null;

  const posSignal =
    amazonPos != null && googlePos != null
      ? ((11 - amazonPos) / 10 + (11 - googlePos) / 10) / 2
      : amazonPos != null
        ? (11 - amazonPos) / 10
        : googlePos != null
          ? (11 - googlePos) / 10
          : 0;
  const crossSignal = amazonPos != null && googlePos != null ? 0.5 : 0;
  const depthSignal = clamp((seedProxyScore || 0) / 100, 0, 1);
  const combined = clamp(depthSignal * 0.25 + clamp(posSignal, 0, 1) * 0.55 + crossSignal * 0.2, 0, 1);
  return Math.round(combined * 100);
}