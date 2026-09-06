import {
  scoreKeyword,
  preprocessMetrics,
  applyBsrSamples,
  attachQualifies
} from '../lib/scoring.js';
import {
  marketFromDomain,
  getMarket,
  searchUrl,
  productUrl,
  autocompleteUrl,
  googleSuggestUrl,
  bestsellersUrl,
  moversUrl,
  newReleasesUrl
} from '../lib/markets.js';
import {
  putKeyword,
  putKeywords,
  getAllKeywords,
  getKeyword,
  deleteKeyword,
  clearKeywords,
  putSuggestions,
  getAllSuggestions,
  clearSuggestions,
  pruneSuggestions,
  putAnalysis,
  clearAnalyses,
  putLegal,
  getLegal,
  getAllLegals,
  clearLegals,
  getSettings,
  saveSettings,
  addScrape,
  getScrapeSnapshots,
  addDiscoveryRun,
  getDiscoveryRuns,
  clearDiscoveryRuns,
  purgeOutsideScope
} from '../lib/storage.js';
import { scrapeQueue, STATUS } from './scrape-queue.js';
import {
  expandNicheSeeds,
  analyzeNiche,
  generateListing,
  checkTrademark,
  localTrademarkSweep,
  localExpandSuggestions,
  getApiKey,
  fetchModelChoices
} from './ai.js';
import { computeDemandProxyScore, deriveSuggestionProxy } from '../lib/proxy.js';
import { pickDiscoveryNodes } from '../lib/categories.js';
import { cleanTitleToKeyword } from './discovery.js';
import { classifyContentType } from '../lib/content-type.js';

const DASHBOARD_URL = 'src/dashboard/index.html';
const ALPHABET = 'abcdefghijklmnopqrstuvwxyz'.split('');
const CORPUS_CAP_PER_ENGINE = 80;

// ---------------------------------------------------------------------------
// Lifecycle
// ---------------------------------------------------------------------------

chrome.runtime.onInstalled.addListener(async () => {
  pruneSuggestions().catch(() => {});
  const settings = await getSettings();
  setupDiscoveryAlarm(settings);
  console.log('[KDP Copilot] Installed.');
});

chrome.runtime.onStartup.addListener(async () => {
  const settings = await getSettings();
  setupDiscoveryAlarm(settings);
});

chrome.alarms.onAlarm.addListener((alarm) => {
  if (alarm.name === 'kdp-discovery') {
    runDiscovery({ silent: true })
      .catch((err) => console.warn('[KDP Copilot] scheduled discovery failed:', err));
  }
});

function setupDiscoveryAlarm(settings) {
  try {
    chrome.alarms.clear('kdp-discovery', () => {
      if (settings.discoveryEnabled && (settings.discoveryIntervalMinutes || 0) > 0) {
        chrome.alarms.create('kdp-discovery', {
          periodInMinutes: settings.discoveryIntervalMinutes || 1440
        });
      }
    });
  } catch {
    // alarm APIs unavailable in some embed contexts — discovery still works manually.
  }
}

// ---------------------------------------------------------------------------
// Dashboard
// ---------------------------------------------------------------------------

function openDashboard() {
  const url = chrome.runtime.getURL(DASHBOARD_URL);
  chrome.tabs.query({}, (tabs) => {
    const existing = tabs.find((t) => t.url && t.url.startsWith(url));
    if (existing) {
      chrome.tabs.update(existing.id, { active: true });
    } else {
      chrome.tabs.create({ url });
    }
  });
}

chrome.action.onClicked.addListener(openDashboard);

// ---------------------------------------------------------------------------
// Commands (keyboard shortcuts mirroring Productor's research hotkeys)
// ---------------------------------------------------------------------------

chrome.commands.onCommand.addListener((command) => {
  if (command.startsWith('kdp-research-selection-')) {
    const marketCode = command.replace('kdp-research-selection-', '');
    researchActiveTabSelection(marketCode);
  }
});

async function researchActiveTabSelection(marketCode) {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  if (!tab || !tab.id) return;

  let seed = '';
  try {
    const results = await chrome.scripting.executeScript({
      target: { tabId: tab.id },
      func: () => (window.getSelection() || '').toString().trim().slice(0, 120)
    });
    seed = (results[0] && results[0].result) || '';
  } catch {
    seed = '';
  }

  if (!seed) return;
  try {
    await handleExpandSeed(seed, marketCode);
    chrome.tabs.sendMessage(tab.id, {
      type: 'KDP_RESEARCH_DONE',
      payload: { keyword: seed, market: marketCode }
    }).catch(() => {});
  } catch (err) {
    console.warn('[KDP Copilot] research command failed:', err);
  }
}

// ---------------------------------------------------------------------------
// Scrape handler: opens exactly one Amazon tab per task (SERP or product)
// ---------------------------------------------------------------------------

scrapeQueue.setHandler(async (task) => {
  return await _openScrapeTab(task);
});

async function _openScrapeTab(task) {
  if (task.type === 'product') {
    const url = productUrl(task.market || 'us', task.asin);
    return await openTab(url);
  }
  if (task.type === 'discovery') {
    return await openTab(task.url);
  }
  const market = getMarket(task.market || 'us');
  const params = {};
  if (task.scrapedPages && task.scrapedPages > 1) {
    params.page = task.scrapedPages;
  }
  const url = task.url || searchUrl(market.code, task.keyword, params);
  return await openTab(url);
}

function openTab(url) {
  return new Promise((resolve, reject) => {
    try {
      chrome.tabs.create({ url, active: false }, (tab) => {
        if (chrome.runtime.lastError) return reject(new Error(chrome.runtime.lastError.message));
        resolve(tab);
      });
    } catch (err) {
      reject(err);
    }
  });
}

// ---------------------------------------------------------------------------
// Message router
// ---------------------------------------------------------------------------

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  handleMessage(message, sender)
    .then((result) => sendResponse({ ok: true, result }))
    .catch((error) => sendResponse({ ok: false, error: error.message }));

  return true; // async response
});

async function handleMessage(message, sender = {}) {
  const k = (name) => message[name] ?? message.payload?.[name];

  switch (message.type) {
    // Content-script data in
    case 'SERP_PARSED':
      return handleSerpParsed(message.payload, sender);
    case 'PRODUCT_PARSED':
      return handleProductParsed(message.payload, sender);
    case 'DISCOVERY_PARSED':
      return handleDiscoveryParsed(message.payload, sender);

    // Keyword CRUD
    case 'GET_KEYWORDS':
      return getAllKeywords();
    case 'GET_KEYWORD':
      return getKeyword(k('keyword'));
    case 'DELETE_KEYWORD':
      return deleteKeyword(k('keyword'));
    case 'PURGE_OUTSIDE_SCOPE': {
      const s = await getSettings();
      return purgeOutsideScope(s.contentScope || 'strict');
    }
    case 'CLEAR_KEYWORDS':
      return clearKeywords();
    case 'CLEAR_ALL':
      scrapeQueue.abort();
      await clearKeywords();
      await clearSuggestions();
      await clearAnalyses();
      await clearLegals();
      await clearDiscoveryRuns();
      return true;

    // Suggestions (Amazon + Google autocomplete)
    case 'GET_SUGGESTIONS':
      return getAllSuggestions();
    case 'CLEAR_SUGGESTIONS':
      return clearSuggestions();
    case 'FETCH_SUGGESTIONS':
      return fetchSuggestions(message.payload || message);
    case 'SAVE_SUGGESTIONS':
      return putSuggestions(message.suggestions || message.payload?.suggestions || []);
    case 'EXPAND_FROM_SUGGESTIONS':
      return expandFromSuggestions(k('market'));

    // Expansion & scraping
    case 'EXPAND_SEED':
      return handleExpandSeed(message.seed, message.market);
    case 'SCRAPE_KEYWORD':
      return scrapeOne(message.payload);
    case 'SCRAPE_ALL':
      return scrapeAll(message.filter);
    case 'QUEUE_STATUS':
      return {
        size: scrapeQueue.size,
        idle: scrapeQueue.idle,
        completed: scrapeQueue.completed,
        failed: scrapeQueue.failed,
        pending: scrapeQueue.pendingTabs?.size || 0,
        stage: scrapeQueue.stage,
        paused: scrapeQueue.status === 'paused'
      };
    case 'PAUSE_QUEUE':
      scrapeQueue.stop();
      return true;
    case 'RESUME_QUEUE':
      scrapeQueue.resume();
      return true;

    // Discovery Mode (Phase 4) + orchestration (Phase 6)
    case 'DISCOVER_NICHES':
      return runDiscovery({ marketCode: k('market') });
    case 'FIND_ME_NICHES':
      return runDiscovery({
        marketCode: k('market'),
        categoryCount: k('categoryCount'),
        maxKeywords: k('maxKeywords')
      });
    case 'GET_DISCOVERY_RUNS':
      return getDiscoveryRuns();

    // Review-growth velocity snapshots (Phase 3b)
    case 'GET_SCRAPE_SNAPSHOTS':
      return getScrapeSnapshots(k('keyword'));

    // AI actions
    case 'ANALYZE_NICHE':
      return handleAnalyzeNiche(k('keyword'));
    case 'GENERATE_LISTING':
      return handleGenerateListing(k('keyword'), k('niche'));
    case 'CHECK_TRADEMARK':
      return handleCheckTrademark(k('keyword'));
    case 'GET_ALL_LEGAL':
      return getAllLegals();
    case 'GET_LEGAL':
      return getLegal(k('keyword'));

    // Settings / dashboard
    case 'GET_SETTINGS':
      return getSettings();
    case 'GET_MODELS': {
      const models = await fetchModelChoices();
      return { models: models.map((m) => m.id) };
    }
    case 'SAVE_SETTINGS': {
      const saved = await saveSettings(message.settings || message.payload?.settings || {});
      const current = await getSettings();
      setupDiscoveryAlarm(current);
      return saved;
    }
    case 'OPEN_DASHBOARD':
      openDashboard();
      return true;

    default:
      throw new Error(`Unknown message type: ${message.type}`);
  }
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function settingsToThresholds(settings) {
  return {
    bsrThreshold: settings.bsrThreshold ?? 200,
    listingsThreshold: settings.listingsThreshold ?? 1000,
    volumeThreshold: settings.volumeThreshold ?? 50,
    contentTypeEnabled: settings.contentTypeEnabled !== false
  };
}

function hostnameFromUrl(url) {
  try {
    return new URL(url || '').hostname;
  } catch {
    return '';
  }
}

function broadcastPipeline(stage, text) {
  chrome.tabs.query({}, (tabs) => {
    tabs.forEach((t) => {
      if (t.url && t.url.includes(DASHBOARD_URL)) {
        chrome.tabs
          .sendMessage(t.id, {
            type: 'QUEUE_PROGRESS',
            payload: { stage, pipelineText: text }
          })
          .catch(() => {});
      }
    });
  });
}

// ---------------------------------------------------------------------------
// SERP ingestion (Phase 1: total results + scoring, Phase 2: enrichment gate)
// ---------------------------------------------------------------------------

async function handleSerpParsed(payload, sender) {
  const { keyword, listings } = payload;
  const tabId = sender.tab && sender.tab.id;

  if (tabId != null) {
    scrapeQueue.resolveTab(tabId, { keyword, count: listings.length });
  }

  const totalResultsCount = payload.totalResultsCount ?? null;
  const resultsCountIsApprox = !!payload.resultsCountIsApprox;

  // CAPTCHA / bot-block: fail loudly instead of overwriting good data.
  if (payload.blocked) {
    if (tabId != null) {
      scrapeQueue.resolveTabFailed(tabId, { keyword, count: 0, blocked: true });
    } else {
      scrapeQueue.failed++;
    }
    broadcastPipeline('serp', `Blocked (CAPTCHA) while scraping "${keyword}" — skipped.`);
    return { keyword, count: 0, blocked: true };
  }

  if (!listings.length && totalResultsCount == null) {
    return { keyword, count: 0 };
  }

  const market = marketFromDomain(
    hostnameFromUrl(sender.tab && sender.tab.url ? sender.tab.url : payload.url)
  );
  const settings = await getSettings();
  const thresholds = settingsToThresholds(settings);

  const existing = await getKeyword(keyword).catch(() => null);
  const isNew = !existing;

  let metrics = preprocessMetrics(listings, { totalResultsCount, resultsCountIsApprox });

  // Preserve previously-computed proxy + any partial BSR enrichment.
  if (existing && existing.metrics) {
    if (existing.metrics.demandProxyScore != null) {
      metrics.demandProxyScore = existing.metrics.demandProxyScore;
      metrics.demandProxyBreakdown = existing.metrics.demandProxyBreakdown;
    }
    if (Array.isArray(existing.metrics.bsrSamples) && existing.metrics.bsrSamples.length) {
      metrics = applyBsrSamples(
        metrics,
        existing.metrics.bsrSamples,
        existing.metrics.bsrExpected ?? metrics.sampleSize
      );
    }
    if (existing.metrics.bsrExpected != null) metrics.bsrExpected = existing.metrics.bsrExpected;
  }

  // Phase 1.5: KDP-publishable content-type classification. Keyword markers
  // dominate; a fresh 'unknown' never overwrites a previous verdict (e.g. a
  // breadcrumb exclusion from enrichment).
  const sampleTitles = (listings || []).map((l) => l && l.title).filter(Boolean);
  const prev = (existing && existing.metrics) || {};
  const ct = classifyContentType({
    keyword,
    titles: sampleTitles,
    categories: Array.isArray(prev.categories) ? prev.categories : undefined,
    kindleShare: metrics.kindleShare ?? prev.kindleShare ?? null,
    sampleSize: metrics.sampleSize ?? metrics.listingCount ?? sampleTitles.length,
    scope: settings.contentScope || 'strict'
  });
  const ctFinal =
    ct.contentType === 'unknown' && prev.contentType
      ? {
          contentType: prev.contentType,
          contentTypeLabel: prev.contentTypeLabel,
          contentTypeSource: prev.contentTypeSource,
          confidence: prev.contentTypeConfidence,
          requiresExpertise: !!prev.requiresExpertise
        }
      : ct;
  metrics.contentType = ctFinal.contentType;
  metrics.contentTypeLabel = ctFinal.contentTypeLabel;
  metrics.contentTypeSource = ctFinal.contentTypeSource;
  metrics.contentTypeConfidence = ctFinal.confidence;
  metrics.requiresExpertise = !!ctFinal.requiresExpertise;

  // Interactive single-keyword scrapes get a fresh proxy if none exists yet.
  if (isNew && metrics.demandProxyScore == null && (scrapeQueue.size + scrapeQueue.pendingTabs.size) < 4) {
    try {
      const { score, breakdown } = await computeProxyForKeyword(keyword, market.code, settings);
      metrics.demandProxyScore = score;
      metrics.demandProxyBreakdown = breakdown;
    } catch {
      // optional signal; ignore.
    }
  }

  const record = {
    keyword,
    market: market.code,
    url: payload.url,
    metrics,
    scrapedAt: Date.now(),
    scoredAt: new Date().toISOString()
  };

  const scored = scoreKeyword(keyword, metrics, { longTail: true, thresholds });
  attachQualifies(scored, thresholds);
  Object.assign(record, {
    score: scored.score,
    demand: scored.demand,
    competition: scored.competition,
    margin: scored.margin,
    confidence: scored.confidence,
    estimatedMonthlySales: scored.estimatedMonthlySales,
    verdict: scored.verdict,
    qualifies: scored.qualifies
  });

  await putKeyword(record);

  // Review-growth velocity snapshot (Phase 3b).
  if (metrics.totalReviews != null) {
    addScrape({
      keyword,
      market: market.code,
      totalReviews: metrics.totalReviews,
      sampleSize: metrics.sampleSize || 0,
      totalResultsCount,
      scrapedAt: Date.now()
    }).catch(() => {});
  }

  // Phase 2: enqueue BSR enrichment only for shortlisted candidates.
  if (shouldEnrich(record, settings)) {
    enqueueEnrichment(record, settings, market.code);
  }

  return { keyword, count: listings.length, record };
}

function shouldEnrich(record, settings) {
  if (settings.enrichmentEnabled === false) return false;
  const m = record.metrics || {};
  if (m.totalResultsCount != null && m.totalResultsCount > (settings.enrichmentCeiling ?? 3000)) {
    return false;
  }
  if ((record.score ?? 0) < (settings.enrichmentMinScore ?? 50)) return false;
  const seeded = (m.sample || []).filter((l) => l && l.asin);
  if (!seeded.length) return false;
  const expected = m.bsrExpected ?? 0;
  const have = Array.isArray(m.bsrSamples) ? m.bsrSamples.length : 0;
  return have < expected || expected === 0;
}

function enqueueEnrichment(record, settings, marketCode) {
  const m = record.metrics || {};
  const sampleSize = Math.max(1, Math.min(settings.enrichmentSampleSize ?? 8, 12));
  const seeded = [...(m.sample || [])]
    .filter((l) => l && l.asin)
    .sort((a, b) => (b.reviewCount || 0) - (a.reviewCount || 0))
    .slice(0, sampleSize);

  const have = new Set((m.bsrSamples || []).map((s) => s.asin));
  const tasks = seeded
    .filter((l) => !have.has(l.asin))
    .map((l) => ({
      type: 'product',
      asin: l.asin,
      parentKeyword: record.keyword,
      market: marketCode
    }));

  if (!tasks.length) return;

  record.metrics.bsrExpected = seeded.length;
  record.metrics.bsrSamples = record.metrics.bsrSamples || [];
  putKeyword(record).catch(() => {});
  scrapeQueue.enqueueMany(tasks);
}

async function mergeProductIntoParent(parentKeyword, payload) {
  const settings = await getSettings();
  const parent = await getKeyword(parentKeyword);
  if (!parent) return { merged: false, reason: 'parent-missing' };
  const settings = await getSettings();
  const thresholds = settingsToThresholds(settings);

  parent.metrics = parent.metrics || {};
  parent.metrics.bsrSamples = Array.isArray(parent.metrics.bsrSamples) ? parent.metrics.bsrSamples : [];
  if (!parent.metrics.bsrSamples.some((s) => s.asin === payload.asin)) {
    parent.metrics.bsrSamples.push({
      asin: payload.asin,
      bsr: payload.bsr,
      bsrCategory: payload.bsrCategory,
      allRanks: Array.isArray(payload.bsrAll) ? payload.bsrAll : [],
      category: payload.category || null,
      formats: Array.isArray(payload.formats) ? payload.formats : null
    });
  }

  const sampleSize = parent.metrics.bsrExpected ?? parent.metrics.sampleSize ?? 0;
  parent.metrics = applyBsrSamples(parent.metrics, parent.metrics.bsrSamples, sampleSize);

  // Phase 1.5: category breadcrumbs from product pages can expose novels and
  // expert non-fiction the keyword/title regexes missed. Escalate to excluded;
  // a mid-run scrape never downgrades an existing exclusion.
  const breadcrumbs = Array.from(
    new Set(
      (parent.metrics.bsrSamples || []).flatMap((s) =>
        Array.isArray(s.category) ? s.category : s.category ? [s.category] : []
      )
    )
  );
  if (breadcrumbs.length) {
    const re = classifyContentType({ keyword: '', categories: breadcrumbs, scope: settings.contentScope || 'strict' });
    const alreadyExcluded = parent.metrics.contentType === 'high-content-excluded';
    if (!alreadyExcluded && re.contentType === 'high-content-excluded') {
      parent.metrics.contentType = 'high-content-excluded';
      parent.metrics.contentTypeLabel = re.contentTypeLabel;
      parent.metrics.contentTypeSource = 'category-breadcrumb';
      parent.metrics.contentTypeConfidence = re.confidence;
      parent.metrics.requiresExpertise = !!re.requiresExpertise;
    } else if (
      !alreadyExcluded &&
      (parent.metrics.contentType == null || parent.metrics.contentType === 'unknown') &&
      re.contentType !== 'unknown'
    ) {
      parent.metrics.contentType = re.contentType;
      parent.metrics.contentTypeLabel = re.contentTypeLabel;
      parent.metrics.contentTypeSource = re.contentTypeSource;
      parent.metrics.contentTypeConfidence = re.confidence;
      parent.metrics.requiresExpertise = !!re.requiresExpertise;
    }
  }

  const scored = scoreKeyword(parent.keyword, parent.metrics, { longTail: true, thresholds });
  attachQualifies(scored, thresholds);
  Object.assign(parent, {
    score: scored.score,
    demand: scored.demand,
    competition: scored.competition,
    margin: scored.margin,
    confidence: scored.confidence,
    estimatedMonthlySales: scored.estimatedMonthlySales,
    verdict: scored.verdict,
    metrics: scored.metrics,
    qualifies: scored.qualifies
  });
  parent.scoredAt = new Date().toISOString();

  await putKeyword(parent);
  return {
    merged: true,
    asin: payload.asin,
    bestSubcategoryBsr: parent.metrics.bestSubcategoryBsr,
    bsrCoverage: parent.metrics.bsrCoverage,
    bsrSamples: parent.metrics.bsrSamples.length,
    bsrExpected: parent.metrics.bsrExpected,
    qualifies: parent.qualifies
  };
}

async function handleProductParsed(payload, sender) {
  const tabId = sender.tab && sender.tab.id;

  if (payload.blocked) {
    if (tabId != null) {
      scrapeQueue.failTabPermanently(tabId);
      broadcastPipeline('enrichment', `Blocked (CAPTCHA) while reading ASIN ${payload.asin}.`);
    } else {
      scrapeQueue.failed++;
    }
    return { blocked: true, asin: payload.asin };
  }

  if (tabId != null) {
    const task = scrapeQueue.taskForTab(tabId);
    scrapeQueue.resolveTab(tabId, { kind: 'product', asin: payload.asin });
    if (task && task.type === 'product' && task.parentKeyword) {
      return mergeProductIntoParent(task.parentKeyword, payload);
    }
  }
  const keyword = `dp/${payload.asin}`;
  const market = marketFromDomain(hostnameFromUrl(payload.url));
  const record = {
    keyword,
    market: market.code,
    url: payload.url,
    asin: payload.asin,
    metrics: payload,
    product: payload,
    scoredAt: new Date().toISOString()
  };
  await putKeyword(record);
  return { asin: payload.asin };
}

// ---------------------------------------------------------------------------
// Interest-proxy engine (Phase 3): alphabet-soup autocomplete depth + position
// ---------------------------------------------------------------------------

async function computeProxyForKeyword(keyword, marketCode, settings) {
  const corpus = await collectAutocompleteCorpus(keyword, marketCode, settings);
  return computeDemandProxyScore({ amazon: corpus.amazon, google: corpus.google });
}

async function collectAutocompleteCorpus(keyword, marketCode, settings) {
  const amazon = [];
  const google = [];
  const prefixes = [keyword, ...ALPHABET.map((l) => `${keyword} ${l}`)];

  if (settings.autocompleteEnabled !== false) {
    for (const p of prefixes) {
      if (amazon.length >= CORPUS_CAP_PER_ENGINE) break;
      try {
        const words = await amazonAutocomplete(p, marketCode);
        words.forEach((w, i) => amazon.push({ term: w, position: i + 1 }));
      } catch {
        // keep collecting; failures are expected under rate limiting.
      }
    }
  }
  if (settings.googleSuggestEnabled !== false) {
    for (const p of prefixes) {
      if (google.length >= CORPUS_CAP_PER_ENGINE) break;
      try {
        const words = await googleSuggest(p, marketCode);
        words.forEach((w, i) => google.push({ term: w, position: i + 1 }));
      } catch {
        // ignore
      }
    }
  }
  return { amazon, google };
}

// ---------------------------------------------------------------------------
// Expansion (AI first, local autocomplete as fallback)
// ---------------------------------------------------------------------------

async function handleExpandSeed(seed, marketCode) {
  const settings = await getSettings();
  const market = getMarket(marketCode || settings.market);
  const thresholds = settingsToThresholds(settings);

  const apiKey = await getApiKey();

  // One alphabet-soup run serves expansion AND the per-suggestion proxy.
  const corpus = await collectAutocompleteCorpus(seed, market.code, settings).catch(() => ({ amazon: [], google: [] }));
  const seedProxy = computeDemandProxyScore({ amazon: corpus.amazon, google: corpus.google });

  const allowFiction = settings.allowNicheFiction !== false;
  const scope = settings.contentScope || 'strict';

  let suggestions;
  if (apiKey) {
    suggestions = await expandNicheSeeds({
      apiKey,
      seed,
      market,
      count: 12,
      allowFiction,
      scope
    });
  } else {
    suggestions = await localExpandSuggestions({
      amazonWords: corpus.amazon.map((e) => e.term),
      googleWords: corpus.google.map((e) => e.term),
      seed,
      allowFiction,
      scope
    });
  }

  if (!suggestions.length) {
    throw new Error('No suggestions could be generated. Add a Gemini API key or retry with a clearer seed.');
  }

  // Fix A (Revision 2): the content-type verdict was computed but never acted
  // on. For AI output -- where the model makes things up -- an 'unknown'
  // verdict is NOT cleared: it usually means an existing-book title (e.g.
  // "the intelligent investor") with no low-content markers, and there is no
  // other pre-scrape signal to rescue it. Local autocomplete suggestions are
  // corpus-verified, so they only lose the hard-excluded class.
  const isExistingTitle = (s) => s && s.isExistingTitle === true;
  const classifyDrop = (kw, { dropUnknown }) => {
    const ct = classifyContentType({ keyword: kw, allowFiction, scope });
    if (ct.contentType === 'high-content-excluded' || ct.requiresExpertise) return true;
    if (dropUnknown && ct.contentType === 'unknown') return true;
    return false;
  };

  let skippedCt = 0;
  const candidates = suggestions.filter((s) => {
    const keyword = String((s.keyword || s) || '').trim();
    if (isExistingTitle(s) || !keyword) {
      skippedCt++;
      return false;
    }
    if (classifyDrop(keyword, { dropUnknown: !!apiKey })) {
      skippedCt++;
      return false;
    }
    return true;
  });

  if (!candidates.length) {
    throw new Error('All suggestions were high-content, existing-book titles, or empty. Try a different seed.');
  }

  // Revision 2 (Bug 2): when a suggestion misses the shared alphabet-soup
  // corpus, `deriveSuggestionProxy` now returns null instead of a seed-wide
  // constant that made every unrelated title share an identical score tuple.
  // Probe the term once directly per-suggestion; if that also fails, the
  // proxy stays honestly null ("not yet measured") and demand falls to its
  // data-blind baseline.
  async function probeSuggestionProxy(keyword, marketCode, settings) {
    const amazon = [];
    const google = [];
    if (settings.autocompleteEnabled !== false) {
      try {
        (await amazonAutocomplete(keyword, marketCode)).forEach((w, i) => amazon.push({ term: w, position: i + 1 }));
      } catch {
        // probe failures are expected under rate limiting
      }
    }
    if (settings.googleSuggestEnabled !== false) {
      try {
        (await googleSuggest(keyword, marketCode)).forEach((w, i) => google.push({ term: w, position: i + 1 }));
      } catch {
        // ignore
      }
    }
    if (!amazon.length && !google.length) return null;
    return computeDemandProxyScore({ amazon, google }).score;
  }

  const records = [];
  for (const s of candidates) {
    const keyword = String(s.keyword || s || '').trim();
    let demandProxyScore = deriveSuggestionProxy(keyword, corpus, seedProxy.score);
    let probed = false;
    if (demandProxyScore == null) {
      demandProxyScore = await probeSuggestionProxy(keyword, market.code, settings);
      probed = true;
    }
    const proxyBreakdown = {
      seedProxyScore: seedProxy.score,
      corpusAmazon: corpus.amazon.length,
      corpusGoogle: corpus.google.length,
      crossMatches: seedProxy.breakdown ? seedProxy.breakdown.crossMatches : 0,
      probed
    };
    const scored = scoreKeyword(keyword, { demandProxyScore, sampleSize: 0 }, { longTail: true, thresholds });
    const ct = classifyContentType({ keyword, allowFiction, scope });
    records.push({
      keyword,
      market: market.code,
      aiTitleIdea: s.titleIdea || null,
      aiCategory: s.category || null,
      aiRationale: s.why || null,
      source: s.source || 'gemini',
      expandedFrom: seed,
      metrics: {
        ...scored.metrics,
        demandProxyScore,
        demandProxyBreakdown: proxyBreakdown,
        sampleSize: 0,
        contentType: ct.contentType,
        contentTypeLabel: ct.contentTypeLabel,
        contentTypeSource: ct.contentTypeSource,
        contentTypeConfidence: ct.confidence,
        requiresExpertise: !!ct.requiresExpertise
      },
      sample: [],
      scrapedAt: Date.now(),
      scoredAt: new Date().toISOString(),
      score: scored.score,
      demand: scored.demand,
      competition: scored.competition,
      margin: scored.margin,
      confidence: scored.confidence,
      estimatedMonthlySales: null,
      verdict: scored.verdict,
      qualifies: computeSuggestionQualifies(scored, thresholds, keyword, allowFiction, scope)
    });
  }

  if (settings.autocompleteEnabled !== false) {
    const suggestionRows = candidates
      .filter((s) => s.source === 'amazon-autocomplete' || s.source === 'google-suggest')
      .map((s) => ({
        id: `${s.source}:${s.keyword}:${market.code}`,
        keyword: s.keyword,
        source: s.source,
        market: market.code,
        expandedFrom: seed,
        score: s.score || 0
      }));
    if (suggestionRows.length) await putSuggestions(suggestionRows);
  }

  await putKeywords(records);
  enqueueScraping(records.map((r) => r.keyword), market.code);

  return {
    keywords: records.map((r) => r.keyword),
    ai: candidates,
    count: records.length,
    dropped: skippedCt,
    proxy: seedProxy
  };
}

function computeSuggestionQualifies(scored, thresholds, keyword, allowFiction = true, scope = 'strict') {
  const ct = classifyContentType({ keyword: keyword || '', allowFiction, scope });
  const excluded =
    ct.contentType === 'high-content-excluded' || ct.requiresExpertise;
  return {
    bsr: false,
    listings: scored.metrics.totalResultsCount != null && scored.metrics.totalResultsCount <= (thresholds.listingsThreshold ?? 1000),
    volume: scored.metrics.demandProxyScore != null && scored.metrics.demandProxyScore >= (thresholds.volumeThreshold ?? 50),
    contentType: (thresholds.contentTypeEnabled === false) ? true : !excluded,
    all: false
  };
}

async function fetchSuggestions({ seed, market }) {
  if (!seed || !seed.trim()) return { amazon: [], google: [] };
  const settings = await getSettings();
  const amazon = settings.autocompleteEnabled !== false
    ? await amazonAutocomplete(seed, market) : [];
  const google = settings.googleSuggestEnabled !== false
    ? await googleSuggest(seed, market) : [];
  return { amazon, google };
}

export async function amazonAutocomplete(seed, marketCode) {
  const market = getMarket(marketCode);
  const url = autocompleteUrl(market.code, seed);
  for (let attempt = 1; attempt <= 2; attempt++) {
    const res = await fetch(url, {
      headers: {
        'User-Agent':
          'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36'
      }
    });
    if (!res.ok) throw new Error(`Amazon suggest ${res.status}`);
    let data = {};
    try {
      data = await res.json();
    } catch {
      data = {};
    }
    const words = (data.suggestions || [])
      .filter((s) => s && s.value)
      .map((s) => s.value);
    if (words.length) return words.slice(0, 11);
    if (attempt === 1) {
      await new Promise((r) => setTimeout(r, 1500));
    }
  }
  return [];
}

export async function googleSuggest(seed, marketCode) {
  const market = getMarket(marketCode);
  const url = googleSuggestUrl(seed, market.code);
  for (let attempt = 1; attempt <= 2; attempt++) {
    const res = await fetch(url, { headers: { 'X-Chrome-UMA-Enabled': '1' } });
    if (!res.ok) throw new Error(`Google suggest ${res.status}`);
    let data = [];
    try {
      data = await res.json();
    } catch {
      data = [];
    }
    const words = Array.isArray(data) && Array.isArray(data[1]) ? data[1] : [];
    if (words.length) return words.slice(0, 20);
    if (attempt === 1) {
      await new Promise((r) => setTimeout(r, 1500));
    }
  }
  return [];
}

async function expandFromSuggestions(marketCode) {
  const settings = await getSettings();
  const market = getMarket(marketCode || settings.market);
  const thresholds = settingsToThresholds(settings);
  const all = await getAllSuggestions();
  const unique = Object.values(
    all.reduce((acc, s) => {
      if (s.keyword) acc[s.keyword] = s;
      return acc;
    }, {})
  );

  const records = unique
    .map((s) => {
      const scored = scoreKeyword(s.keyword, {}, { longTail: true, thresholds });
      const allowFiction = settings.allowNicheFiction !== false;
      const scope = settings.contentScope || 'strict';
      const ct = classifyContentType({ keyword: s.keyword, allowFiction, scope });
      if (ct.contentType === 'high-content-excluded' || (scope === 'strict' && ct.contentType === 'unknown')) return null;
      return {
      keyword: s.keyword,
      market: market.code,
      source: s.source || 'unknown',
      expandedFrom: s.expandedFrom || null,
      metrics: {
        ...scored.metrics,
        contentType: ct.contentType,
        contentTypeLabel: ct.contentTypeLabel,
        contentTypeSource: ct.contentTypeSource,
        contentTypeConfidence: ct.confidence,
        requiresExpertise: !!ct.requiresExpertise
      },
      sample: [],
      scrapedAt: Date.now(),
      scoredAt: new Date().toISOString(),
      score: scored.score,
      demand: scored.demand,
      competition: scored.competition,
      margin: scored.margin,
      confidence: scored.confidence,
      estimatedMonthlySales: null,
      verdict: scored.verdict,
      qualifies: computeSuggestionQualifies(scored, thresholds, s.keyword, settings.allowNicheFiction !== false, settings.contentScope || 'strict')
      };
    })
    .filter(Boolean);

  if (records.length) await putKeywords(records);
  enqueueScraping(records.map((r) => r.keyword), market.code);
  return { count: records.length };
}

// ---------------------------------------------------------------------------
// Scraping batch helpers
// ---------------------------------------------------------------------------

async function enqueueScraping(keywords, marketCode) {
  const { scrapedPages } = await getSettings();
  const tasks = keywords.map((keyword) => ({
    keyword,
    market: marketCode,
    scrapedPages: scrapedPages || 1
  }));
  scrapeQueue.enqueueMany(tasks);
}

async function scrapeOne({ keyword, market }) {
  enqueueScraping([keyword], market || (await getSettings()).market);
  return true;
}

async function scrapeAll(filter = {}) {
  const all = await getAllKeywords();
  const unscraped = all.filter((k) => {
    if (k.keyword && k.keyword.startsWith('dp/')) return false;
    const m = k.metrics || {};
    const hasSample = (m.sampleSize != null && m.sampleSize > 0) || (m.sample || []).length;
    if (hasSample) return false;
    if (filter.market && k.market !== filter.market) return false;
    return true;
  });
  const market = filter.market || (await getSettings()).market;
  if (!unscraped.length) return { count: 0 };
  enqueueScraping(unscraped.map((k) => k.keyword), market);
  return { count: unscraped.length };
}

// ---------------------------------------------------------------------------
// Discovery Mode (Phase 4) + one-click orchestration (Phase 6)
//
// These pages are client-rendered, so they are scraped the same way SERPs and
// product pages are: the scrape queue opens a real Amazon tab, the
// discovery-parser content script reads the rendered grid, and the background
// closes the tab. fetch()+DOMParser from the worker gets a JS shell ("Best
// undefined") with zero products, so that path is not used here.
// ---------------------------------------------------------------------------

let discoveryState = { active: false, found: [], nodes: [], cap: 12 };

function surfaceDiscoveryNodeCandidates(marketCode, settings) {
  const market = getMarket(marketCode || settings.market);
  const count = Math.max(1, settings.discoveryCategoryCount || 8);
  return pickDiscoveryNodes(settings.discoveryCategoryIds)
    .slice(0, count)
    .map((node) => [
      { url: bestsellersUrl(market.code, node.id), label: 'bestsellers', category: node.name, nodeId: node.id },
      { url: moversUrl(market.code, node.id), label: 'movers', category: node.name, nodeId: node.id }
    ])
    .flat();
}

function loadDiscoveryNodeTasks(candidates, marketCode) {
  return candidates.map((c) => ({
    type: 'discovery',
    url: c.url,
    market: marketCode,
    label: c.label,
    category: c.category,
    nodeId: c.nodeId
  }));
}

async function handleDiscoveryParsed(payload, sender) {
  const tabId = sender.tab && sender.tab.id;

  if (payload.blocked) {
    if (tabId != null) scrapeQueue.resolveTabFailed(tabId, { kind: payload.kind, blocked: true });
    broadcastPipeline('discovery', 'Discovery page blocked (CAPTCHA) — skipped.');
    return { count: 0, blocked: true };
  }

  const faces = Array.isArray(payload.faceouts) ? payload.faceouts : [];
  if (tabId != null) {
    const task = scrapeQueue.taskForTab(tabId);
    scrapeQueue.resolveTab(tabId, { kind: payload.kind, count: faces.length });
    if (task && task.type === 'discovery') {
      faces.forEach((f) =>
        discoveryState.found.push({ ...f, category: task.category, source: task.label })
      );
      broadcastPipeline('discovery', `Parsed ${faces.length} products from ${task.category} (${task.label}).`);
    }
  }
  return { count: faces.length };
}

async function runDiscovery({
  marketCode,
  categoryCount,
  maxKeywords,
  silent = false
} = {}) {
  const settings = await getSettings();
  const market = getMarket(marketCode || settings.market);
  const thresholds = settingsToThresholds(settings);
  const count = Math.max(1, categoryCount || settings.discoveryCategoryCount || 8);
  const cap = Math.max(1, maxKeywords || settings.discoveryMaxKeywords || 12);

  if (discoveryState.active) {
    return { count: 0, inProgress: true, discovered: [] };
  }

  const candidates = surfaceDiscoveryNodeCandidates(marketCode, settings).slice(0, count * 2);
  broadcastPipeline('discovery', `Discovering from ${candidates.length} Amazon category pages…`);

  // The worker may already be mid-scrape (e.g. a long-running expansion batch
  // triggered the "Find Me Niches" button). Wait for the queue to finish before
  // inserting the discovery tabs so discovery results don't sit behind dozens
  // of pending SERP/enrichment tasks.
  while (!scrapeQueue.idle && scrapeQueue.status !== STATUS.PAUSED) {
    await sleep(500);
  }

  discoveryState = {
    active: true,
    found: [],
    cap,
    tasksScheduled: candidates.length
  };

  scrapeQueue.enqueueMany(loadDiscoveryNodeTasks(candidates, market.code));

  // Wait until every discovery tab has reported and the queue has drained.
  const start = Date.now();
  const timeoutMs = 6 * 60 * 1000;
  while (
    scrapeQueue.pendingTabs.size > 0 ||
    scrapeQueue.queue.some((t) => t.type === 'discovery')
  ) {
    if (discoveryState.active === false) break;
    if (Date.now() - start > timeoutMs) {
      broadcastPipeline('discovery', 'Discovery timed out — using what parsed so far.');
      break;
    }
    await sleep(700);
  }

  discoveryState.active = false;

  // Distinct titles → cleaned keyword seeds.
  const seen = new Set();
  let keywords = [];
  for (const f of discoveryState.found) {
    const kw = cleanTitleToKeyword(f.title);
    if (!kw) continue;
    const norm = kw.toLowerCase();
    if (seen.has(norm)) continue;
    seen.add(norm);
    keywords.push({ keyword: kw, category: f.category, source: f.source, asin: f.asin });
    if (keywords.length >= cap) break;
  }

  const existing = await getAllKeywords();
  const existingSet = new Set(existing.map((k) => (k.keyword || '').toLowerCase()));
  const fresh = keywords.filter((k) => !existingSet.has(k.keyword.toLowerCase()));

  if (!fresh.length) {
    broadcastPipeline('discovery', 'Discovery found no new keywords (all already present).');
    return { count: 0, discovered: [], consumed: discoveryState.found.length };
  }

  // Proxy: run full alphabet soups for the top few, then derive the rest from
  // the merged corpus (bounded network traffic for a "from nothing" session).
  const corpus = { amazon: [], google: [] };
  const proxyDepth = 3;
  const depthBatch = fresh.slice(0, proxyDepth);
  for (const kw of depthBatch) {
    try {
      const c = await collectAutocompleteCorpus(kw.keyword, market.code, settings);
      corpus.amazon.push(...c.amazon);
      corpus.google.push(...c.google);
      corpus.amazon = corpus.amazon.slice(0, 200);
      corpus.google = corpus.google.slice(0, 200);
    } catch {
      // ignore
    }
  }
  const mergedProxy = computeDemandProxyScore({ amazon: corpus.amazon, google: corpus.google });

  // Phase 1.5 / v0.6: drop keywords an indie can't publish before they reach
  // the batch scraper. In strict scope ONLY blank-interior families qualify.
  const scope = settings.contentScope || 'strict';
  const freshWithCt = fresh.map((k) => ({ ...k, ct: classifyContentType({ keyword: k.keyword, scope }) }));
  const publishable =
    thresholds.contentTypeEnabled === false
      ? freshWithCt
      : scope === 'strict'
        ? freshWithCt.filter((k) => k.ct.contentType === 'low-content')
        : freshWithCt.filter((k) => k.ct.contentType !== 'high-content-excluded' && !k.ct.requiresExpertise);
  const skipped = freshWithCt.length - publishable.length;
  if (skipped > 0) {
    broadcastPipeline('discovery', `Discovery skipped ${skipped} term(s) outside the ${scope} content scope (non-low-content / expert non-fiction).`);
  }

  if (!publishable.length) {
    broadcastPipeline('discovery', 'Discovery found nothing inside the current content scope — nothing publishable to queue.');
    return { count: 0, discovered: [], consumed: discoveryState.found.length, skipped };
  }

  const records = publishable.map((k) => {
    const ctt = k.ct;
    const demandProxyScore = deriveSuggestionProxy(k.keyword, corpus, mergedProxy.score);
    const scored = scoreKeyword(k.keyword, { demandProxyScore }, { longTail: true, thresholds });
    return {
      keyword: k.keyword,
      market: market.code,
      source: `discovery:${k.source || 'unknown'}:${k.category || 'uncategorized'}`,
      expandedFrom: k.category || 'discovery',
      aiCategory: k.category || null,
      aiRationale: 'Discovered from an Amazon Top-100 list — reflects current demand in a live-selling niche.',
      metrics: {
        ...scored.metrics,
        demandProxyScore,
        sampleSize: 0,
        contentType: ctt.contentType,
        contentTypeLabel: ctt.contentTypeLabel,
        contentTypeSource: ctt.contentTypeSource,
        contentTypeConfidence: ctt.confidence,
        requiresExpertise: !!ctt.requiresExpertise
      },
      sample: [],
      asin: k.asin || null,
      scrapedAt: Date.now(),
      scoredAt: new Date().toISOString(),
      score: scored.score,
      demand: scored.demand,
      competition: scored.competition,
      margin: scored.margin,
      confidence: scored.confidence,
      estimatedMonthlySales: null,
      verdict: scored.verdict,
      qualifies: computeSuggestionQualifies(scored, thresholds, k.keyword, settings.allowNicheFiction !== false, scope)
    };
  });

  await putKeywords(records);
  enqueueScraping(records.map((r) => r.keyword), market.code);
  await addDiscoveryRun({
    count: records.length,
    consumed: discoveryState.found.length,
    nodes: [...new Set(candidates.map((c) => c.nodeId))],
    market: market.code
  });

  if (!silent) {
    broadcastPipeline('discovery', `Discovery complete: ${records.length} new keywords queued for scraping.`);
  }
  return {
    count: records.length,
    discovered: records.map((r) => r.keyword),
    consumed: discoveryState.found.length
  };
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

// ---------------------------------------------------------------------------
// AI niche actions
// ---------------------------------------------------------------------------

async function handleAnalyzeNiche(keyword) {
  const apiKey = await getApiKey();
  if (!apiKey) throw new Error('Set a Gemini API key in Settings first.');

  const record = await getKeyword(keyword);
  if (!record) throw new Error(`No data saved for "${keyword}". Scrape it first.`);

  const analysis = await analyzeNiche({ apiKey, keyword, keywordRecord: record });
  await putAnalysis(keyword, analysis);
  return analysis;
}

async function handleCheckTrademark(keyword) {
  const apiKey = await getApiKey();
  const record = await getKeyword(keyword).catch(() => null);

  const scan = apiKey
    ? await checkTrademark({ apiKey, keyword, keywordRecord: record || {} })
    : await localTrademarkSweep(keyword, record || {});

  await putLegal(keyword, scan);
  return scan;
}

async function handleGenerateListing(keyword, niche) {
  const apiKey = await getApiKey();
  if (!apiKey) throw new Error('Set a Gemini API key in Settings first.');

  const record = await getKeyword(keyword);
  const listing = await generateListing({
    apiKey,
    niche,
    keywordRecord: record || {}
  });
  return listing;
}

// ---------------------------------------------------------------------------
// Queue progress broadcasting to dashboard tabs
// ---------------------------------------------------------------------------

scrapeQueue.onProgress((snapshot) => {
  chrome.tabs.query({}, (tabs) => {
    tabs.forEach((t) => {
      if (t.url && t.url.includes(DASHBOARD_URL)) {
        chrome.tabs
          .sendMessage(t.id, { type: 'QUEUE_PROGRESS', payload: snapshot })
          .catch(() => {});
      }
    });
  });
});

export { scrapeQueue };
export { newReleasesUrl };