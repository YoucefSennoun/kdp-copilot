import { scoreKeyword, preprocessMetrics } from '../lib/scoring.js';
import { marketFromDomain, getMarket, searchUrl, autocompleteUrl, googleSuggestUrl } from '../lib/markets.js';
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
  getSettings,
  saveSettings
} from '../lib/storage.js';
import { scrapeQueue } from './scrape-queue.js';
import {
  expandNicheSeeds,
  analyzeNiche,
  generateListing,
  localExpandSuggestions,
  getApiKey
} from './ai.js';

const DASHBOARD_URL = 'src/dashboard/index.html';

chrome.runtime.onInstalled.addListener(() => {
  pruneSuggestions().catch(() => {});
  console.log('[KDP Copilot] Installed.');
});

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
// Scrape handler: opens exactly one Amazon tab per keyword
// ---------------------------------------------------------------------------

scrapeQueue.setHandler(async (task) => {
  return await _openScrapeTab(task);
});

async function _openScrapeTab(task) {
  const market = getMarket(task.market || 'us');
  const params = {};
  if (task.scrapedPages && task.scrapedPages > 1) {
    params.page = task.scrapedPages;
  }
  const url = task.url || searchUrl(market.code, task.keyword, params);
  return await new Promise((resolve, reject) => {
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
  switch (message.type) {
    // Content-script data in
    case 'SERP_PARSED':
      return handleSerpParsed(message.payload, sender);
    case 'PRODUCT_PARSED':
      return handleProductParsed(message.payload);

    // Keyword CRUD
    case 'GET_KEYWORDS':
      return getAllKeywords();
    case 'GET_KEYWORD':
      return getKeyword(message.keyword);
    case 'DELETE_KEYWORD':
      return deleteKeyword(message.keyword);
    case 'CLEAR_KEYWORDS':
      return clearKeywords();
    case 'CLEAR_ALL':
      scrapeQueue.abort();
      await clearKeywords();
      await clearSuggestions();
      await clearAnalyses();
      return true;

    // Suggestions (Amazon + Google autocomplete)
    case 'GET_SUGGESTIONS':
      return getAllSuggestions();
    case 'CLEAR_SUGGESTIONS':
      return clearSuggestions();
    case 'FETCH_SUGGESTIONS':
      return fetchSuggestions(message);
    case 'SAVE_SUGGESTIONS':
      return putSuggestions(message.suggestions || []);
    case 'EXPAND_FROM_SUGGESTIONS':
      return expandFromSuggestions(message.market);

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
        pending: scrapeQueue.pendingTabs?.size || 0
      };
    case 'PAUSE_QUEUE':
      scrapeQueue.stop();
      return true;
    case 'RESUME_QUEUE':
      scrapeQueue.resume();
      return true;

    // AI actions
    case 'ANALYZE_NICHE':
      return handleAnalyzeNiche(message.keyword);
    case 'GENERATE_LISTING':
      return handleGenerateListing(message.keyword, message.niche);

    // Settings / dashboard
    case 'GET_SETTINGS':
      return getSettings();
    case 'SAVE_SETTINGS':
      return saveSettings(message.settings);
    case 'OPEN_DASHBOARD':
      openDashboard();
      return true;

    default:
      throw new Error(`Unknown message type: ${message.type}`);
  }
}

// ---------------------------------------------------------------------------
// SERP ingestion
// ---------------------------------------------------------------------------

async function handleSerpParsed(payload, sender) {
  const { keyword, listings } = payload;

  if (sender.tab && sender.tab.id != null) {
    scrapeQueue.resolveTab(sender.tab.id, { keyword, count: listings.length });
  }

  if (!listings.length) {
    return { keyword, count: 0 };
  }

  const market = marketFromDomain(sender.tab && sender.tab.url ? new URL(sender.tab.url).hostname : payload.url);
  const metrics = preprocessForScoring(listings);
  const record = {
    keyword,
    market: market.code,
    url: payload.url,
    metrics,
    scrapedAt: Date.now(),
    scoredAt: new Date().toISOString()
  };

  const scored = scoreKeyword(keyword, metrics, { longTail: true });
  Object.assign(record, {
    score: scored.score,
    demand: scored.demand,
    competition: scored.competition,
    margin: scored.margin,
    confidence: scored.confidence,
    estimatedMonthlySales: scored.estimatedMonthlySales,
    verdict: scored.verdict
  });

  await putKeyword(record);
  return { keyword, count: listings.length, record };
}

function preprocessForScoring(listings) {
  return preprocessMetrics(listings);
}

async function handleProductParsed(payload) {
  const keyword = `dp/${payload.asin}`;
  const market = marketFromDomain(payload.url);
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
// Expansion (AI first, local autocomplete as fallback)
// ---------------------------------------------------------------------------

async function handleExpandSeed(seed, marketCode) {
  const settings = await getSettings();
  const market = getMarket(marketCode || settings.market);

  const apiKey = await getApiKey();

  let suggestions;
  if (apiKey) {
    suggestions = await expandNicheSeeds({
      apiKey,
      seed,
      market,
      count: 12
    });
  } else {
    suggestions = await localExpandFallback(seed, market, settings);
  }

  if (!suggestions.length) {
    throw new Error('No suggestions could be generated. Add a Gemini API key or retry with a clearer seed.');
  }

  const records = suggestions.map((s, i) => {
    const keyword = (s.keyword || s).trim();
    const scored = scoreKeyword(keyword, {}, { longTail: true });
    return {
      keyword,
      market: market.code,
      aiTitleIdea: s.titleIdea || null,
      aiCategory: s.category || null,
      aiRationale: s.why || null,
      source: s.source || 'gemini',
      expandedFrom: seed,
      metrics: {},
      sample: [],
      scrapedAt: Date.now(),
      scoredAt: new Date().toISOString(),
      score: scored.score,
      demand: scored.demand,
      competition: scored.competition,
      margin: scored.margin,
      confidence: scored.confidence,
      estimatedMonthlySales: null,
      verdict: scored.verdict
    };
  });

  if (settings.autocompleteEnabled !== false) {
    const suggestionRows = suggestions
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

  return { keywords: records.map((r) => r.keyword), ai: suggestions, count: records.length };
}

async function localExpandFallback(seed, market, settings) {
  const amazonWords = [];
  const googleWords = [];

  if (settings.autocompleteEnabled !== false) {
    try {
      amazonWords.push(...await amazonAutocomplete(seed, market.code));
    } catch {}
  }
  if (settings.googleSuggestEnabled !== false) {
    try {
      googleWords.push(...await googleSuggest(seed, market.code));
    } catch {}
  }

  const words = await localExpandSuggestions({ amazonWords, googleWords, seed });
  return words;
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
  const res = await fetch(url, {
    headers: {
      'User-Agent':
        'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36'
    }
  });
  if (!res.ok) throw new Error(`Amazon suggest ${res.status}`);
  const data = await res.json();
  const words = (data.suggestions || [])
    .filter((s) => s && s.value)
    .map((s) => s.value);
  if (!words.length) throw new Error('Amazon suggest: empty');
  return words.slice(0, 11);
}

export async function googleSuggest(seed, marketCode) {
  const market = getMarket(marketCode);
  const url = googleSuggestUrl(seed, market.code);
  const res = await fetch(url, { headers: { 'X-Chrome-UMA-Enabled': '1' } });
  if (!res.ok) throw new Error(`Google suggest ${res.status}`);
  const data = await res.json();
  const words = Array.isArray(data) && Array.isArray(data[1]) ? data[1] : [];
  if (!words.length) throw new Error('Google suggest: empty');
  return words.slice(0, 20);
}

async function expandFromSuggestions(marketCode) {
  const settings = await getSettings();
  const market = getMarket(marketCode || settings.market);
  const all = await getAllSuggestions();
  const unique = Object.values(
    all.reduce((acc, s) => {
      if (s.keyword) acc[s.keyword] = s;
      return acc;
    }, {})
  );

  const records = unique.map((s) => {
    const scored = scoreKeyword(s.keyword, {}, { longTail: true });
    return {
      keyword: s.keyword,
      market: market.code,
      source: s.source || 'unknown',
      expandedFrom: s.expandedFrom || null,
      metrics: {},
      sample: [],
      scrapedAt: Date.now(),
      scoredAt: new Date().toISOString(),
      score: scored.score,
      demand: scored.demand,
      competition: scored.competition,
      margin: scored.margin,
      confidence: scored.confidence,
      estimatedMonthlySales: null,
      verdict: scored.verdict
    };
  });

  if (records.length) await putKeywords(records);
  enqueueScraping(records.map((r) => r.keyword), market.code);
  return { count: records.length };
}

// ---------------------------------------------------------------------------
// Scraping batch helpers
// ---------------------------------------------------------------------------

function enqueueScraping(keywords, marketCode) {
  const settings = getSettings().then(({ scrapedPages }) => {
    const tasks = keywords.map((keyword) => ({
      keyword,
      market: marketCode,
      scrapedPages: scrapedPages || 1
    }));
    scrapeQueue.enqueueMany(tasks);
  });
  return settings;
}

async function scrapeOne({ keyword, market }) {
  enqueueScraping([keyword], market || (await getSettings()).market);
  return true;
}

async function scrapeAll(filter = {}) {
  const all = await getAllKeywords();
  const unscraped = all.filter((k) => {
    if (k.keyword && k.keyword.startsWith('dp/')) return false; // product records are not search terms
    const hasSample = (k.metrics && (k.metrics.listingCount || k.metrics.sample || []).length);
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