/**
 * KDP Copilot v0.4.0 unit tests — pure data-layer logic only (Phase 8).
 * Run:  node tests/run-tests.mjs
 * Covers: scoring.js (qualification gates, BSR min-of-subcategory, true
 * result-count competition) and proxy.js (demand-proxy regression + derived
 * per-suggestion proxies).
 */
import {
  computeQualifies,
  preprocessMetrics,
  applyBsrSamples,
  scoreKeyword,
  computeCompetition,
  computeBsrStats,
  computeListingsStats
} from '../src/lib/scoring.js';
import {
  computeDemandProxyScore,
  deriveSuggestionProxy
} from '../src/lib/proxy.js';
import { classifyContentType, isLowContentNiche, scopeAllows } from '../src/lib/content-type.js';
import { isSuggestibleSuggestion, buildChatBody, parseChatResponse, buildResponsesBody, parseResponsesResponse, customTransportFor, sanitizeGeminiModel, fetchModelChoices, sanitizeJson, isJsonFormatError, isOverloadedError, retryOnOverload } from '../src/background/ai.js';
import { parsePubDate, isFreshPub } from '../src/lib/dates.js';
import { computeBrandRisk, matchBlockedBrand, matchFamousAuthor, computeAuthorFrequencyRisk, flagBrandedSamples } from '../src/lib/brands.js';
import { buildRegistryLookups, localTrademarkScreen, COPYRIGHT_NOTE } from '../src/lib/trademark-registry.js';
import { MARKETS, getMarket, searchUrl, myResearchBaseUrl, suggestHost, autocompleteUrl, locationChangeEndpoint, buildLocationPayload, glowMatchesZip } from '../src/lib/markets.js';
import { cleanTitleToKeyword } from '../src/background/discovery.js';
import { pickDiscoveryNodes, RULE8_PRIORITY_NODE_IDS } from '../src/lib/categories.js';

let passed = 0;
let failed = 0;

function assert(cond, label) {
  if (cond) {
    passed++;
    console.log(`  ok  ${label}`);
  } else {
    failed++;
    console.error(`FAIL  ${label}`);
  }
}

function approx(a, b, eps = 1e-6) {
  return Math.abs(a - b) <= eps;
}

console.log('\n[1] Qualification gates (computeQualifies, rules v1)');
{
  const t = {
    overallBsrMax: 200000,
    usListingsMax: 1000,
    otherListingsMax: 800,
    volumeThreshold: 50,
    maxBookAgeMonths: 6,
    freshHitsMin: 1,
    subBsrEnabled: false
  };

  // Rules v1 full pass: one fresh hit (2mo old, BSR 150k) + BSR/listings/volume ok.
  const now = Date.now();
  const twoMonthsAgo = now - 60 * 24 * 60 * 60 * 1000;
  const freshMetrics = {
    totalResultsCount: 900,
    demandProxyScore: 60,
    contentType: 'low-content',
    bsrSamples: [
      { asin: 'A', bsr: 150000, pubDateEpoch: twoMonthsAgo },
      { asin: 'B', bsr: 90000, pubDateEpoch: now - 400 * 24 * 60 * 60 * 1000 } // old book — not a fresh hit, but BSR gate passes
    ]
  };
  const q1 = computeQualifies(freshMetrics, t, 'us');
  assert(q1.fresh && q1.bsrOverall && q1.listings && q1.volume && q1.all === true, 'fresh hit + all gates → qualifies');

  // No fresh (all books older than 6 months) → fresh gate fails.
  const noFresh = computeQualifies(
    { ...freshMetrics, bsrSamples: [{ asin: 'B', bsr: 90000, pubDateEpoch: now - 400 * 24 * 60 * 60 * 1000 }] },
    t, 'us'
  );
  assert(q1.fresh === true && noFresh.fresh === false && noFresh.all === false, 'all competitors >6mo old → fresh gate fails');

  // Overall BSR above 200k → bsrOverall gate fails (rule 2).
  const badBsr = computeQualifies(
    { ...freshMetrics, bsrSamples: [{ asin: 'C', bsr: 250000, pubDateEpoch: twoMonthsAgo }] },
    t, 'us'
  );
  assert(badBsr.bsrOverall === false && badBsr.all === false, 'overall BSR 250k > 200k → fails gate');

  // Market-aware listing caps: 900 ok in US, fails at the 800 cap elsewhere.
  const ukQ = computeQualifies(freshMetrics, t, 'uk');
  assert(ukQ.listings === false && ukQ.all === false, '900 results > 800 non-US cap → fails gate in UK');
  const usQ = computeQualifies(freshMetrics, t, 'us');
  assert(usQ.listings === true, '900 results ≤ 1000 US cap → passes in US');

  // Missing BSR data → fresh/bsrOverall gates stay false (no false-positive).
  const qGap = computeQualifies({ totalResultsCount: 50, demandProxyScore: 80 }, t, 'us');
  assert(qGap.bsrOverall === false && qGap.fresh === false, 'missing BSR → gates stay false (no false-positive)');

  const qNoData = computeQualifies({}, t, 'us');
  assert(qNoData.all === false, 'empty metrics → not qualify');
}

console.log('\n[2] Total-results competition signal');
{
  // Only the volume signal is set; price baseline (0.1 weight) stays constant.
  assert(approx(computeCompetition({ totalResultsCount: 0 }), 0.1), '0 results → baseline price factor only (0.1)');
  const low = computeCompetition({ totalResultsCount: 100 });
  const high = computeCompetition({ totalResultsCount: 90000 });
  assert(high > low, 'higher raw result count → higher competition');
  assert(approx(high, 0.4), '10000+ results saturates volume term: 0.3 (volume) + 0.1 (price baseline) = 0.4');

  // Without a true count, falls back to sample-size heuristic.
  const fallback = computeCompetition({ sampleSize: 48 });
  assert(approx(computeCompetition({ sampleSize: 48 }), computeCompetition({ totalResultsCount: null, sampleSize: 48 })),
    'fallback path consistent');
  assert(!Number.isNaN(fallback), 'fallback yields a number');
}

console.log('\n[3] pure preprocessMetrics with true result count');
{
  const listings = Array.from({ length: 6 }, (_, i) => ({
    asin: `B00000000${i}`,
    title: `Listing ${i}`,
    price: 9.99 + i,
    reviewCount: i * 5,
    avgRating: 4.5,
    mediaType: 'kindle',
    sponsored: i === 0
  }));
  const m = preprocessMetrics(listings, { totalResultsCount: 4210, resultsCountIsApprox: true });
  assert(m.totalResultsCount === 4210, 'totalResultsCount captured');
  assert(m.resultsCountIsApprox === true, 'approx flag captured');
  assert(m.sampleSize === 6, 'sample size = scraped card count');
  assert(m.kindleShare === 1, 'kindle share computed');

  const s = scoreKeyword('low carb cookbook for air fryer', m, { longTail: true });
  assert(s && typeof s.score === 'number' && s.score >= 0 && s.score <= 100, 'score within 0..100');
  assert(s.metrics.totalResultsCount === 4210, 'scored record carries totalResultsCount');
  assert(s.demand != null && s.competition != null, 'demand/competition computed');
}

console.log('\n[4] BSR enrichment: min of sub-category ranks per sample');
{
  // Two samples: first ranks #5 in a sub-category, #9000 overall; second #300 sub, #8000 overall.
  const samples = [
    {
      asin: 'AAAAAAAAAA',
      bsr: 9000,
      allRanks: [
        { rank: 9000, category: 'Books' },
        { rank: 5, category: 'Low-Carb Cooking' }
      ]
    },
    {
      asin: 'BBBBBBBBBB',
      bsr: 8000,
      allRanks: [
        { rank: 8000, category: 'Books' },
        { rank: 300, category: 'Low-Carb Cooking' }
      ]
    }
  ];
  const stats = computeBsrStats(samples, 2);
  assert(stats.bestSubcategoryBsr === 5, 'best sub-category BSR = min(5,300) = 5');
  assert(approx(stats.bsrCoverage, 1), 'full sample coverage → 1');
  assert(stats.medianRank === 8500, 'overall median preserved (9000+8000)/2');

  const withThreshold = computeQualifies({ ...stats, totalResultsCount: 200, demandProxyScore: 80 },
    { subBsrEnabled: true, bsrThreshold: 200, usListingsMax: 1000, otherListingsMax: 800, volumeThreshold: 50 }, 'us');
  assert(withThreshold.bsr === true, 'sub-BSR gate (opt-in): BSR 5 ≤ 200 → qualifies');

  // Partial enrichment: 1 of 8 expected → coverage low, BSR still usable.
  const partial = computeBsrStats(samples.slice(0, 1), 8);
  assert(approx(partial.bsrCoverage, 0.125), 'partial coverage 1/8 = 0.125');

  const m = preprocessMetrics([], {});
  const merged = applyBsrSamples(m, samples, 2);
  assert(merged.bestSubcategoryBsr === 5, 'applyBsrSamples merges best sub-category BSR');
  assert(merged.estimatedMonthlySales != null, 'sales heuristic derived from BSR');
}

console.log('\n[5] Demand-proxy regression (fixed corpus)');
{
  const corpus = {
    amazon: [
      { term: 'homeschool curriculum', position: 1 },
      { term: 'homeschool curriculum 1st grade', position: 2 },
      { term: 'homeschool schedule', position: 3 }
    ],
    google: [
      { term: 'homeschool curriculum', position: 1 },
      { term: 'homeschool printables', position: 2 }
    ]
  };
  const r1 = computeDemandProxyScore(corpus);
  const r2 = computeDemandProxyScore(corpus);
  assert(r1.score === r2.score, 'deterministic (same input → same score)');
  assert(r1.score >= 0 && r1.score <= 100, 'score in 0..100');

  const small = computeDemandProxyScore({ amazon: [], google: [] });
  assert(small.score >= 0 && small.score <= 100, 'empty corpus does not crash');

  const withCross = computeDemandProxyScore({
    amazon: [{ term: 'kids activity book', position: 1 }, { term: 'kids activity book free', position: 2 }],
    google: [{ term: 'kids activity book', position: 1 }, { term: 'kids activity book printable', position: 2 }]
  });
  const withoutCross = computeDemandProxyScore({
    amazon: [{ term: 'kids mood tracker', position: 1 }, { term: 'kids mood journals', position: 2 }],
    google: [{ term: 'kids chores chart', position: 1 }, { term: 'kids chore charts', position: 2 }]
  });
  assert(withCross.score > withoutCross.score, 'same depth, cross-engine confirmed term → higher proxy');
}

console.log('\n[6] deriveSuggestionProxy determinism + position weighting');
{
  const corpus = {
    amazon: [],
    google: []
  };
  const a = deriveSuggestionProxy('x y', corpus, 60);
  const b = deriveSuggestionProxy('x y', corpus, 60);
  assert(a === b, 'deterministic given same corpus + seed');
  assert(a >= 0 && a <= 100, 'score in 0..100');

  const posCorpus = {
    amazon: [{ term: 'kids activity book', position: 1 }],
    google: [{ term: 'kids activity book', position: 1 }]
  };
  const top = deriveSuggestionProxy('kids activity book', posCorpus, 60);
  const absent = deriveSuggestionProxy('somewhere far', posCorpus, 60);
  assert(top != null && absent === null, 'term in soup yields a proxy; full-miss term returns null ("not yet measured")');

  const deeperSeed = deriveSuggestionProxy('kids activity book', posCorpus, 95);
  const shallowerSeed = deriveSuggestionProxy('kids activity book', posCorpus, 20);
  assert(deeperSeed >= shallowerSeed, 'same position, stronger seed depth → at least as high');
}

console.log('\n[7] KDP-publishable content-type classifier (classifyContentType)');
{
  // rule8 is now the DEFAULT scope: low-content + puzzle/coloring/photography/
  // sheet-music/manual/textbook/children's families; fiction + prose excluded.
  const j = classifyContentType({ keyword: 'wellness journal for women' });
  assert(j.contentType === 'low-content' && j.requiresExpertise === false, 'journal keyword → low-content, publishable');

  const med = classifyContentType({ keyword: 'clinical handbook of diabetes' });
  assert(med.contentType === 'high-content-excluded' && med.requiresExpertise === true, 'clinical handbook → excluded (expertise)');

  const col = classifyContentType({ keyword: 'coloring book for adults animals' });
  assert(col.contentType === 'medium-content' && col.requiresExpertise === false, 'coloring book → medium-content (rule8 family)');

  const nov = classifyContentType({ keyword: 'historical novel' });
  assert(nov.contentType === 'high-content-excluded' && nov.requiresExpertise === false, 'novel keyword → excluded (fiction, not expertise)');

  const log = classifyContentType({ keyword: 'clinical trial logbook' });
  assert(log.contentType === 'low-content', 'strong low signal (logbook) overrides weak clinical overlap');

  const pers = classifyContentType({ keyword: 'personalized name book' });
  assert(pers.contentType === 'personalized', 'personalized keyword → personalized');

  const bio = classifyContentType({ keyword: 'molecular biology' });
  assert(bio.contentType === 'high-content-excluded' && bio.requiresExpertise === true, 'scientific keyword → excluded');

  // Title-level majority verdict (>=3 sampled titles, high dominates).
  const byTitles = classifyContentType({
    keyword: 'post apocalyptic survival',
    titles: ['The Stand: A Novel', 'The Road: A Novel', 'Station Eleven: A Novel', 'World War Z: A Novel', 'One Second After: A Novel']
  });
  assert(byTitles.contentType === 'high-content-excluded', 'novel-marked sample titles → title-level exclusion');

  const journalTitles = classifyContentType({
    keyword: 'daily reflection',
    titles: ['My Gratitude Journal', 'Daily Prompt Journal for Women', 'The Five Minute Journal', 'Morning Pages Notebook']
  });
  assert(journalTitles.contentType === 'low-content', 'journal-marked sample titles → low-content');

  // Category breadcrumb deny/allow.
  const catDeny = classifyContentType({
    keyword: 'autoimmune wellness',
    categories: ['Books', 'Health, Fitness & Dieting', 'Medical', 'Diseases & Physical Ailments']
  });
  assert(catDeny.contentType === 'high-content-excluded' && catDeny.requiresExpertise === true, 'medical breadcrumb → excluded');

  const catNovel = classifyContentType({
    keyword: 'summer reading lists',
    categories: ['Books', 'Literature & Fiction']
  });
  assert(catNovel.contentType === 'high-content-excluded', 'fiction breadcrumb → excluded');

  // Kindle-format availability signal.
  const kindle = classifyContentType({ keyword: 'nurse appreciation', kindleShare: 0.05, sampleSize: 8 });
  assert(kindle.contentType === 'low-content' && kindle.contentTypeSource === 'format-signal', 'low Kindle share → low-content format tell');
}

console.log('\n[8] Rules-v1 content gate in computeQualifies');
{
  const now = Date.now();
  const t = {
    overallBsrMax: 200000, usListingsMax: 1000, otherListingsMax: 800,
    volumeThreshold: 50, maxBookAgeMonths: 6, freshHitsMin: 1
  };
  const freshSample = { asin: 'X', bsr: 100000, pubDateEpoch: now - 30 * 24 * 60 * 60 * 1000 };

  const ok = computeQualifies(
    { totalResultsCount: 900, demandProxyScore: 60, contentType: 'low-content', bsrSamples: [freshSample] },
    t, 'us'
  );
  assert(ok.contentType === true && ok.all === true, 'publishable content + gates → qualifies');

  const excluded = computeQualifies(
    { totalResultsCount: 900, demandProxyScore: 60, contentType: 'high-content-excluded', bsrSamples: [freshSample] },
    t, 'us'
  );
  assert(excluded.contentType === false && excluded.all === false, 'excluded content → fails gate even with good BSR');

  const expert = computeQualifies(
    { totalResultsCount: 900, demandProxyScore: 60, requiresExpertise: true, bsrSamples: [freshSample] },
    t, 'us'
  );
  assert(expert.contentType === false && expert.all === false, 'expertise-required flag → fails gate');

  // Rule8 scope: unclassified keywords are NOT part of the publishable
  // families — they fail the gate (a deliberate rules-v1 tightening).
  const unknown = computeQualifies(
    { totalResultsCount: 900, demandProxyScore: 60, contentType: 'unknown', bsrSamples: [freshSample] },
    t, 'us'
  );
  assert(unknown.contentType === false && unknown.all === false, 'unclassified (unknown) fails the rules-v1 gate');

  const off = computeQualifies(
    { totalResultsCount: 900, demandProxyScore: 60, contentType: 'high-content-excluded', bsrSamples: [freshSample] },
    { ...t, contentTypeEnabled: false }, 'us'
  );
  assert(off.contentType === true, 'filter disabled → exclusions ignored for the content gate');
}

console.log('\n[9] Revision 2: existing-book titles + isSuggestibleSuggestion gate');
{
  // The named failing titles carry no low-content/rule8 markers, so the
  // classifier excludes them in rule8 scope — even harder than the old
  // "unknown drop", because they're not in the publishable families.
  for (const kw of ['the intelligent investor', 'antifragile', 'principles: life and work', 'the runaway bunny']) {
    const ct = classifyContentType({ keyword: kw, scope: 'rule8' });
    assert(ct.contentType === 'high-content-excluded', `"${kw}" excluded in rule8 scope (not a publishable family)`);
  }

assert(isSuggestibleSuggestion({ keyword: 'the intelligent investor', isExistingTitle: true }, { scope: 'standard' }) === false, 'model-self-flagged existing title rejected');
  assert(isSuggestibleSuggestion({ keyword: 'sudoku for adults', why: 'bestseller in its node' }, { scope: 'standard' }) === false, '"bestseller" tell rejected');
  assert(isSuggestibleSuggestion({ keyword: 'kids activity book', why: 'a low competition classic pick' }, { scope: 'standard' }) === false, '"classic" tell rejected');
  assert(isSuggestibleSuggestion({ keyword: 'kids activity book', category: 'guide by mary smith on basics' }, { scope: 'standard' }) === false, '"by <Author>" tell rejected');
  assert(isSuggestibleSuggestion({ keyword: 'clinical handbook of diabetes' }, { scope: 'standard' }) === false, 'hard-excluded engine suggestion rejected');
  assert(isSuggestibleSuggestion({ keyword: 'vegan beginner cookbook', titleIdea: 'The Everyday Vegan Cookbook', why: 'recipe compilation for beginners' }, { scope: 'standard' }) === true, 'clean guide suggestion passes (standard scope)');

  // Rules-v1 (rule8) default scope: family niches survive, prose/fiction die.
  assert(isSuggestibleSuggestion({ keyword: 'wellness journal for women' }) === true, 'rule8 scope keeps a journal niche');
  assert(isSuggestibleSuggestion({ keyword: 'sudoku puzzle book for adults' }) === true, 'rule8 scope keeps puzzle books');
  assert(isSuggestibleSuggestion({ keyword: 'coloring book for adults animals' }) === true, 'rule8 scope keeps coloring books');
  assert(isSuggestibleSuggestion({ keyword: 'cozy mysteries for seniors' }) === false, 'rule8 scope drops fiction');
  assert(isSuggestibleSuggestion({ keyword: 'beginners guide to gardening' }) === false, 'rule8 scope drops non-fiction guides');
}

console.log('\n[10] leader-dominance fingerprint (single-work-driven terms)');
{
  const single = computeListingsStats(
    [1, 2, 3, 4, 5].map((n) => ({ title: `The One Big Book${n}`, reviewCount: n === 1 ? 500 : 10, avgRating: 4.5, price: 12 }))
  );
  assert(single.leaderDominanceRatio > 0.9, `top title dominates review share (${single.leaderDominanceRatio.toFixed(2)})`);

  const broad = computeListingsStats(
    [1, 2, 3, 4, 5].map((n) => ({ title: `Guide Volume ${n}`, reviewCount: 90 + n * 5, avgRating: 4.5, price: 12 }))
  );
  assert(broad.leaderDominanceRatio < 0.4, `review share spread across several titles (${broad.leaderDominanceRatio.toFixed(2)})`);

  const now = Date.now();
  const t = {
    overallBsrMax: 200000, usListingsMax: 1000, otherListingsMax: 800,
    volumeThreshold: 50, maxBookAgeMonths: 6, freshHitsMin: 1
  };
  const freshSample = { asin: 'Y', bsr: 100000, pubDateEpoch: now - 30 * 24 * 60 * 60 * 1000 };
  const dominated = computeQualifies(
    { totalResultsCount: 700, demandProxyScore: 60, contentType: 'guide', leaderDominanceRatio: 0.93, totalReviews: 540, sampleSize: 5, bsrSamples: [freshSample] },
    t, 'us'
  );
  assert(dominated.contentType === false && dominated.all === false, 'single title owns >60% of reviews → fails content gate');

  const healthy = computeQualifies(
    { totalResultsCount: 700, demandProxyScore: 60, contentType: 'guide', leaderDominanceRatio: 0.3, totalReviews: 540, sampleSize: 5, bsrSamples: [freshSample] },
    t, 'us'
  );
  assert(healthy.contentType === true && healthy.all === true, 'spread review share → still qualifies');
}

console.log('\n[11] v0.5: narrow-fiction carve-out (standard scope) + writer-craft denial');
{
  // Standard scope keeps the narrow-fiction carve-out; rules-v1 scope never
  // allows fiction (rule 8: avoid novels/fiction).
  const cozy = classifyContentType({ keyword: 'cozy mysteries for seniors', scope: 'standard' });
  assert(cozy.contentType === 'fiction' && cozy.requiresExpertise === false, 'specific long-tail fiction → fiction-niche (standard)');

  const cozyRule8 = classifyContentType({ keyword: 'cozy mysteries for seniors', scope: 'rule8' });
  assert(cozyRule8.contentType === 'high-content-excluded', 'rule8 scope excludes fiction');

  const chapters = classifyContentType({ keyword: 'chapter books for girls 6 to 8', scope: 'standard' });
  assert(chapters.contentType === 'rule8-content', "children's chapter books are a rule8 family (even in standard scope)");

  const chaptersR8 = classifyContentType({ keyword: 'chapter books for girls 6 to 8', scope: 'rule8' });
  assert(chaptersR8.contentType === 'rule8-content', "rule8 scope keeps children's chapter books");

  const broad = classifyContentType({ keyword: 'romance novels', scope: 'standard' });
  assert(broad.contentType === 'high-content-excluded', 'generic fiction term stays excluded');

  const off = classifyContentType({ keyword: 'cozy mysteries for seniors', allowFiction: false, scope: 'standard' });
  assert(off.contentType === 'high-content-excluded', 'fiction carve-out disabled → excluded again');

  const med = classifyContentType({ keyword: 'medical romance novel', scope: 'standard' });
  assert(med.contentType === 'high-content-excluded', 'expertise + fiction overlap stays excluded');

  const wc1 = classifyContentType({ keyword: 'how to write a book', scope: 'standard' });
  assert(wc1.contentType === 'high-content-excluded', 'writer-craft guide → excluded');

  const wc2 = classifyContentType({ keyword: 'book marketing for authors', scope: 'standard' });
  assert(wc2.contentType === 'high-content-excluded', 'publishing-marketing guide → excluded');

  const keep = classifyContentType({ keyword: 'novel writing planner', scope: 'standard' });
  assert(keep.contentType === 'low-content', 'planner family overrides writer-craft text → low-content');

  const keep2 = classifyContentType({ keyword: 'planner for self published authors', scope: 'standard' });
  assert(keep2.contentType === 'low-content', 'planner for the author audience is still a planner');

  const unk = classifyContentType({ keyword: 'space opera romance for adults', scope: 'standard' });
  assert(unk.contentType === 'fiction', 'subgenre + audience fiction → fiction-niche');
}

console.log('\n[12] v0.6 strict scope: Amazon "generally low-content" list only');
{
  const j = classifyContentType({ keyword: 'wellness journal for women', scope: 'strict' });
  assert(isLowContentNiche(j) && j.contentTypeLabel === 'Journal', 'journal → strict low-content');

  const planner = classifyContentType({ keyword: 'academic planner', scope: 'strict' });
  assert(isLowContentNiche(planner), 'planner → strict low-content');

  const notebook = classifyContentType({ keyword: 'dot grid notebook for work', scope: 'strict' });
  assert(isLowContentNiche(notebook), 'notebook → strict low-content');

  const logbook = classifyContentType({ keyword: 'habit tracker logbook', scope: 'strict' });
  assert(isLowContentNiche(logbook), 'log/tracking book → strict low-content');

  const prompt = classifyContentType({ keyword: 'gratitude prompt journal', scope: 'strict' });
  assert(isLowContentNiche(prompt), 'prompt journal → strict low-content');

  const coupon = classifyContentType({ keyword: 'coupon book organizer', scope: 'strict' });
  assert(isLowContentNiche(coupon), 'coupon book → strict low-content');

  const score = classifyContentType({ keyword: 'baseball score card template', scope: 'strict' });
  assert(isLowContentNiche(score), 'score card template → strict low-content');

  const craft = classifyContentType({ keyword: 'scrapbook paper ephemera templates', scope: 'strict' });
  assert(isLowContentNiche(craft), 'crafting templates → strict low-content');

  const sheet = classifyContentType({ keyword: 'blank sheet music paper', scope: 'strict' });
  assert(isLowContentNiche(sheet), 'blank sheet music → strict low-content');

  const pers = classifyContentType({ keyword: 'personalized name book for girls', scope: 'strict' });
  assert(isLowContentNiche(pers), 'personalized blank book → strict low-content');

  // Amazon's own list puts these in "Not Generally Low-Content".
  for (const [kw, label] of [
    ['coloring book for adults animals', 'coloring books'],
    ['sudoku puzzle book for adults', 'puzzle books'],
    ['handwriting workbook for kids', 'workbooks'],
    ['camera manual', 'manuals'],
    ['beginners guide to gardening', 'guides'],
    ['cozy mysteries for seniors', 'novels/fiction'],
    ['how to write a book', 'writer-craft books'],
    ['air fryer cookbook', 'cookbooks']
  ]) {
    const ct = classifyContentType({ keyword: kw, scope: 'strict' });
    assert(!isLowContentNiche(ct) && ct.contentType === 'high-content-excluded', `${label} → NOT low-content (strict)`);
  }

  const standardColoring = classifyContentType({ keyword: 'coloring book for adults animals', scope: 'standard' });
  assert(standardColoring.contentType === 'medium-content', 'standard scope still allows coloring books');
}

console.log('\n[14] rules v1 (rule 1): locale-aware publication-date parser');
{
  const en = parsePubDate('March 3, 2026', 'us');
  assert(en === Date.UTC(2026, 2, 3), 'US "March 3, 2026" → epoch');

  const fr = parsePubDate('3 mars 2026', 'fr');
  assert(fr === Date.UTC(2026, 2, 3), 'FR "3 mars 2026" → epoch');

  const de = parsePubDate('3. März 2026', 'de');
  assert(de === Date.UTC(2026, 2, 3), 'DE "3. März 2026" → epoch');

  const it = parsePubDate('3 marzo 2026', 'it');
  assert(it === Date.UTC(2026, 2, 3), 'IT "3 marzo 2026" → epoch');

  const es = parsePubDate('3 de marzo de 2026', 'es');
  assert(es === Date.UTC(2026, 2, 3), 'ES "3 de marzo de 2026" → epoch');

  const jp = parsePubDate('2026年3月3日', 'jp');
  assert(jp === Date.UTC(2026, 2, 3), 'JP "2026年3月3日" → epoch');

  const iso = parsePubDate('2026-03-03', 'us');
  assert(iso === Date.UTC(2026, 2, 3), 'ISO "2026-03-03" → epoch');

  // Locale-dependent numeric: US = month/day, others = day/month.
  const usNum = parsePubDate('03/05/2026', 'us');
  assert(usNum === Date.UTC(2026, 2, 5), 'US numeric 03/05 → March 5');
  const frNum = parsePubDate('03/05/2026', 'fr');
  assert(frNum === Date.UTC(2026, 4, 3), 'FR numeric 03/05 → May 3');

  const yearOnly = parsePubDate('2026', 'us');
  assert(yearOnly === Date.UTC(2026, 0, 1), 'year-only "2026" → Jan 1');

  assert(parsePubDate('', 'us') === null, 'empty → null');

  // Freshness window (rule 1: < 6 months).
  const now = Date.UTC(2026, 8, 1);
  assert(isFreshPub(Date.UTC(2026, 6, 1), 6, now) === true, '2 months old → fresh');
  assert(isFreshPub(Date.UTC(2025, 8, 1), 6, now) === false, '12 months old → not fresh');
}

console.log('\n[15] rules v1 (rule 3): big-brand removal');
{
  const disney = matchBlockedBrand('Disney Frozen Adventure Journal');
  assert(!!disney, 'Disney title → brand match');
  const clean = matchBlockedBrand('My Gratitude Journal for Women');
  assert(clean === null, 'clean title → no brand match');

  const risk = computeBrandRisk([
    { title: 'Moleskine Classic Notebook' },
    { title: 'Blank Lined Journal' }
  ]);
  assert(risk.topBranded === true && risk.count >= 1, 'one branded sample → topBranded');
  assert(risk.matched.includes('moleskine'), 'moleskine detected');

  const cleanRisk = computeBrandRisk([
    { title: 'Gratitude Journal for Women' },
    { title: 'Daily Planner for Nurses' }
  ]);
  assert(cleanRisk.topBranded === false, 'no brands → topBranded false');

  const pubRisk = computeBrandRisk([{ title: 'Random title', publisher: 'Penguin Random House' }]);
  assert(pubRisk.topBranded === true, 'publisher brand detected');

  const authorRisk = computeBrandRisk([{ author: 'Scholastic Press' }]);
  assert(authorRisk.topBranded === true, 'author/publisher-imprint brand detected');
}

console.log('\n[16] rules v1 (rule 5): multi-market trademark screen + registries');
{
  const lookups = buildRegistryLookups('cozy cat journal', ['us', 'fr', 'jp']);
  assert(lookups.length === 4, '3 markets + aggregator → 4 lookups');
  const us = lookups.find((l) => l.key === 'us');
  assert(us && us.registry.includes('USPTO'), 'US → USPTO registry');
  assert(us.searchUrl.includes('cozy'), 'US search URL pre-filled');
  const agg = lookups.find((l) => l.key === 'marcaria');
  assert(agg && agg.searchUrl.includes('marcaria'), 'aggregator link present');

  const flagged = localTrademarkScreen('disney coloring book', ['us', 'fr', 'jp']);
  assert(flagged.risk !== 'low', 'disney keyword → flagged');
  assert(flagged.perMarket.us.risk === 'medium' || flagged.perMarket.us.risk === 'high', 'US market flagged');
  assert(flagged.perMarket.jp.flagged.length > 0, 'JP market flagged (global list applies everywhere)');

  const anime = localTrademarkScreen('doraemon notebook', ['jp']);
  assert(anime.perMarket.jp.flagged.length > 0, 'JP-specific famous mark (doraemon) caught');

  const clean = localTrademarkScreen('gratitude journal for nurses', ['us', 'uk']);
  assert(clean.risk === 'low' && clean.safe === true, 'clean keyword → low risk in both markets');
}

console.log('\n[17] rules v1: computeFreshHits (rule 1+2+3 combination gate)');
{
  const now = Date.now();
  const twoMo = now - 60 * 24 * 60 * 60 * 1000;
  const tenMo = now - 300 * 24 * 60 * 60 * 1000;

  const samples = [
    { asin: 'FRESH1', bsr: 150000, pubDateEpoch: twoMo },                  // fresh hit
    { asin: 'OLD1', bsr: 90000, pubDateEpoch: tenMo },                     // selling but old
    { asin: 'FRESHBRAND', bsr: 50000, pubDateEpoch: twoMo, brand: true },  // fresh but branded (blocked below)
    { asin: 'FRESHNOBSR', pubDateEpoch: twoMo },                            // fresh, no BSR
    { asin: 'FRESHLOWSALES', bsr: 300000, pubDateEpoch: twoMo }             // fresh, BSR above 200k
  ];
  const blocked = new Set(['FRESHBRAND']);
  const hits = computeFreshHitsExport(samples, { brandBlockedAsins: blocked, now });
  assert(hits === 1, 'exactly 1 qualifying fresh hit (new + selling + unbranded)');

  const two = computeFreshHitsExport([
    { asin: 'A', bsr: 100000, pubDateEpoch: twoMo },
    { asin: 'B', bsr: 180000, pubDateEpoch: twoMo }
  ], { now });
  assert(two === 2, 'two qualifying hits counted');
}

// Direct import of the rules-v1 helper (kept name-local to avoid re-export churn).
import { computeFreshHits as computeFreshHitsExport } from '../src/lib/scoring.js';

console.log('\n[18] rules v1 (rule 6): format shares');
{
  const listings = [
    { mediaType: 'kindle' }, { mediaType: 'kindle' },
    { mediaType: 'paperback' }, { mediaType: 'hardcover' }
  ];
  const m = preprocessMetrics(listings, {});
  assert(m.formatShares.kindle === 0.5, 'kindle share = 2/4');
  assert(m.formatShares.paperback === 0.25, 'paperback share = 1/4');
  assert(m.formatShares.hardcover === 0.25, 'hardcover share = 1/4');
}
{
  assert(
    scopeAllows(classifyContentType({ keyword: 'gratitude journal', scope: 'rule8' }), 'rule8'),
    'journal passes rule8 scrub'
  );
  assert(
    scopeAllows(classifyContentType({ keyword: 'sudoku puzzle book for adults', scope: 'rule8' }), 'rule8'),
    'puzzle book passes rule8 scrub'
  );
  assert(
    scopeAllows(classifyContentType({ keyword: 'coloring book for adults animals', scope: 'rule8' }), 'rule8'),
    'coloring passes rule8 scrub'
  );
  assert(
    scopeAllows(classifyContentType({ keyword: 'math textbook for 3rd grade', scope: 'rule8' }), 'rule8'),
    'textbook passes rule8 scrub'
  );
  assert(
    scopeAllows(classifyContentType({ keyword: 'bedtime stories for toddlers', scope: 'rule8' }), 'rule8'),
    "children's book passes rule8 scrub"
  );
  assert(
    scopeAllows(classifyContentType({ keyword: 'photography book of national parks', scope: 'rule8' }), 'rule8'),
    'photography book passes rule8 scrub'
  );
  assert(
    scopeAllows(classifyContentType({ keyword: 'user manual for small business owners', scope: 'rule8' }), 'rule8'),
    'manual passes rule8 scrub'
  );
  assert(
    !scopeAllows(classifyContentType({ keyword: 'cozy mysteries for seniors', scope: 'rule8' }), 'rule8'),
    'fiction fails rule8 scrub'
  );
  assert(
    !scopeAllows(classifyContentType({ keyword: 'the intelligent investor', scope: 'rule8' }), 'rule8'),
    'existing-book title fails rule8 scrub'
  );
  assert(
    !scopeAllows(classifyContentType({ keyword: 'damask napkins', scope: 'rule8' }), 'rule8'),
    'generic unknown keyword fails rule8 scrub'
  );
  assert(
    scopeAllows(classifyContentType({ keyword: 'coloring book for adults animals', scope: 'standard' }), 'standard'),
    'coloring passes standard scrub'
  );
  assert(
    scopeAllows(classifyContentType({ keyword: 'beginners guide to gardening', scope: 'standard' }), 'standard'),
    'guide passes standard scrub'
  );
  assert(!scopeAllows(null), 'null result never allows');
}

console.log('\n[19] v0.8 rule 3: famous-author + author-frequency brand detection');
{
  assert(matchFamousAuthor('Atomic Habits by James Clear') === 'james clear', 'famous author (james clear) detected');
  assert(matchFamousAuthor('My Gratitude Journal for Women') === null, 'clean title → no famous-author hit');
  assert(matchFamousAuthor('It by Stephen King') === 'stephen king', 'stephen king detected');

  const dominated = computeAuthorFrequencyRisk([
    { author: 'Jane Doe' }, { author: 'Jane Doe' }, { author: 'Jane Doe' },
    { author: 'John Smith' }, { author: 'Other Writer' }
  ]);
  assert(dominated && dominated.author === 'jane doe' && dominated.count === 3, 'same author x3 → author-dominance');

  const spread = computeAuthorFrequencyRisk([
    { author: 'Author A' }, { author: 'Author B' }, { author: 'Author C' }, { author: 'Author D' }
  ]);
  assert(spread === null, 'four distinct authors → no dominance');

  const risk = computeBrandRisk([
    { title: 'Atomic Habits', author: 'James Clear' },
    { title: 'Blank Journal', author: 'Unknown' }
  ]);
  assert(risk.topBranded === true, 'famous-author sample → topBranded');

  const freqRisk = computeBrandRisk([
    { title: 'Book 1', author: 'Jane Doe' },
    { title: 'Book 2', author: 'Jane Doe' },
    { title: 'Book 3', author: 'Jane Doe' }
  ]);
  assert(freqRisk.topBranded === true && !!freqRisk.authorBrand, 'author-frequency dominance → topBranded + authorBrand');

  const flags = flagBrandedSamples([
    { asin: 'A1', title: 'Disney Journal', author: 'Disney' },
    { asin: 'B2', title: 'Gratitude Journal', author: 'Jane Smith' }
  ]);
  assert(flags.has('A1') && !flags.has('B2'), 'per-ASIN flags: branded blocked, clean passes');
}

console.log('\n[20] v0.8 rule 8: cleanTitleToKeyword preserves low-content families');
{
  const j = cleanTitleToKeyword('Gratitude Journal for Women (Paperback)');
  assert(j.includes('journal'), `family word kept: "${j}"`);
  const p = cleanTitleToKeyword('Weekly Planner 2026 by Some Author');
  assert(p.includes('planner'), `planner kept: "${p}"`);
  const c = cleanTitleToKeyword('Cute Animals Coloring Book for Kids Ages 4-8');
  assert(c.includes('coloring'), `coloring kept: "${c}"`);
  const n = cleanTitleToKeyword('Dot Grid Notebook for Work');
  assert(n.includes('notebook'), `notebook kept: "${n}"`);
  const s = cleanTitleToKeyword('Large Sudoku Puzzle Book for Adults');
  assert(s.includes('sudoku') || s.includes('puzzle'), `puzzle kept: "${s}"`);
  assert(cleanTitleToKeyword('Dune') === '', 'single-word title → dropped (long-tail only)');
}

console.log('\n[21] v0.8 rules 5+7: 20 markets, Books-only URLs, MyResearchBase, registries');
{
  assert(Object.keys(MARKETS).length === 20, `20 markets registered (got ${Object.keys(MARKETS).length})`);
  for (const code of ['in', 'nl', 'se', 'pl', 'tr', 'sa', 'ae', 'sg', 'eg']) {
    assert(MARKETS[code] && MARKETS[code].zipCode, `${code.toUpperCase()} has a capital ZIP (${MARKETS[code] && MARKETS[code].zipCode})`);
  }
  const url = searchUrl('fr', 'carnet de bord');
  assert(url.includes('amazon.fr') && url.includes('i=stripbooks'), 'FR search URL is Books-scoped on amazon.fr');
  const mrb = myResearchBaseUrl('us', 'gratitude journal');
  assert(mrb.includes('myresearchbase.com') && mrb.includes('gratitude'), 'MyResearchBase deep link built');
  const lookups = buildRegistryLookups('gratitude journal');
  assert(lookups.length >= 21, `all-market lookups + aggregator (${lookups.length})`);
  assert(lookups.some((l) => l.key === 'in'), 'IN registry present');
  assert(lookups.some((l) => l.key === 'marcaria'), 'Marcaria aggregator present');
  assert(typeof COPYRIGHT_NOTE === 'string' && COPYRIGHT_NOTE.length > 20, 'copyright note exported');
  assert(getMarket('xx').code === 'us', 'unknown market falls back to US');
}

console.log('\n[22] v0.8 rule 7: FBA share in preprocessMetrics');
{
  const m = preprocessMetrics([
    { mediaType: 'paperback', fba: true },
    { mediaType: 'paperback', fba: false },
    { mediaType: 'kindle', fba: false },
    { mediaType: 'paperback', fba: true }
  ], {});
  assert(m.fbaCount === 2 && m.fbaShare === 0.5, 'FBA 2/4 → share 0.5');
}

console.log('\n[23] v0.8 rule 8: discovery defaults start with low-content nodes');
{
  const nodes = pickDiscoveryNodes();
  assert(nodes.length > 0 && nodes.every((n) => n.kdpFriendly !== false), 'default pick excludes fiction/expertise');
  const firstIds = nodes.slice(0, 6).map((n) => String(n.id));
  const lowFirst = firstIds.some((id) => RULE8_PRIORITY_NODE_IDS.slice(0, 6).includes(id));
  assert(lowFirst, `low-content node in first 6 (${firstIds.join(',')})`);
  const explicit = pickDiscoveryNodes(['17']);
  assert(explicit.length === 1 && String(explicit[0].id) === '17', 'explicit opt-in escape hatch honored');
}

console.log('\n[24] v0.8.2: per-market suggest hosts (Research outside the US)');
{
  assert(suggestHost('us') === 'completion.amazon.com', 'US → completion.amazon.com');
  assert(suggestHost('fr') === 'completion.amazon.fr', 'FR → completion.amazon.fr');
  assert(suggestHost('uk') === 'completion.amazon.co.uk', 'UK → completion.amazon.co.uk');
  assert(suggestHost('jp') === 'completion.amazon.co.jp', 'JP → completion.amazon.co.jp');
  const frUrl = autocompleteUrl('fr', 'carnet');
  assert(frUrl.includes('https://completion.amazon.fr/'), 'FR autocomplete URL hits the FR host');
  assert(frUrl.includes('mid=A13V1IB3VIYZZH'), 'FR autocomplete URL carries the FR mid');
  assert(frUrl.includes('alias=stripbooks'), 'autocomplete stays Books-scoped');
  let allPattern = true;
  for (const code of Object.keys(MARKETS)) {
    const expected = MARKETS[code].domain.replace(/^www\./, 'completion.');
    if (suggestHost(code) !== expected || !autocompleteUrl(code, 'x').startsWith(`https://${expected}/`)) {
      allPattern = false;
    }
  }
  assert(allPattern, 'all 20 markets map to their own completion host');
}

console.log('\n[25] v0.8.3: automatic delivery-location pin (rule 7)');
{
  assert(
    locationChangeEndpoint('fr') === 'https://www.amazon.fr/gp/delivery/ajax/address-change.html',
    'FR location endpoint on amazon.fr'
  );
  assert(
    locationChangeEndpoint('jp') === 'https://www.amazon.co.jp/gp/delivery/ajax/address-change.html',
    'JP location endpoint on amazon.co.jp'
  );
  const payload = buildLocationPayload('75001');
  assert(payload.locationType === 'LOCATION_INPUT' && payload.zipCode === '75001', 'payload carries LOCATION_INPUT + zip');
  assert(payload.actionSource === 'glow' && payload.deviceType === 'web', 'payload glow/web fields present');
  assert(glowMatchesZip('Livraison à Paris 75001', '75001') === true, 'FR glow text matches 75001');
  assert(glowMatchesZip('Deliver to London SW1A1AA', 'SW1A 1AA') === true, 'UK glow matches despite spacing');
  assert(glowMatchesZip('Deliver to New York 10001', '75001') === false, 'wrong zip does not match');
  assert(glowMatchesZip('', '75001') === false && glowMatchesZip(null, '75001') === false, 'empty glow never matches');
}

console.log('\n[26] v0.8.6: custom AI provider (Zen/OpenRouter transports)');
{
  assert(customTransportFor('muse-spark-1.3-contributor-free') === 'responses', 'Muse Spark free tier routes to Responses API');
  assert(customTransportFor('big-pickle') === 'chat', 'Big Pickle routes to chat/completions');
  assert(customTransportFor('  mimo-v2.5-free ') === 'chat', 'transport trims the model id');
  assert(customTransportFor('xiaomi/mimo-v2-flash:free') === 'chat', 'OpenRouter free id routes to chat/completions');
  assert(customTransportFor(null) === 'chat' && customTransportFor('') === 'chat', 'missing model defaults to chat');

  const chatBody = buildChatBody({ model: 'big-pickle', systemInstruction: 'sys', prompt: '{"a":1}' });
  assert(chatBody.model === 'big-pickle', 'chat body carries the model');
  assert(chatBody.messages[0].role === 'system' && chatBody.messages[1].role === 'user', 'chat body uses system+user roles');
  assert(chatBody.response_format && chatBody.response_format.type === 'json_object', 'chat body requests JSON mode');
  const chatNoSys = buildChatBody({ model: 'm', prompt: '{"a":1}' });
  assert(chatNoSys.messages.length === 1 && chatNoSys.messages[0].role === 'user', 'chat body omits system when absent');

  assert(parseChatResponse({ choices: [{ message: { content: '{"risk":"low"}' } }] }).risk === 'low', 'chat response parses JSON content');
  let threw = false;
  try { parseChatResponse({ choices: [{ message: { content: '  ' } }] }); } catch { threw = true; }
  assert(threw, 'empty chat response throws');

  const respBody = buildResponsesBody({ model: 'muse-spark-1.3-contributor-free', prompt: '{"a":1}' });
  assert(Array.isArray(respBody.input) && respBody.max_output_tokens > 0, 'responses body uses input array');
  assert(
    parseResponsesResponse({ output: [{ type: 'message', content: [{ type: 'output_text', text: '{"safe":true}' }] }] }).safe === true,
    'responses output message parses'
  );
  threw = false;
  try { parseResponsesResponse({ output: [] }); } catch { threw = true; }
  assert(threw, 'empty responses output throws');
}

console.log('\n[27] v0.8.10: provider switching keeps each model list intact');
{
  assert(sanitizeGeminiModel('gemini-3.6-flash') === 'gemini-3.6-flash', 'valid Gemini id passes through');
  assert(sanitizeGeminiModel('big-pickle') === 'gemini-3.6-flash', 'custom id saved as Gemini model heals to default');
  assert(sanitizeGeminiModel('') === 'gemini-3.6-flash' && sanitizeGeminiModel(null) === 'gemini-3.6-flash', 'missing Gemini model heals to default');
  const customs = await fetchModelChoices('custom');
  assert(Array.isArray(customs) && customs.some((m) => m.id === 'xiaomi/mimo-v2.5'), 'explicit custom list serves presets without stored settings');
}

console.log('\n[28] v0.8.12: tolerant JSON parsing for sloppy model output');
{
  assert(sanitizeJson('{"a":1}').a === 1, 'clean JSON passes through');
  assert(sanitizeJson('```json\n{"a":1}\n```').a === 1, 'fenced JSON extracted');
  assert(sanitizeJson('Here you go: {"a":1} hope it helps').a === 1, 'prose-wrapped JSON extracted');
  assert(sanitizeJson('{"a":1,"b":[2,3,],}').b.length === 2, 'trailing commas repaired');
  assert(sanitizeJson('{a:1, "b":2}').a === 1, 'bare property names quoted as last resort');
  let threw = false;
  try { sanitizeJson('not json at all'); } catch { threw = true; }
  assert(threw, 'non-JSON still throws');
  assert(isJsonFormatError(new SyntaxError('Expected double-quoted property name in JSON at position 4982')) === true, 'V8 parse error is retryable');
  assert(isJsonFormatError(new Error('Model returned an unexpected response format.')) === true, 'format error is retryable');
  assert(isJsonFormatError(new Error('OpenRouter API error 401: bad key')) === false, 'auth errors are not retryable as format errors');
}

console.log('\n[29] v0.8.14: overload retries + AI-to-local fallback gating');
{
  assert(isOverloadedError(new Error('Gemini API error 503: model is overloaded')) === true, 'Gemini 503 is overload');
  assert(isOverloadedError(new Error('OpenRouter API error 429: rate limited')) === true, '429 is overload');
  assert(isOverloadedError(new Error('model under high demand, try again later')) === true, 'demand wording is overload');
  assert(isOverloadedError(new Error('OpenRouter API error 404: deprecated')) === false, '404 is not overload');
  assert(isOverloadedError(new Error('OpenRouter API error 401: bad key')) === false, '401 is not overload');
  assert(isOverloadedError(null) === false, 'null is not overload');

  let calls = 0;
  const flaky = async () => {
    calls++;
    if (calls < 3) throw new Error('Gemini API error 503: overloaded');
    return 'recovered';
  };
  const slept = [];
  const out = await retryOnOverload(flaky, { retries: 2, baseMs: 10, sleepFn: (ms) => { slept.push(ms); return Promise.resolve(); } });
  assert(out === 'recovered' && calls === 3, 'retries until success on overload');
  assert(slept.length === 2 && slept[0] === 10 && slept[1] === 20, 'exponential backoff between retries');

  let fastFail = 0;
  try {
    await retryOnOverload(async () => { fastFail++; throw new Error('Gemini API error 400: bad request'); }, { sleepFn: () => Promise.resolve() });
  } catch { /* expected */ }
  assert(fastFail === 1, 'non-overload errors throw immediately without retry');
}

console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);