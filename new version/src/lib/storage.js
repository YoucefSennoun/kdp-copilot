const DB_NAME = 'kdp-copilot';
const DB_VERSION = 5;

import { classifyContentType, scopeAllows } from './content-type.js';

const STORES = {
  keywords: { keyPath: 'keyword' },
  suggestions: { keyPath: 'id' },
  analyses: { keyPath: 'keyword' },
  legals: { keyPath: 'keyword' },
  scrapes: { keyPath: 'id', autoIncrement: true },
  discoveries: { keyPath: 'id', autoIncrement: true }
};

let dbPromise = null;

export function openDB() {
  if (dbPromise) return dbPromise;

  dbPromise = new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, DB_VERSION);

    request.onupgradeneeded = (event) => {
      const db = event.target.result;
      Object.entries(STORES).forEach(([name, opts]) => {
        if (!db.objectStoreNames.contains(name)) {
          db.createObjectStore(name, { ...opts });
        }
      });
    };

    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });

  return dbPromise;
}

async function withStore(storeName, mode, fn) {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(storeName, mode);
    const store = tx.objectStore(storeName);
    const request = fn(store);
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

async function withTx(storeName, mode, fn) {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(storeName, mode);
    const store = tx.objectStore(storeName);
    fn(store);
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
}

// ---- Keywords ----

export async function putKeyword(record) {
  return withStore('keywords', 'readwrite', (store) => store.put(record));
}

export async function putKeywords(records) {
  return withTx('keywords', 'readwrite', (store) => records.forEach((r) => store.put(r)));
}

export async function getKeyword(keyword) {
  return withStore('keywords', 'readonly', (store) => store.get(keyword));
}

export async function getAllKeywords() {
  return withStore('keywords', 'readonly', (store) => store.getAll());
}

export async function getKeywordsByMarket(marketCode) {
  const all = await getAllKeywords();
  return all.filter((k) => k.market === marketCode);
}

export async function deleteKeyword(keyword) {
  return withTx('keywords', 'readwrite', (store) => store.delete(keyword));
}

export async function clearKeywords() {
  return withTx('keywords', 'readwrite', (store) => store.clear());
}

// Physical cleanup: delete every stored keyword that fails the given content
// scope. 'strict' keeps only Amazon "generally low-content" families; the
// standard scope keeps anything not explicitly high-content-excluded.
export async function purgeOutsideScope(scope = 'strict') {
  const all = await getAllKeywords();
  const doomed = [];
  for (const rec of all) {
    if ((rec.keyword || '').startsWith('dp/')) continue;
    const ct = classifyContentType({ keyword: rec.keyword || '', scope });
    const ok = scopeAllows(ct, scope);
    if (!ok) doomed.push(rec.keyword);
  }
  for (const keyword of doomed) await deleteKeyword(keyword);
  return { removed: doomed.length, scanned: all.length };
}

// ---- Suggestions (Amazon + Google autocomplete, alphabet soup) ----

const SUGGESTION_TTL = 1000 * 60 * 60 * 24 * 14; // 14 days

export async function putSuggestion(id, data) {
  return withStore('suggestions', 'readwrite', (store) =>
    store.put({ id, createdAt: Date.now(), ...data })
  );
}

export async function putSuggestions(list) {
  return withTx('suggestions', 'readwrite', (store) =>
    list.forEach((r) => store.put({ id: r.id, createdAt: Date.now(), ...r }))
  );
}

export async function getSuggestion(id) {
  return withStore('suggestions', 'readonly', (store) => store.get(id));
}

export async function getAllSuggestions() {
  return withStore('suggestions', 'readonly', (store) => store.getAll());
}

export async function clearSuggestionById(id) {
  return withTx('suggestions', 'readwrite', (store) => store.delete(id));
}

export async function clearSuggestions() {
  return withTx('suggestions', 'readwrite', (store) => store.clear());
}

export async function pruneSuggestions() {
  const all = await getAllSuggestions();
  const stale = all.filter((s) => Date.now() - (s.createdAt || 0) > SUGGESTION_TTL);
  if (stale.length) {
    await withTx('suggestions', 'readwrite', (store) =>
      stale.forEach((s) => store.delete(s.id))
    );
  }
  return stale.length;
}

// ---- AI analyses ----

export async function putAnalysis(keyword, analysis) {
  return withStore('analyses', 'readwrite', (store) =>
    store.put({ keyword, analyzedAt: Date.now(), ...analysis })
  );
}

export async function getAnalysis(keyword) {
  return withStore('analyses', 'readonly', (store) => store.get(keyword));
}

export async function clearAnalyses() {
  return withTx('analyses', 'readwrite', (store) => store.clear());
}

// ---- Trademark / copyright screens ----

export async function putLegal(keyword, legal) {
  return withStore('legals', 'readwrite', (store) =>
    store.put({ keyword, checkedAt: Date.now(), ...legal })
  );
}

export async function getLegal(keyword) {
  return withStore('legals', 'readonly', (store) => store.get(keyword));
}

export async function getAllLegals() {
  return withStore('legals', 'readonly', (store) => store.getAll());
}

export async function clearLegals() {
  return withTx('legals', 'readwrite', (store) => store.clear());
}

// ---- Scrape history (review-growth velocity snapshots, Phase 3b) ----

export async function addScrape(record) {
  return withStore('scrapes', 'readwrite', (store) => store.add(record));
}

export async function getScrapeSnapshots(keyword) {
  const all = await withStore('scrapes', 'readonly', (store) => store.getAll());
  return all
    .filter((s) => s.keyword === keyword)
    .sort((a, b) => (a.scrapedAt || 0) - (b.scrapedAt || 0));
}

// ---- Discovery runs (Phase 4 history) ----

export async function addDiscoveryRun(record) {
  return withStore('discoveries', 'readwrite', (store) =>
    store.add({ ranAt: Date.now(), ...record })
  );
}

export async function getDiscoveryRuns() {
  const all = await withStore('discoveries', 'readonly', (store) => store.getAll());
  return all.sort((a, b) => (b.ranAt || 0) - (a.ranAt || 0));
}

export async function clearDiscoveryRuns() {
  return withTx('discoveries', 'readwrite', (store) => store.clear());
}

// ---- Settings ----

export const DEFAULT_SETTINGS = {
  apiKey: '',
  model: 'gemini-3.6-flash',
  market: 'us',
  autocompleteEnabled: true,
  googleSuggestEnabled: true,
  scrapedPages: 1,
  panelVisible: true,
  panelAutoAnalyze: false,

  // Niche qualification thresholds (§3 / Phase 5)
  bsrThreshold: 200,            // best sub-category BSR must be <= this
  listingsThreshold: 1000,      // true Amazon total result count must be <= this
  volumeThreshold: 50,          // demandProxyScore (0-100) must be >= this
  contentTypeEnabled: true,     // KDP-publishable content filter (Phase 1.5)
  contentScope: 'strict',       // 'strict' = Amazon "generally low-content" only (blank interiors); 'standard' = + coloring/puzzle/workbook/guides (v0.6)
  allowNicheFiction: false,     // specific long-tail fiction niches — only relevant in 'standard' scope

  // BSR enrichment pipeline (Phase 2)
  enrichmentEnabled: true,
  enrichmentSampleSize: 8,      // top N listings visited per shortlisted keyword
  enrichmentMinScore: 50,       // only keywords scoring >= this get enriched
  enrichmentCeiling: 3000,      // skip enrichment when total results exceed this

  // Discovery Mode (Phase 4)
  discoveryEnabled: false,
  discoveryIntervalMinutes: 1440,
  discoveryCategoryCount: 8,
  discoveryMaxKeywords: 12
};

export async function getSettings() {
  return new Promise((resolve) => {
    chrome.storage.local.get(['kdpSettings'], (result) => {
      const stored = result.kdpSettings || {};
      const merged = { ...DEFAULT_SETTINGS, ...stored };
      // Drop deprecated model IDs saved by older builds.
      if (/^gemini-[12]\.\d/.test(merged.model || '')) {
        merged.model = DEFAULT_SETTINGS.model;
      }
      resolve(merged);
    });
  });
}

export async function saveSettings(settings) {
  const current = await getSettings();
  const merged = { ...current, ...settings };
  return new Promise((resolve) => {
    chrome.storage.local.set({ kdpSettings: merged }, resolve);
  });
}