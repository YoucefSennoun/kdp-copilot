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
  newReleasesUrl,
  setSearchZip,
  SORT_BESTSELLERS,
  SORT_NEW_RELEASES
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
  computeSuggestionRelevance,
  getApiKey,
  hasCustomAI,
  fetchModelChoices,
  CUSTOM_MODEL_CHOICES
} from './ai.js';
import { computeDemandProxyScore, deriveSuggestionProxy } from '../lib/proxy.js';
import { pickDiscoveryNodes } from '../lib/categories.js';
import { cleanTitleToKeyword } from './discovery.js';
import { classifyContentType, scopeAllows } from '../lib/content-type.js';
import { computeBrandRisk, matchBlockedBrand, matchFamousAuthor, computeAuthorFrequencyRisk } from '../lib/brands.js';
import { TRADEMARK_REGISTRIES, buildRegistryLookups } from '../lib/trademark-registry.js';

const DASHBOARD_URL = 'src/dashboard/index.html';
const ALPHABET = 'abcdefghijklmnopqrstuvwxyz'.split('');
const CORPUS_CAP_PER_ENGINE = 80;
const DEFAULT_TRADEMARK_MARKETS = Object.keys(TRADEMARK_REGISTRIES);

// v0.8.1: pause is a persisted user choice, not in-memory state. The service
// worker can restart at any time (losing everything in memory), which used to
// silently "unpause" and let the next Amazon page restart the queue.
const PAUSE_FLAG_KEY = 'kdpPaused';
let pauseRestored = false;

async function setPausedFlag(paused) {
  try {
    await chrome.storage.local.set({ [PAUSE_FLAG_KEY]: !!paused });
  } catch {
    // storage unavailable — the in-memory queue state still holds for now.
  }
}

async function ensurePauseRestored() {
  if (pauseRestored) return;
  pauseRestored = true;
  try {
    const stored = await chrome.storage.local.get([PAUSE_FLAG_KEY]);
    if (stored && stored[PAUSE_FLAG_KEY]) scrapeQueue.stop();
  } catch {
    // ignore — queue simply starts unpaused.
  }
}

async function isPaused() {
  await ensurePauseRestored();
  return scrapeQueue.paused;
}

// Explicit dashboard/shortcut actions that mean "go": clicking one of these
// while paused resumes the queue so the requested work actually runs instead
// of piling up silently behind a pause.
const EXPLICIT_RESUME_TYPES = new Set([
  'EXPAND_SEED',
  'RESEARCH_FORMAT',
  'SCRAPE_KEYWORD',
  'SCRAPE_ALL',
  'DISCOVER_NICHES',
  'FIND_ME_NICHES',
  'EXPAND_FROM_SUGGESTIONS'
]);

// ---------------------------------------------------------------------------
// Lifecycle
// ---------------------------------------------------------------------------

chrome.runtime.onInstalled.addListener(async () => {
  pruneSuggestions().catch(() => {});
  const settings = await getSettings();
  setupDiscoveryAlarm(settings);
  ensurePauseRestored();
  console.log('[KDP Copilot] Installed.');
});

chrome.runtime.onStartup.addListener(async () => {
  const settings = await getSettings();
  setupDiscoveryAlarm(settings);
  ensurePauseRestored();
});

chrome.alarms.onAlarm.addListener((alarm) => {
  if (alarm.name === 'kdp-discovery') {
    // A scheduled run must never override the user's pause.
    isPaused().then((paused) => {
      if (paused) {
        console.log('[KDP Copilot] scheduled discovery skipped (queue paused).');
        return;
      }
      runDiscovery({ silent: true })
        .catch((err) => console.warn('[KDP Copilot] scheduled discovery failed:', err));
    });
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
  // Rules v1 (rule 7): pin the search to the market's capital-city ZIP so
  // results reflect a realistic domestic delivery location.
  setSearchZip(market.zipCode || '');
  const params = {};
  if (task.sort) {
    params.s = task.sort;
  }
  if (task.formatFilter && ['kindle', 'paperback', 'hardcover'].includes(task.formatFilter)) {
    params.rh = `p_n_feature_nine_browse-bin:${FORMAT_FACET_BIN[task.formatFilter]}`;
  }
  if (task.scrapedPages && task.scrapedPages > 1) {
    params.page = task.scrapedPages;
  }
  const url = task.url || searchUrl(market.code, task.keyword, params);
  return await openTab(url);
}

// Rules v1 (rule 6): Amazon format facet binding-node IDs. These are the
// standard "Binding" browse bins used by the Books search refinements
// (Kindle = "Kindle Edition", Paperback = "Paperback", Hardcover =
// "Hardcover"). The SERP parser reports the actual facet links back so we can
// self-calibrate if Amazon shifts these IDs.
const FORMAT_FACET_BIN = {
  kindle: '14260169011',
  paperback: '14260168011',
  hardcover: '14260167011'
};

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

  // v0.8.1: the worker may have just restarted (memory wiped) — restore the
  // user's pause choice before handling anything, so an auto-parsed Amazon
  // page can never restart a paused queue.
  await ensurePauseRestored();

  // Explicit user action means "go": resume a paused queue so the requested
  // Research / Scrape / Discover work actually runs.
  if (EXPLICIT_RESUME_TYPES.has(message.type) && scrapeQueue.paused) {
    scrapeQueue.resume();
    await setPausedFlag(false);
  }

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
      return getKeyword(k('keyword'), k('market'));
    case 'DELETE_KEYWORD':
      return deleteKeyword(k('keyword'), k('market'));
    case 'PURGE_OUTSIDE_SCOPE': {
      const s = await getSettings();
      return purgeOutsideScope(s.contentScope || 'rule8');
    }
    case 'CLEAR_KEYWORDS':
      return clearKeywords();
    case 'CLEAR_ALL':
      scrapeQueue.abort();
      // Stop a mid-flight discovery run: its wait loop breaks on active=false
      // and its epoch guard drops the pending put/enqueue steps.
      discoveryState.active = false;
      discoveryState.found = [];
      await clearKeywords();
      await clearSuggestions();
      await clearAnalyses();
      await clearLegals();
      await clearDiscoveryRuns();
      // Stay paused after a reset so strays (manually-opened Amazon pages,
      // late parse messages) can only save locally — never open new tabs.
      // The next explicit Research/Expand/Scrape auto-resumes the queue.
      scrapeQueue.stop();
      await setPausedFlag(true);
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
      return handleExpandSeed(k('seed'), k('market'));
    case 'RESEARCH_FORMAT':
      return handleResearchFormat(k('seed'), k('market'));
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
      await setPausedFlag(true);
      return true;
    case 'RESUME_QUEUE':
      scrapeQueue.resume();
      await setPausedFlag(false);
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
      return handleAnalyzeNiche(k('keyword'), k('market'));
    case 'GENERATE_LISTING':
      return handleGenerateListing(k('keyword'), k('niche'), k('market'));
    case 'CHECK_TRADEMARK':
      return handleCheckTrademark(k('keyword'), k('market'), k('markets'));
    case 'GET_ALL_LEGAL':
      return getAllLegals();
    case 'GET_LEGAL':
      return getLegal(k('keyword'), k('market'));
    case 'GET_REGISTRY_LOOKUPS':
      return buildRegistryLookups(k('keyword'), k('markets'));

    // Settings / dashboard
    case 'GET_SETTINGS':
      return getSettings();
    case 'GET_MODELS': {
      const models = await fetchModelChoices('gemini');
      return { models: models.map((m) => m.id), customModels: CUSTOM_MODEL_CHOICES };
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
    subBsrEnabled: settings.subBsrEnabled === true,
    overallBsrMax: settings.overallBsrMax ?? 200000,
    overallBsrEnabled: settings.overallBsrEnabled !== false,
    usListingsMax: settings.usListingsMax ?? 1000,
    otherListingsMax: settings.otherListingsMax ?? 800,
    maxBookAgeMonths: settings.maxBookAgeMonths ?? 6,
    freshHitsMin: settings.freshHitsMin ?? 1,
    brandFilterEnabled: settings.brandFilterEnabled !== false,
    volumeThreshold: settings.volumeThreshold ?? 50,
    keywordSuggestedRequired: settings.keywordSuggestedRequired === true,
    formatFilter: settings.formatFilter ?? null,
    minFormatShare: settings.minFormatShare ?? 0.5,
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
  // v0.8.1: while paused, a (manually opened) Amazon page is only saved and
  // scored locally — it must never trigger new tabs or fetches by itself.
  const paused = scrapeQueue.paused;

  const existing = await getKeyword(keyword, market.code).catch(() => null);
  const isNew = !existing;

  // Merge listings from multiple scrapes (e.g. default + bestsellers + new
  // releases sorts).  Deduplicate by ASIN and cap at 48 to keep metrics
  // computation tractable.
  let mergedListings = listings;
  if (existing && existing.metrics && Array.isArray(existing.sample) && existing.sample.length) {
    const seen = new Set(existing.sample.map((l) => l && l.asin).filter(Boolean));
    const newUnique = (listings || []).filter((l) => l && l.asin && !seen.has(l.asin));
    mergedListings = [...existing.sample, ...newUnique].slice(0, 48);
  }

  let metrics = preprocessMetrics(mergedListings, { totalResultsCount, resultsCountIsApprox });

  // Preserve previously-computed proxy + any partial BSR enrichment.
  if (existing && existing.metrics) {
    if (existing.metrics.demandProxyScore != null) {
      metrics.demandProxyScore = existing.metrics.demandProxyScore;
      metrics.demandProxyBreakdown = existing.metrics.demandProxyBreakdown;
    }
    if (existing.metrics.keywordSuggested != null) {
      metrics.keywordSuggested = existing.metrics.keywordSuggested;
    }
    if (Array.isArray(existing.metrics.bsrSamples) && existing.metrics.bsrSamples.length) {
      metrics = applyBsrSamples(
        metrics,
        existing.metrics.bsrSamples,
        existing.metrics.bsrExpected ?? metrics.sampleSize
      );
      // Rules v1 (rule 3): preserve the enriched brand fingerprint + the
      // blocked-ASIN set across re-scrapes.
      if (existing.metrics.brandRisk) metrics.brandRisk = existing.metrics.brandRisk;
      if (Array.isArray(existing.metrics.brandBlockedAsins)) {
        metrics.brandBlockedAsins = existing.metrics.brandBlockedAsins;
      }
    }
    if (existing.metrics.bsrExpected != null) metrics.bsrExpected = existing.metrics.bsrExpected;
  }

  // Rules v1 (rule 3, v0.8): brand-risk fingerprint over the SERP sample
  // (titles + authors now that the parser extracts author lines). Recomputed
  // after any preserved enrichment above; enrichment later overwrites with
  // the deeper title+publisher+author pass.
  metrics.brandRisk = metrics.brandRisk || computeBrandRisk(metrics.sample || []);
  if (metrics.brandRisk && metrics.brandRisk.authorBrand) {
    metrics.authorBrand = metrics.brandRisk.authorBrand;
  }

  // Rule 7 (v0.8): FBA/Amazon-retail share — "Ships from Amazon" cards are
  // not the KDP competition pool. Stored for the dashboard readout + the
  // MyResearchBase cross-check link.
  const fbaCount = (metrics.sample || []).filter((l) => l && l.fba).length;
  metrics.fbaCount = fbaCount;
  metrics.fbaShare = metrics.sample && metrics.sample.length ? fbaCount / metrics.sample.length : 0;

  // Rule 7 (v0.8.3): delivery-location proof reported by the content script
  // (desired = market zip from the tab URL, actual = live "Deliver to" glow,
  // pinned = whether they match). Preserved across re-scrapes like the brand
  // fingerprint below.
  if (payload.location && typeof payload.location === 'object') {
    metrics.locationDesired = payload.location.desired || null;
    metrics.locationActual = payload.location.actual || null;
    metrics.locationPinned = payload.location.pinned ?? null;
  } else if (existing && existing.metrics) {
    if (existing.metrics.locationDesired != null) metrics.locationDesired = existing.metrics.locationDesired;
    if (existing.metrics.locationActual != null) metrics.locationActual = existing.metrics.locationActual;
    if (existing.metrics.locationPinned != null) metrics.locationPinned = existing.metrics.locationPinned;
  }

  // Rule 6 (v0.8): Binding-facet self-calibration — log when Amazon's live
  // facet bins drift from FORMAT_FACET_BIN so the IDs can be updated.
  if (payload.formatFacets && Object.keys(payload.formatFacets).length) {
    const drift = Object.entries(payload.formatFacets).filter(
      ([fmt, bin]) => FORMAT_FACET_BIN[fmt] && FORMAT_FACET_BIN[fmt] !== String(bin)
    );
    if (drift.length) {
      console.warn('[KDP Copilot] format facet drift detected:', payload.formatFacets);
    }
    metrics.formatFacetsSeen = payload.formatFacets;
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
    scope: settings.contentScope || 'rule8'
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
  // Skipped while paused (no background fetching until the user resumes).
  if (!paused && isNew && metrics.demandProxyScore == null && (scrapeQueue.size + scrapeQueue.pendingTabs.size) < 4) {
    try {
      const { score, breakdown, keywordSuggested } = await computeProxyForKeyword(keyword, market.code, settings);
      metrics.demandProxyScore = score;
      metrics.demandProxyBreakdown = breakdown;
      metrics.keywordSuggested = keywordSuggested;
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

  const scored = scoreKeyword(keyword, metrics, { longTail: true, thresholds, market: market.code });
  attachQualifies(scored, thresholds, market.code);
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
  // Never while paused — opening an Amazon page must not open new tabs.
  if (!paused && shouldEnrich(record, settings)) {
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
  const seeded = (m.sample || []).filter((l) => l && l.asin);
  if (!seeded.length) return false;
  const have = Array.isArray(m.bsrSamples) ? m.bsrSamples.length : 0;
  // Always enrich when there are zero BSR samples (no price/min-score gate
  // for first-time enrichment — the user needs this data to qualify niches).
  if (have === 0) return true;
  if ((record.score ?? 0) < (settings.enrichmentMinScore ?? 50)) return false;
  const expected = m.bsrExpected ?? 0;
  return have < expected;
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

async function mergeProductIntoParent(parentKeyword, payload, marketCode) {
  const settings = await getSettings();
  const parent = await getKeyword(parentKeyword, marketCode || payload.market);
  if (!parent) return { merged: false, reason: 'parent-missing' };
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
      formats: Array.isArray(payload.formats) ? payload.formats : null,
      // Rules v1 (rule 1): publication date + publisher/author for the
      // freshness + brand gates.
      pubDateEpoch: payload.pubDateEpoch ?? null,
      pubDate: payload.pubDate || null,
      publisher: payload.publisher || null,
      author: payload.author || null,
      title: payload.title || null
    });
  }

  const sampleSize = parent.metrics.bsrExpected ?? parent.metrics.sampleSize ?? 0;
  parent.metrics = applyBsrSamples(parent.metrics, parent.metrics.bsrSamples, sampleSize);

  // Rules v1 (rule 3, v0.8): recompute the brand fingerprint over the
  // ENRICHED sample (titles + publishers + authors now available). Covers
  // the static blocklist, famous AUTHOR names, and author-frequency
  // dominance (one author owning the sample = fame-driven sales).
  const brandBlockedAsins = new Set();
  parent.metrics.brandRisk = computeBrandRisk(
    (parent.metrics.bsrSamples || []).map((s) => ({
      title: s.title,
      publisher: s.publisher,
      author: s.author
    }))
  );
  (parent.metrics.bsrSamples || []).forEach((s) => {
    const blob = `${s.title || ''} ${s.publisher || ''} ${s.author || ''}`;
    if (matchBlockedBrand(blob) || matchFamousAuthor(blob)) brandBlockedAsins.add(s.asin);
  });
  parent.metrics.brandBlockedAsins = [...brandBlockedAsins];
  if (parent.metrics.brandRisk && parent.metrics.brandRisk.authorBrand) {
    parent.metrics.authorBrand = parent.metrics.brandRisk.authorBrand;
  }

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
    const re = classifyContentType({ keyword: '', categories: breadcrumbs, scope: settings.contentScope || 'rule8' });
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

  const scored = scoreKeyword(parent.keyword, parent.metrics, {
    longTail: true,
    thresholds,
    market: parent.market || marketCode || 'us'
  });
  attachQualifies(scored, thresholds, parent.market || marketCode);
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
      return mergeProductIntoParent(task.parentKeyword, payload, task.market);
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
// Interest-proxy engine (Phase 3 + rules v1 rule 4): bidirectional
// alphabet-soup autocomplete depth, position weighting, AND the literal
// "does the keyword itself surface in the search bar" check.
// ---------------------------------------------------------------------------

/** True when the keyword itself (or a 1-token extension) appears in the
 *  suggestion lists — hard proof of real Amazon search volume (rule 4). */
function keywordAppearsInSuggestions(keyword, corpus) {
  const target = String(keyword || '').toLowerCase().trim();
  if (!target) return false;
  const terms = [...(corpus.amazon || []), ...(corpus.google || [])]
    .map((e) => (e && typeof e === 'object' ? e.term : e))
    .filter(Boolean)
    .map((t) => String(t).toLowerCase().trim());
  if (terms.includes(target)) return true;
  // 1-word extension counts ("gratitude journal" suggested for "gratitude").
  const firstWord = target.split(/\s+/)[0];
  return terms.some((t) => t.startsWith(target + ' ') || (firstWord && t === firstWord + ' ' + target.split(/\s+/).slice(1).join(' ')));
}

async function computeProxyForKeyword(keyword, marketCode, settings) {
  const corpus = await collectAutocompleteCorpus(keyword, marketCode, settings);
  const { score, breakdown } = computeDemandProxyScore({ amazon: corpus.amazon, google: corpus.google });
  return {
    score,
    breakdown: { ...breakdown, alphabetProof: corpus.alphabetProof || null },
    keywordSuggested: keywordAppearsInSuggestions(keyword, corpus)
  };
}

/**
 * Bidirectional alphabet soup (rules v1 rule 4, v0.8 full coverage):
 * letters AFTER the keyword ("keyword a"…"keyword z") AND letters BEFORE it
 * ("a keyword"…"z keyword") — the literal rule-4 procedure. The Amazon pass
 * always runs BOTH directions (search-bar volume is the core rule-4 signal);
 * Google keeps suffix-full + conditional-prefix to bound traffic. Per-letter
 * hit sets are returned as `alphabetProof` so the dashboard can show exactly
 * which a–z extensions shoppers actually type.
 */
async function collectAutocompleteCorpus(keyword, marketCode, settings) {
  const amazon = [];
  const google = [];
  const seed = String(keyword || '').trim();

  const suffixPrefixes = [seed, ...ALPHABET.map((l) => `${seed} ${l}`)];
  const prefixPrefixes = ALPHABET.map((l) => `${l} ${seed}`);
  const alphabetProof = {
    suffixLetters: [],
    prefixLetters: [],
    suffixHits: 0,
    prefixHits: 0,
    keywordSuggested: false
  };

  const collect = async (prefix, bucket, letter = null, dir = null) => {
    try {
      const words = bucket === 'amazon' ? await amazonAutocomplete(prefix, marketCode) : await googleSuggest(prefix, marketCode);
      const bucketArr = bucket === 'amazon' ? amazon : google;
      const before = bucketArr.length;
      words.forEach((w, i) => bucketArr.push({ term: w, position: i + 1 }));
      // Proof only tracks the Amazon Books search bar (the rule-4 surface).
      if (bucket === 'amazon' && letter && words.length) {
        if (dir === 'suffix' && !alphabetProof.suffixLetters.includes(letter)) {
          alphabetProof.suffixLetters.push(letter);
          alphabetProof.suffixHits++;
        }
        if (dir === 'prefix' && !alphabetProof.prefixLetters.includes(letter)) {
          alphabetProof.prefixLetters.push(letter);
          alphabetProof.prefixHits++;
        }
      }
      return bucketArr.length - before;
    } catch {
      // keep collecting; failures are expected under rate limiting.
      return 0;
    }
  };

  if (settings.autocompleteEnabled !== false) {
    // v0.8.2: probe the bare seed first — a working endpoint virtually always
    // answers it. Empty twice = dead endpoint for this market/seed: skip the
    // whole alphabet instead of burning ~50 slow prefixes that yield nothing.
    const seedHits = await collect(seed, 'amazon', null, null);
    const amazonAlive = seedHits > 0 || amazon.length > 0;
    if (!amazonAlive) {
      console.warn(`[KDP Copilot] Amazon suggest empty for "${seed}" — skipping alphabet soup for this market.`);
    }
    for (const p of suffixPrefixes.slice(1)) {
      if (!amazonAlive || amazon.length >= CORPUS_CAP_PER_ENGINE) break;
      await collect(p, 'amazon', p.slice(-1), 'suffix');
    }
    // Rule 4 prefix pass — FULL a–z on Amazon (v0.8): the rule explicitly
    // requires testing letters before the keyword too (skipped when the
    // endpoint proved dead on the seed probe above).
    for (const p of prefixPrefixes) {
      if (!amazonAlive || amazon.length >= CORPUS_CAP_PER_ENGINE) break;
      await collect(p, 'amazon', p[0], 'prefix');
    }
  }
  if (settings.googleSuggestEnabled !== false) {
    // Same dead-endpoint guard as Amazon (v0.8.2).
    await collect(seed, 'google');
    const googleAlive = google.length > 0;
    for (const p of suffixPrefixes.slice(1)) {
      if (!googleAlive || google.length >= CORPUS_CAP_PER_ENGINE) break;
      await collect(p, 'google');
    }
    if (googleAlive && google.length < CORPUS_CAP_PER_ENGINE * 0.25) {
      for (const p of prefixPrefixes.slice(0, 12)) {
        if (google.length >= CORPUS_CAP_PER_ENGINE) break;
        await collect(p, 'google');
      }
    }
  }
  alphabetProof.keywordSuggested = keywordAppearsInSuggestions(keyword, { amazon, google });
  return { amazon, google, alphabetProof };
}

// ---------------------------------------------------------------------------
// Expansion (AI first, local autocomplete as fallback)
// ---------------------------------------------------------------------------

async function handleExpandSeed(seed, marketCode) {
  const settings = await getSettings();
  const epoch = scrapeQueue.epoch; // Start-Over guard: abandon puts/enqueues on reset
  const market = getMarket(marketCode || settings.market);
  const thresholds = settingsToThresholds(settings);

  const apiKey = await getApiKey();
  const aiAvailable = !!apiKey || await hasCustomAI();

  // One alphabet-soup run serves expansion AND the per-suggestion proxy.
  const corpus = await collectAutocompleteCorpus(seed, market.code, settings).catch(() => ({ amazon: [], google: [] }));
  const seedProxy = computeDemandProxyScore({ amazon: corpus.amazon, google: corpus.google });
  const seedSuggested = keywordAppearsInSuggestions(seed, { amazon: corpus.amazon, google: corpus.google });

  const allowFiction = settings.allowNicheFiction === true; // rules v1: fiction never allowed in rule8/strict
  const scope = settings.contentScope || 'rule8';

  let suggestions;
  if (aiAvailable) {
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
    throw new Error('No suggestions could be generated. Add an AI provider (Gemini key or Zen/OpenRouter) or retry with a clearer seed.');
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
    if (classifyDrop(keyword, { dropUnknown: aiAvailable })) {
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
    const { score } = computeDemandProxyScore({ amazon, google });
    return {
      score,
      keywordSuggested: keywordAppearsInSuggestions(keyword, { amazon, google })
    };
  }

  const records = [];
  for (const s of candidates) {
    if (epoch !== scrapeQueue.epoch) return { keywords: [], ai: [], count: 0, dropped: skippedCt, proxy: seedProxy, aborted: true };
    const keyword = String(s.keyword || s || '').trim();
    let demandProxyScore = deriveSuggestionProxy(keyword, corpus, seedProxy.score);
    let keywordSuggested = keyword === seed ? seedSuggested : null;
    let probed = false;
    if (demandProxyScore == null) {
      const probe = await probeSuggestionProxy(keyword, market.code, settings);
      probed = true;
      if (probe != null) {
        demandProxyScore = probe.score;
        keywordSuggested = keywordSuggested ?? probe.keywordSuggested;
      }
    }
    if (keywordSuggested == null && keyword === seed) keywordSuggested = seedSuggested;
    const proxyBreakdown = {
      seedProxyScore: seedProxy.score,
      corpusAmazon: corpus.amazon.length,
      corpusGoogle: corpus.google.length,
      crossMatches: seedProxy.breakdown ? seedProxy.breakdown.crossMatches : 0,
      probed,
      // v0.8: full bidirectional a–z proof from the seed soup (rule 4).
      alphabetProof: corpus.alphabetProof || null
    };
    const scored = scoreKeyword(keyword, { demandProxyScore, sampleSize: 0 }, { longTail: true, thresholds, market: market.code });
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
        keywordSuggested,
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
      qualifies: computeSuggestionQualifies(scored, thresholds, keyword, allowFiction, scope, market.code)
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
    if (epoch !== scrapeQueue.epoch) return { keywords: [], ai: [], count: 0, dropped: skippedCt, proxy: seedProxy, aborted: true };
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

function computeSuggestionQualifies(scored, thresholds, keyword, allowFiction = true, scope = 'rule8', market = 'us') {
  const ct = classifyContentType({ keyword: keyword || '', allowFiction, scope });
  const excluded =
    ct.contentType === 'high-content-excluded' || ct.requiresExpertise;
  const listingsCap = (market || 'us').toLowerCase() === 'us'
    ? (thresholds.usListingsMax ?? 1000)
    : (thresholds.otherListingsMax ?? 800);
  return {
    bsr: false,
    bsrOverall: false,
    fresh: false,
    brand: false,
    format: true,
    listings: scored.metrics.totalResultsCount != null && scored.metrics.totalResultsCount <= listingsCap,
    volume: scored.metrics.demandProxyScore != null &&
      scored.metrics.demandProxyScore >= (thresholds.volumeThreshold ?? 50) &&
      (!(thresholds.keywordSuggestedRequired === true) || scored.metrics.keywordSuggested === true),
    contentType: (thresholds.contentTypeEnabled === false) ? true : !excluded,
    all: false
  };
}

async function fetchSuggestions({ seed, market }) {
  if (!seed || !seed.trim()) return { amazon: [], google: [], warnings: [] };
  const settings = await getSettings();
  const marketCode = getMarket(market || settings.market).code;
  const cleanSeed = seed.trim().toLowerCase();
  // Per-engine fail-soft: Google throttles automated traffic with occasional
  // HTTP 403s (bot mitigation on a free, keyless endpoint — not API quota).
  // One dead engine must not kill the other; partial results still persist.
  const warnings = [];
  let amazon = [];
  let google = [];
  if (settings.autocompleteEnabled !== false) {
    try {
      amazon = await amazonAutocomplete(seed, marketCode);
    } catch (err) {
      warnings.push(`Amazon autocomplete unavailable: ${err.message}`);
    }
  }
  if (settings.googleSuggestEnabled !== false) {
    try {
      google = await googleSuggest(seed, marketCode);
    } catch (err) {
      warnings.push(`Google Suggest unavailable: ${err.message}`);
    }
  }

  // Persist so the Suggestions tab (GET_SUGGESTIONS) and EXPAND_FROM_SUGGESTIONS
  // actually see them — previously this fetched but never stored, leaving the
  // tab permanently at "0 suggestion(s) stored."
  const allowFiction = settings.allowNicheFiction === true;
  const scope = settings.contentScope || 'rule8';
  const seen = new Set();
  const rows = [];
  const pushRow = (term, source) => {
    const keyword = String(term || '').trim().toLowerCase();
    if (!keyword || keyword === cleanSeed || seen.has(keyword)) return;
    seen.add(keyword);
    rows.push({
      id: `${source}:${keyword}:${marketCode}`,
      keyword,
      source,
      market: marketCode,
      expandedFrom: seed.trim(),
      score: computeSuggestionRelevance(keyword, seed, allowFiction, scope)
    });
  };
  amazon.forEach((t) => pushRow(t, 'amazon-autocomplete'));
  google.forEach((t) => pushRow(t, 'google-suggest'));
  if (rows.length) await putSuggestions(rows);

  return { amazon, google, warnings };
}

// v0.8.2: suggest fetches time out instead of hanging a whole Research run
// when an endpoint is unreachable from the user's network.
const SUGGEST_TIMEOUT_MS = 8000;

async function fetchWithTimeout(url, options = {}, timeoutMs = SUGGEST_TIMEOUT_MS) {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    return await fetch(url, { ...options, signal: ctrl.signal });
  } finally {
    clearTimeout(timer);
  }
}

export async function amazonAutocomplete(seed, marketCode) {
  const market = getMarket(marketCode);
  const url = autocompleteUrl(market.code, seed);
  for (let attempt = 1; attempt <= 2; attempt++) {
    const res = await fetchWithTimeout(url, {
      headers: {
        'User-Agent':
          'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36'
      }
    });
    if (res.status === 403 || res.status === 429) {
      // Throttled (bot mitigation): back off once, then retry. Still failing
      // afterwards throws and the caller degrades gracefully per engine.
      if (attempt === 1) {
        await new Promise((r) => setTimeout(r, 2500));
        continue;
      }
    }
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
    const res = await fetchWithTimeout(url, { headers: { 'X-Chrome-UMA-Enabled': '1' } });
    if (res.status === 403 || res.status === 429) {
      // Same throttling back-off as Amazon (see above).
      if (attempt === 1) {
        await new Promise((r) => setTimeout(r, 2500));
        continue;
      }
    }
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

// ---------------------------------------------------------------------------
// Research: alphabet-soup expansion → scrape → enrich → filter.
//
// The user enters a seed keyword (e.g. "logbook").  The extension:
//   1. Runs alphabet-soup autocomplete (seed a … seed z + a seed … z seed)
//      to discover every related long-tail phrase Amazon shoppers search for.
//   2. Scrapes the Amazon SERP for the seed + every discovered phrase.
//   3. Auto-enriches each hit (product pages → BSR, pub date, brand).
//   4. The Niche Finder tab shows only keywords passing:
//        - total results  ≤ 1 000 (US) or ≤ 800 (other markets)
//        - overall BSR    ≤ 200 000
//        - not brand-blocked
//        - KDP-publishable content type
// ---------------------------------------------------------------------------

async function handleResearchFormat(seed, marketCode) {
  const settings = await getSettings();
  const epoch = scrapeQueue.epoch; // Start-Over guard: abandon the enqueue on reset
  const market = getMarket(marketCode || settings.market);
  const thresholds = settingsToThresholds(settings);
  const keyword = (seed || '').trim();
  if (!keyword) throw new Error('Enter a keyword to research.');

  broadcastPipeline('serp', `Researching "${keyword}" — running alphabet-soup expansion…`);

  // ── Step 1: Alphabet-soup autocomplete to discover long-tail phrases ────
  const corpus = await collectAutocompleteCorpus(keyword, market.code, settings)
    .catch(() => ({ amazon: [], google: [] }));

  // Extract unique keyword phrases from the autocomplete corpus.
  const rawPhrases = [...corpus.amazon, ...corpus.google]
    .map((e) => (e && typeof e === 'object' ? e.term : e))
    .filter(Boolean)
    .map((t) => String(t).trim().toLowerCase());

  // Deduplicate: keep the seed itself + every unique autocomplete phrase.
  const allPhrases = [keyword.toLowerCase(), ...rawPhrases];
  const uniquePhrases = [...new Set(allPhrases)].filter(Boolean);

  broadcastPipeline('serp', `Found ${uniquePhrases.length} keyword phrases from autocomplete for "${keyword}".`);

  // ── Step 2: Queue SERP scrapes for seed + all discovered phrases ────────
  const settingsFmt = settings.formatFilter || null;
  if (epoch !== scrapeQueue.epoch) {
    return { keyword, phrasesFound: uniquePhrases.length, tasksQueued: 0, corpus: { amazon: corpus.amazon.length, google: corpus.google.length }, aborted: true };
  }
  const tasks = uniquePhrases.map((phrase) => ({
    keyword: phrase,
    market: market.code,
    scrapedPages: settings.scrapedPages || 1,
    formatFilter: settingsFmt
  }));

  scrapeQueue.enqueueMany(tasks);

  broadcastPipeline('serp', `Queued ${tasks.length} SERP scrapes for "${keyword}" research.`);

  // ── Step 3: Return summary to dashboard ─────────────────────────────────
  return {
    keyword,
    phrasesFound: uniquePhrases.length,
    tasksQueued: tasks.length,
    corpus: {
      amazon: corpus.amazon.length,
      google: corpus.google.length
    }
  };
}

async function expandFromSuggestions(marketCode) {
  const settings = await getSettings();
  const epoch = scrapeQueue.epoch; // Start-Over guard: abandon the put/enqueue on reset
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
      const scored = scoreKeyword(s.keyword, {}, { longTail: true, thresholds, market: market.code });
      const allowFiction = settings.allowNicheFiction === true;
      const scope = settings.contentScope || 'rule8';
      const ct = classifyContentType({ keyword: s.keyword, allowFiction, scope });
      if (ct.contentType === 'high-content-excluded' || ct.requiresExpertise) return null;
      if ((scope === 'strict' || scope === 'rule8') && ct.contentType === 'unknown') return null;
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
      qualifies: computeSuggestionQualifies(scored, thresholds, s.keyword, allowFiction, scope, market.code)
      };
    })
    .filter(Boolean);

  if (epoch !== scrapeQueue.epoch) return { count: 0, aborted: true };
  if (records.length) await putKeywords(records);
  enqueueScraping(records.map((r) => r.keyword), market.code);
  return { count: records.length };
}

// ---------------------------------------------------------------------------
// Scraping batch helpers
// ---------------------------------------------------------------------------

async function enqueueScraping(keywords, marketCode) {
  const settings = await getSettings();
  const tasks = keywords.map((keyword) => ({
    keyword,
    market: marketCode,
    scrapedPages: settings.scrapedPages || 1,
    formatFilter: settings.formatFilter || null
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
  if (!unscraped.length) return { count: 0 };
  // v6: keep each record's own market so a mixed-market workspace scrapes
  // every keyword against the right storefront.
  const byMarket = {};
  unscraped.forEach((k) => {
    const mc = k.market || filter.market || 'us';
    (byMarket[mc] = byMarket[mc] || []).push(k.keyword);
  });
  Object.entries(byMarket).forEach(([mc, keywords]) => enqueueScraping(keywords, mc));
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
      // Rules v1 (rule 1): new-releases pages surface books published within
      // the last ~90 days — the natural source for the <6-month freshness rule.
      { url: newReleasesUrl(market.code, node.id), label: 'new-releases', category: node.name, nodeId: node.id },
      { url: moversUrl(market.code, node.id), label: 'movers', category: node.name, nodeId: node.id },
      { url: bestsellersUrl(market.code, node.id), label: 'bestsellers', category: node.name, nodeId: node.id }
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
  const epoch = scrapeQueue.epoch; // Start-Over guard: abandon the put/enqueue on reset
  const market = getMarket(marketCode || settings.market);
  const thresholds = settingsToThresholds(settings);
  const count = Math.max(1, categoryCount || settings.discoveryCategoryCount || 8);
  const cap = Math.max(1, maxKeywords || settings.discoveryMaxKeywords || 12);

  if (discoveryState.active) {
    return { count: 0, inProgress: true, discovered: [] };
  }

  const candidates = surfaceDiscoveryNodeCandidates(marketCode, settings).slice(0, count * 3);
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
  // (3 sources per node since rules v1: new-releases + movers + bestsellers.)
  const start = Date.now();
  const timeoutMs = 10 * 60 * 1000;
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

  // Start-Over arrived mid-run (CLEAR_ALL flips active=false and bumps the
  // queue epoch): drop everything instead of re-populating a cleared workspace.
  if (epoch !== scrapeQueue.epoch) return { count: 0, discovered: [], aborted: true };

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
  // v6: dedupe on market+keyword so a niche already tracked in another market
  // still counts as a fresh discovery here.
  const existingSet = new Set(existing.map((k) => `${(k.market || 'us')}:${(k.keyword || '').toLowerCase()}`));
  const fresh = keywords.filter((k) => !existingSet.has(`${market.code}:${k.keyword.toLowerCase()}`));

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

  // Phase 1.5 / rules v1: drop keywords an indie can't publish before they
  // reach the batch scraper. rule8 scope keeps low-content + puzzle/coloring/
  // photography/sheet-music/manual/textbook/children's families.
  const scope = settings.contentScope || 'rule8';
  const freshWithCt = fresh.map((k) => ({ ...k, ct: classifyContentType({ keyword: k.keyword, scope }) }));
  const publishable =
    thresholds.contentTypeEnabled === false
      ? freshWithCt
      : freshWithCt.filter((k) => scopeAllows(k.ct, scope));
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
    const scored = scoreKeyword(k.keyword, { demandProxyScore }, { longTail: true, thresholds, market: market.code });
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
      qualifies: computeSuggestionQualifies(scored, thresholds, k.keyword, settings.allowNicheFiction === true, scope, market.code)
    };
  });

  if (epoch !== scrapeQueue.epoch) return { count: 0, discovered: [], aborted: true };
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

async function handleAnalyzeNiche(keyword, market) {
  const apiKey = await getApiKey();
  if (!apiKey && !await hasCustomAI()) throw new Error('Set an AI provider in Settings first (Gemini key, or Zen/OpenRouter with a free model).');

  const record = await getKeyword(keyword, market);
  if (!record) throw new Error(`No data saved for "${keyword}". Scrape it first.`);

  const analysis = await analyzeNiche({ apiKey, keyword, keywordRecord: record });
  await putAnalysis(keyword, analysis, record.market || market);
  return analysis;
}

async function handleCheckTrademark(keyword, market, markets) {
  const apiKey = await getApiKey();
  const record = await getKeyword(keyword, market).catch(() => null);
  const settings = await getSettings();
  const sweepMarkets = (markets && markets.length
    ? markets
    : (Array.isArray(settings.trademarkMarkets) && settings.trademarkMarkets.length
      ? settings.trademarkMarkets
      : DEFAULT_TRADEMARK_MARKETS)
  ).filter((mc) => TRADEMARK_REGISTRIES[mc]);

  const scan = (apiKey || await hasCustomAI())
    ? await checkTrademark({ apiKey, keyword, keywordRecord: record || {}, markets: sweepMarkets })
    : await localTrademarkSweep(keyword, record || {}, sweepMarkets);

  // Rules v1 (rule 5): attach registry deep links for every market.
  scan.registryLookups = buildRegistryLookups(keyword, sweepMarkets);

  await putLegal(keyword, scan, record?.market || market);
  return scan;
}

async function handleGenerateListing(keyword, niche, market) {
  const apiKey = await getApiKey();
  if (!apiKey && !await hasCustomAI()) throw new Error('Set an AI provider in Settings first (Gemini key, or Zen/OpenRouter with a free model).');

  const record = await getKeyword(keyword, market);
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