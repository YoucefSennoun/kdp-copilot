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
import { classifyContentType, isLowContentNiche } from '../src/lib/content-type.js';
import { isSuggestibleSuggestion } from '../src/background/ai.js';

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

console.log('\n[1] Qualification gates (computeQualifies)');
{
  const t = { bsrThreshold: 200, listingsThreshold: 1000, volumeThreshold: 50 };

  const q1 = computeQualifies(
    { bestSubcategoryBsr: 150, totalResultsCount: 900, demandProxyScore: 60 },
    t
  );
  assert(q1.bsr && q1.listings && q1.volume && q1.all === true, 'all-three below threshold → qualifies');

  const q2 = computeQualifies(
    { bestSubcategoryBsr: 250, totalResultsCount: 900, demandProxyScore: 60 },
    t
  );
  assert(q2.bsr === false && q2.all === false, 'BSR above 200 → fails gate');

  const q3 = computeQualifies(
    { bestSubcategoryBsr: 150, totalResultsCount: 1200, demandProxyScore: 60 },
    t
  );
  assert(q3.listings === false && q3.all === false, 'results above 1000 → fails gate');

  const q4 = computeQualifies(
    { bestSubcategoryBsr: 150, totalResultsCount: 900, demandProxyScore: 40 },
    t
  );
  assert(q4.volume === false && q4.all === false, 'proxy below 50 → fails gate');

  const qGap = computeQualifies(
    { totalResultsCount: 50, demandProxyScore: 80 },
    t
  );
  assert(qGap.bsr === false, 'missing BSR → gate stays false (no false-positive)');

  const qNoData = computeQualifies({}, t);
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
    { bsrThreshold: 200, listingsThreshold: 1000, volumeThreshold: 50 });
  assert(withThreshold.bsr === true, 'BSR 5 ≤ 200 → qualifies');

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
  const j = classifyContentType({ keyword: 'wellness journal for women' });
  assert(j.contentType === 'low-content' && j.requiresExpertise === false, 'journal keyword → low-content, publishable');

  const med = classifyContentType({ keyword: 'clinical handbook of diabetes' });
  assert(med.contentType === 'high-content-excluded' && med.requiresExpertise === true, 'clinical handbook → excluded (expertise)');

  const col = classifyContentType({ keyword: 'coloring book for adults animals' });
  assert(col.contentType === 'medium-content' && col.requiresExpertise === false, 'coloring book → medium-content');

  const nov = classifyContentType({ keyword: 'historical novel' });
  assert(nov.contentType === 'high-content-excluded' && nov.requiresExpertise === false, 'novel keyword → excluded (fiction, not expertise)');

  const log = classifyContentType({ keyword: 'clinical trial logbook' });
  assert(log.contentType === 'low-content', 'strong low signal (logbook) overrides weak clinical overlap');

  const pers = classifyContentType({ keyword: 'personalized name book' });
  assert(pers.contentType === 'personalized', 'personalized keyword → personalized');

  const unk = classifyContentType({ keyword: 'damask napkins' });
  assert(unk.contentType === 'unknown', 'generic keyword with no markers → unknown (passes)');

  const biology = classifyContentType({ keyword: 'molecular biology' });
  assert(biology.contentType === 'high-content-excluded' && biology.requiresExpertise === true, 'scientific keyword → excluded');

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

  const catAllow = classifyContentType({
    keyword: 'autoimmune wellness',
    categories: ['Books', 'Health, Fitness & Dieting', 'Diets & Weight Loss']
  });
  assert(catAllow.contentType !== 'high-content-excluded', 'benign health breadcrumb → not excluded');

  const catNovel = classifyContentType({
    keyword: 'summer reading lists',
    categories: ['Books', 'Literature & Fiction']
  });
  assert(catNovel.contentType === 'high-content-excluded', 'fiction breadcrumb → excluded');

  // Kindle-format availability signal.
  const kindle = classifyContentType({ keyword: 'nurse appreciation', kindleShare: 0.05, sampleSize: 8 });
  assert(kindle.contentType === 'low-content' && kindle.contentTypeSource === 'format-signal', 'low Kindle share → low-content format tell');

  const kindleHigh = classifyContentType({ keyword: 'mindful living', kindleShare: 0.8, sampleSize: 10 });
  assert(kindleHigh.contentType !== 'high-content-excluded', 'high Kindle share alone never excludes (protects guide niches)');
}

console.log('\n[8] KDP-publishable content gate in computeQualifies');
{
  const t = { bsrThreshold: 200, listingsThreshold: 1000, volumeThreshold: 50 };

  const ok = computeQualifies(
    { bestSubcategoryBsr: 150, totalResultsCount: 900, demandProxyScore: 60, contentType: 'low-content' },
    t
  );
  assert(ok.contentType === true && ok.all === true, 'publishable content + 3 gates → qualifies');

  const excluded = computeQualifies(
    { bestSubcategoryBsr: 150, totalResultsCount: 900, demandProxyScore: 60, contentType: 'high-content-excluded' },
    t
  );
  assert(excluded.contentType === false && excluded.all === false, 'excluded content → fails gate even with good BSR');

  const expert = computeQualifies(
    { bestSubcategoryBsr: 150, totalResultsCount: 900, demandProxyScore: 60, requiresExpertise: true },
    t
  );
  assert(expert.contentType === false && expert.all === false, 'expertise-required flag → fails gate');

  const unknown = computeQualifies(
    { bestSubcategoryBsr: 150, totalResultsCount: 900, demandProxyScore: 60, contentType: 'unknown' },
    t
  );
  assert(unknown.contentType === true && unknown.all === true, 'unclassified (unknown) passes the gate');

  const off = computeQualifies(
    { bestSubcategoryBsr: 150, totalResultsCount: 900, demandProxyScore: 60, contentType: 'high-content-excluded' },
    { ...t, contentTypeEnabled: false }
  );
  assert(off.contentType === true && off.all === true, 'filter disabled → exclusions ignored');

  const legacy = computeQualifies(
    { bestSubcategoryBsr: 150, totalResultsCount: 900, demandProxyScore: 60 },
    t
  );
  assert(legacy.contentType === true && legacy.all === true, 'records without classification still pass (backwards compat)');
}

console.log('\n[9] Revision 2: existing-book titles + isSuggestibleSuggestion gate');
{
  // The named failing titles carry no low-content markers, so the classifier
  // says "unknown" — exactly the state Fix A drops from the AI path (unknown
  // is NOT cleared when the model generated the suggestion).
  for (const kw of ['the intelligent investor', 'antifragile', 'principles: life and work', 'the runaway bunny']) {
    const ct = classifyContentType({ keyword: kw });
    assert(ct.contentType === 'unknown', `"${kw}" classifies unknown (Fix A drop trigger)`);
  }

assert(isSuggestibleSuggestion({ keyword: 'the intelligent investor', isExistingTitle: true }, { scope: 'standard' }) === false, 'model-self-flagged existing title rejected');
  assert(isSuggestibleSuggestion({ keyword: 'sudoku for adults', why: 'bestseller in its node' }, { scope: 'standard' }) === false, '"bestseller" tell rejected');
  assert(isSuggestibleSuggestion({ keyword: 'kids activity book', why: 'a low competition classic pick' }, { scope: 'standard' }) === false, '"classic" tell rejected');
  assert(isSuggestibleSuggestion({ keyword: 'kids activity book', category: 'guide by mary smith on basics' }, { scope: 'standard' }) === false, '"by <Author>" tell rejected');
  assert(isSuggestibleSuggestion({ keyword: 'clinical handbook of diabetes' }, { scope: 'standard' }) === false, 'hard-excluded engine suggestion rejected');
  assert(isSuggestibleSuggestion({ keyword: 'vegan beginner cookbook', titleIdea: 'The Everyday Vegan Cookbook', why: 'recipe compilation for beginners' }, { scope: 'standard' }) === true, 'clean guide suggestion passes');

  // Default scope is now strict: only blank-interior families survive.
  assert(isSuggestibleSuggestion({ keyword: 'wellness journal for women' }) === true, 'strict scope keeps a journal niche');
  assert(isSuggestibleSuggestion({ keyword: 'cozy mysteries for seniors' }) === false, 'strict scope drops a fiction niche');
  assert(isSuggestibleSuggestion({ keyword: 'coloring book for adults animals' }) === false, 'strict scope drops coloring books (not "generally low-content")');
  assert(isSuggestibleSuggestion({ keyword: 'beginners guide to gardening' }) === false, 'strict scope drops guides');
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

  const t = { bsrThreshold: 200, listingsThreshold: 1000, volumeThreshold: 50 };
  const dominated = computeQualifies(
    { bestSubcategoryBsr: 120, totalResultsCount: 700, demandProxyScore: 60, contentType: 'guide', leaderDominanceRatio: 0.93, totalReviews: 540, sampleSize: 5 },
    t
  );
  assert(dominated.contentType === false && dominated.all === false, 'single title owns >60% of reviews → fails content gate');

  const healthy = computeQualifies(
    { bestSubcategoryBsr: 120, totalResultsCount: 700, demandProxyScore: 60, contentType: 'guide', leaderDominanceRatio: 0.3, totalReviews: 540, sampleSize: 5 },
    t
  );
  assert(healthy.contentType === true && healthy.all === true, 'spread review share → still qualifies');
}

console.log('\n[11] v0.5: narrow-fiction carve-out + writer-craft denial');
{
  const cozy = classifyContentType({ keyword: 'cozy mysteries for seniors' });
  assert(cozy.contentType === 'fiction' && cozy.requiresExpertise === false, 'specific long-tail fiction → fiction-niche (publishable)');

  const chapters = classifyContentType({ keyword: 'chapter books for girls 6 to 8' });
  assert(chapters.contentType === 'fiction', 'chapter books for a stated age → fiction-niche');

  const broad = classifyContentType({ keyword: 'romance novels' });
  assert(broad.contentType === 'high-content-excluded', 'generic fiction term stays excluded');

  const off = classifyContentType({ keyword: 'cozy mysteries for seniors', allowFiction: false });
  assert(off.contentType === 'high-content-excluded', 'fiction carve-out disabled → excluded again');

  const med = classifyContentType({ keyword: 'medical romance novel' });
  assert(med.contentType === 'high-content-excluded', 'expertise + fiction overlap stays excluded');

  const wc1 = classifyContentType({ keyword: 'how to write a book' });
  assert(wc1.contentType === 'high-content-excluded', 'writer-craft guide → excluded');

  const wc2 = classifyContentType({ keyword: 'book marketing for authors' });
  assert(wc2.contentType === 'high-content-excluded', 'publishing-marketing guide → excluded');

  const keep = classifyContentType({ keyword: 'novel writing planner' });
  assert(keep.contentType === 'low-content', 'planner family overrides writer-craft text → low-content');

  const keep2 = classifyContentType({ keyword: 'planner for self published authors' });
  assert(keep2.contentType === 'low-content', 'planner for the author audience is still a planner');

  const unk = classifyContentType({ keyword: 'space opera romance for adults' });
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

console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);