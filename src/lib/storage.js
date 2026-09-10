const DB_NAME = 'kdp-copilot';
const DB_VERSION = 6;

import { classifyContentType, scopeAllows } from './content-type.js';

const STORES = {
  keywords: { keyPath: 'id' },            // v6: id = "{market}:{keyword}"
  suggestions: { keyPath: 'id' },
  analyses: { keyPath: 'id' },            // v6: id = "{market}:{keyword}"
  legals: { keyPath: 'id' },             // v6: id = "{market}:{keyword}"
  scrapes: { keyPath: 'id', autoIncrement: true },
  discoveries: { keyPath: 'id', autoIncrement: true }
};

let dbPromise = null;

/** Canonical record id: market-qualified so the same keyword can be researched
 *  in multiple marketplaces without clobbering (rules v1, B1 fix). */
export function keywordId(keyword, market = 'us') {
  const m = (market || 'us').toLowerCase();
  return `${m}:${String(keyword || '').trim()}`;
}

function migrateLegacyRecord(storeName, rec) {
  if (!rec || rec.id) return rec;
  return { ...rec, id: keywordId(rec.keyword, rec.market) };
}

export function openDB() {
  if (dbPromise) return dbPromise;

  dbPromise = new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, DB_VERSION);

    request.onupgradeneeded = (event) => {
      const db = event.target.result;
      const tx = event.target.transaction;

      // Create any missing store with its FINAL schema.
      Object.entries(STORES).forEach(([name, opts]) => {
        if (!db.objectStoreNames.contains(name)) {
          db.createObjectStore(name, { ...opts });
        }
      });

      // --- v6 migration: keyword-keyed stores → id-keyed, one transaction ---
      // A store's keyPath cannot be changed in place, so for each legacy store
      // (keyPath 'keyword') we: create a temp id-keyed store, cursor-copy the
      // records with their new market-qualified id, and when the cursor
      // drains, delete the old store and rename the temp into place. All
      // inside this same versionchange transaction — the captured `tmp`
      // store reference stays valid across the rename.
      const LEGACY = { keywords: 'keywords_v6', analyses: 'analyses_v6', legals: 'legals_v6' };
      Object.entries(LEGACY).forEach(([name, tmpName]) => {
        const oldStore =
          db.objectStoreNames.contains(name) && !db.objectStoreNames.contains(tmpName)
            ? tx.objectStore(name)
            : null;
        if (!oldStore) return;
        if (!oldStore.keyPath || oldStore.keyPath === 'id') return;

        const tmp = db.createObjectStore(tmpName, { keyPath: 'id' });
        const cursorReq = oldStore.openCursor();
        cursorReq.onsuccess = () => {
          const cursor = cursorReq.result;
          if (cursor) {
            const migrated = migrateLegacyRecord(name, cursor.value);
            if (migrated && migrated.id) tmp.put(migrated);
            cursor.continue();
          } else {
            // Cursor drained: swap the temp store into the final name.
            db.deleteObjectStore(name);
            tmp.name = name;
          }
        };
        cursorReq.onerror = () => {
          // Migration failed: keep the legacy store readable rather than
          // aborting the whole upgrade.
          console.warn('[KDP Copilot] record migration for', name, 'failed:', cursorReq.error);
        };
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

// ---- Keywords (v6: market-qualified id) ----

export async function putKeyword(record) {
  if (!record.id) record.id = keywordId(record.keyword, record.market);
  return withStore('keywords', 'readwrite', (store) => store.put(record));
}

export async function putKeywords(records) {
  return withTx('keywords', 'readwrite', (store) =>
    records.forEach((r) => {
      if (!r.id) r.id = keywordId(r.keyword, r.market);
      store.put(r);
    })
  );
}

/** v6: get by (keyword, market). A bare keyword with no market falls back to
 *  the legacy single-record lookup first (any market), then to 'us'. */
export async function getKeyword(keyword, market) {
  const direct = await withStore('keywords', 'readonly', (store) =>
    store.get(keywordId(keyword, market || 'us'))
  );
  if (direct) return direct;
  if (market) return null;
  const all = await getAllKeywords();
  return all.find((k) => k.keyword === keyword) || null;
}

export async function getAllKeywords() {
  return withStore('keywords', 'readonly', (store) => store.getAll());
}

export async function getKeywordsByMarket(marketCode) {
  const all = await getAllKeywords();
  return all.filter((k) => k.market === marketCode);
}

export async function deleteKeyword(keyword, market) {
  return withTx('keywords', 'readwrite', (store) =>
    store.delete(keywordId(keyword, market || 'us'))
  );
}

export async function clearKeywords() {
  return withTx('keywords', 'readwrite', (store) => store.clear());
}

/** Delete every stored keyword that fails the given content scope.
 *  'strict' keeps only Amazon "generally low-content" families;
 *  'rule8' keeps those plus puzzle/coloring/photography/sheet-music/manual/
 *  textbook/children's (the rules-v1 "Not Generally Low-Content" list);
 *  'standard' keeps anything not explicitly high-content-excluded. */
export async function purgeOutsideScope(scope = 'rule8') {
  const all = await getAllKeywords();
  const doomed = [];
  for (const rec of all) {
    if ((rec.keyword || '').startsWith('dp/')) continue;
    const ct = classifyContentType({ keyword: rec.keyword || '', scope });
    const ok = scopeAllows(ct, scope);
    if (!ok) doomed.push(rec.id);
  }
  for (const id of doomed) await withTx('keywords', 'readwrite', (store) => store.delete(id));
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

// ---- AI analyses (v6: market-qualified id) ----

export async function putAnalysis(keyword, analysis, market) {
  const id = keywordId(keyword, market || analysis?.market || 'us');
  return withStore('analyses', 'readwrite', (store) =>
    store.put({ id, keyword, market: market || analysis?.market || 'us', analyzedAt: Date.now(), ...analysis })
  );
}

export async function getAnalysis(keyword, market) {
  return withStore('analyses', 'readonly', (store) => store.get(keywordId(keyword, market || 'us')));
}

export async function clearAnalyses() {
  return withTx('analyses', 'readwrite', (store) => store.clear());
}

// ---- Trademark / copyright screens (v6: market-qualified id) ----

export async function putLegal(keyword, legal, market) {
  const id = keywordId(keyword, market || legal?.market || 'us');
  return withStore('legals', 'readwrite', (store) =>
    store.put({ id, keyword, market: market || legal?.market || 'us', checkedAt: Date.now(), ...legal })
  );
}

export async function getLegal(keyword, market) {
  return withStore('legals', 'readonly', (store) => store.get(keywordId(keyword, market || 'us')));
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

// ---- Settings (rules v1) ----

export const DEFAULT_SETTINGS = {
  apiKey: '',
  model: 'gemini-3.6-flash',
  aiProvider: 'gemini', // 'gemini' | 'custom' (OpenCode Zen / OpenRouter / …)
  customBaseUrl: 'https://opencode.ai/zen/v1',
  customApiKey: '',
  customModel: 'big-pickle',
  market: 'us',
  autocompleteEnabled: true,
  googleSuggestEnabled: true,
  scrapedPages: 1,
  panelVisible: true,
  panelEnabled: true,
  panelAutoAnalyze: false,

  // Niche qualification thresholds — rules v1 (§ rules for niche research.txt)
  bsrThreshold: 200,            // optional ADVANCED gate: best sub-category BSR (default OFF via subBsrEnabled)
  subBsrEnabled: false,         // v0.7: overall-BSR rule replaces sub-category gate by default
  overallBsrMax: 200000,        // rule 2: overall Books BSR must be <= this (default ON)
  overallBsrEnabled: true,
  usListingsMax: 1000,          // rule 1: US market result-count cap
  otherListingsMax: 800,        // rule 1: every non-US market result-count cap
  maxBookAgeMonths: 6,          // rule 1: competitor books must be newer than this
  freshHitsMin: 1,              // rule 1+2: min # of new (<=6mo) AND selling (BSR<=200k) AND unbranded competitors
  brandFilterEnabled: true,     // rule 3: exclude niches whose sample carries a big-brand book
  volumeThreshold: 50,          // rule 4: interest proxy (0-100) must be >= this
  keywordSuggestedRequired: false, // rule 4 (strict mode): keyword itself must appear in autocomplete
  contentTypeEnabled: true,     // KDP-publishable content filter
  contentScope: 'rule8',        // 'rule8' = Low-Content + Not-Generally-Low-Content (rules v1); legacy: 'strict' | 'standard'
  allowNicheFiction: false,     // narrow fiction niches — only relevant in 'standard' scope

  // Format filter (rule 6): null = all formats; 'kindle' | 'paperback' | 'hardcover'
  formatFilter: null,
  minFormatShare: 0.5,

  // Trademark sweep markets (rule 5, v0.8): default = every marketplace
  // registry (20 storefronts + Marcaria aggregator attached to each report).
  trademarkMarkets: ['us', 'uk', 'fr', 'de', 'it', 'es', 'ca', 'jp', 'au', 'mx', 'br', 'in', 'nl', 'se', 'pl', 'tr', 'sa', 'ae', 'sg', 'eg'],

  // BSR enrichment pipeline
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
      // Normalize legacy scope values: v0.6 'strict' upgrades to the rules-v1
      // 'rule8' scope unless the user explicitly re-saves a legacy choice.
      if (merged.contentScope === 'strict') merged.contentScope = 'rule8';
      // Normalize formatFilter.
      if (!['kindle', 'paperback', 'hardcover'].includes(merged.formatFilter)) {
        merged.formatFilter = null;
      }
      // Normalize AI provider selection.
      if (!['gemini', 'custom'].includes(merged.aiProvider)) {
        merged.aiProvider = 'gemini';
      }
      if (!merged.customBaseUrl) merged.customBaseUrl = DEFAULT_SETTINGS.customBaseUrl;
      if (!merged.customModel) merged.customModel = DEFAULT_SETTINGS.customModel;
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
