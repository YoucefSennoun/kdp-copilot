# KDP Copilot — Master Plan (v2)

**Status: v0.2.0** — Productor-style research panel + Gemini AI ecosystem.

**Project Goal:** A single Manifest V3 Chrome Extension that ranks KDP book niches with a
Productor-for-MBA-grade research UI, feeds metrics through a BSR-aware scoring engine, expands
seed ideas via Gemini AI, and falls back to live Amazon + Google autocomplete when no API key is set.

---

## 1. Architecture Rules

1. **Single extension, zero build step.** Vanilla ES modules everywhere; content scripts are
   plain IIFEs (MV3 constraint). No bundler, no runtime deps. (`_integration/` is a Node-based
   test scaffold only — never referenced by the extension.)
2. **Full-tab dashboard.** No `default_popup`. Action icon opens/focuses the dashboard tab.
3. **Service worker is a module.** `"background": { "service_worker": "src/background/index.js", "type": "module" }`.

---

## 2. Directory Layout

```text
kdp-copilot/
├─ manifest.json
├─ src/
│  ├─ background/
│  │  ├─ index.js          # Router, commands, Amazon/Google suggest fetchers, AI orchestration
│  │  ├─ scrape-queue.js   # Serialized tab scraper: 1 tab at a time, timeout + tab cleanup
│  │  └─ ai.js             # Gemini API + keyless local autocomplete fallback
│  ├─ content/
│  │  ├─ serp-parser.js    # Amazon SERP parser + live research panel (Productor status bar)
│  │  ├─ serp-panel.css    # Panel styling
│  │  └─ product-parser.js # Product page: BSR + category, formats, publication data
│  ├─ dashboard/
│  │  ├─ index.html        # Explorer, Suggestions, Settings tabs
│  │  ├─ app.js            # Router + market selects + queue progress listener
│  │  └─ views/
│  │     ├─ explorer.js    # Keyword table, sort, detail/delete, batch, CSV export
│  │     ├─ detail.js      # Per-niche product sample + AI analyze / listing kit
│  │     ├─ suggestions.js # Amazon + Google autocomplete keyword graveyard
│  │     └─ settings.js    # API key, model, market, toggles, SERP pages
│  └─ lib/
│     ├─ markets.js        # 11 marketplaces, search URL, autocomplete URL builders
│     ├─ scoring.js        # Demand/Competition/Margin, BSR demand, top concentration,
│     │                    # estimated monthly sales, verdicts
│     └─ storage.js        # IndexedDB (keywords, suggestions, analyses) + settings wrapper
```

---

## 3. Manifest (`manifest.json`)

- **Content scripts:** SERP parser (+ CSS) runs on `/s*` across 10 Amazon marketplaces;
  product parser runs on `/dp/*` + `/gp/product/*`.
- **Host permissions:** all Amazon domains, `completion.amazon.com` (autocomplete),
  `suggestqueries.google.com` (suggest), `generativelanguage.googleapis.com` (Gemini).
- **Commands:** `Alt+Shift+1` research US, `Alt+Shift+3` DE, and UK/FR shortcuts — mirror
  Productor's research hotkeys. Each scrapes the current text selection as a seed.

---

## 4. Scoring Engine (`src/lib/scoring.js`)

| Signal | Input | Note |
|---|---|---|
| Demand (0.45) | total reviews 40%, **median BSR 40%**, avg rating 20% | lower BSR = higher demand |
| Competition (0.35) | listing count 30%, total reviews 25%, **top-review concentration 25%**, price 10%, ads 10% | concentration = % of top results with ≥300 reviews |
| Margin (0.2) | price headroom 50%, low competition 35%, **Kindle share 15%** | ebook = cheaper delivery |
| Confidence | fraction of 5 metric signals present | |
| Verdict | Excellent ≥75 / Promising ≥60 / Competitive ≥40 / Hard <40 | |
| Est. sales | `round(120000 / medianBSR * 0.62)` heuristic | Books-like BSR→units |

Long-tail boost: 3+ word keywords score slightly higher.

---

## 5. Research Panel (`src/content/serp-parser.js` + CSS)

Productor-style floating card injected into Amazon search results:

- Big score ring + verdict, Demand/Competition/Margin/Confidence bars.
- Facts row: result count, estimated monthly sales, Kindle share, sponsored count.
- Top-5 product mini-list (type badges + AD marker).
- **Analyze with AI** button → Gemini niche read rendered inline.
- Open dashboard button.

---

## 6. Expansion Flow (`src/background/index.js` + `ai.js`)

1. User enters seed → `EXPAND_SEED`.
2. If a Gemini API key exists → `expandNicheSeeds` returns structured niches
   (keyword, category, formats, why, title idea, demand signal) via `responseMimeType: JSON`.
3. If **no key** → live Amazon autocomplete + Google suggest are merged through
   `localExpandSuggestions` (seed-coherent long-tail filtering + commercial-intent ranking).
4. Every result is scored with `scanner v2` + stored + **auto-enqueued** for SERP scraping.
5. Suggestions tab stores the raw autocomplete graveyard; "Expand from all" scores them all.

AI actions (all keyed on `chrome.storage`):
- `ANALYZE_NICHE` — competitive read from the actual scraped SERP (angles, risks, pricing, entry).
- `GENERATE_LISTING` — title, subtitle, 7 backend keywords, bullets, description.

---

## 7. Scrape Queue (`src/background/scrape-queue.js`)

- Opens exactly **one** Amazon tab per keyword (`active: false`).
- The tab is resolved + closed when `SERP_PARSED` arrives; a 30s timeout closes orphans.
- 3.5s interval between kwets to stay under Amazon's radar; pause/resume, progress events broadcast
  to the dashboard tab live.

---

## 8. Integration Tests (`_integration/`)

`node _integration/test.mjs` boots the service worker with mocked Chrome APIs + fake-indexeddb
and verifies: settings, SERP ingestion → scoring → persistence, autocomplete fetchers, keyless
expansion, and queue enqueue.

---

## 9. Execution Directive for Agents

Default to **enhancing existing modules in place**; never reintroduce a build step or a second
store. When adding a feature, keep every message type documented in `src/background/index.js`'s
router and mirror the dashboard handler. Run the integration suite after any change to the
background/data path.