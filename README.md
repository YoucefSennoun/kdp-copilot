# KDP Copilot — v0.8.8

A Chrome extension (Manifest V3) that turns Amazon KDP keyword research into a **scored, rules-driven workflow**.
It injects a Productor-style research panel into Amazon search results, qualifies niches with a
**rules-v1 engine** (fresh sellers, BSR, listing caps, brand screen, search-volume proof, trademark sweep,
Books-only + format filter, real-location results), expands seeds with **Gemini AI**, and keeps working
without an API key via live Amazon + Google autocomplete.

> Zero build step. Pure ES modules (MV3). No runtime dependencies.

---

## What v0.8.8 checks (rules-v1)

Every researched keyword is judged against 8 gates (`qualifies.all` must be true).
All thresholds are configurable in **Settings**:

| # | Gate | Rule |
|---|---|---|
| 1 | **Fresh + listings** | ≥ `freshHitsMin` (default 1) competitor that is **≤ 6 months old** *and* selling (overall Books BSR ≤ 200k), excluding branded books. Total Amazon results ≤ **1000 (US)** / **800 (every other market)** |
| 2 | **BSR** | Best overall Books BSR among enriched samples ≤ **200,000**. Optional sub-category BSR gate (default OFF, threshold 200) |
| 3 | **Brand filter** | Excludes niches led by big brands: licensed media / major publishers / stationery megabrands blocklist, **famous-author** list, and **author-frequency** detection (one author owns ≥3 books or ≥50% of the sample). Branded ASINs don't count as fresh hits |
| 4 | **Search-volume proof** | Full **A–Z alphabet-soup** autocomplete per market (Amazon per-market completion host + Google Suggest). Transparent **interest proxy 0–100** (default threshold 50) — honestly labeled, *not* a monthly-search number. Strict option: the keyword itself must appear in autocomplete |
| 5 | **Trademark sweep** | Gemini AI per-market sweep + keyless local famous-marks screen (global + per-market lists) + **official registry deep links per market** (USPTO, UKIPO, EUIPO, CIPO, J-PlatPat, IP Australia, IMPI, INPI BR, EUIPO/BOIP/PRV/UPRP, IP India, TÜRKPATENT, SAIP, UAE, IPOS, EGYPO) + **Marcaria aggregator**, Class 16 hint, and a copyright-originality note |
| 6 | **Books-only + format** | Every search forced to `i=stripbooks`. Optional format filter (Kindle / paperback / hardcover, default min 50% share) |
| 7 | **Real location + FBA check** | Market capital ZIP auto-pinned via Amazon's address-change endpoint (no manual work). **FBA/Amazon-retail share flagged**, with a **MyResearchBase** deep link to isolate the KDP pool |
| 8 | **Publishable content** | Scope `rule8` (default): Low-Content families **plus** puzzle books, coloring books, photography, sheet music, manuals, textbooks, children's books. `strict` = blank-interior only. `standard` = rule8 + guides + narrow fiction. Novels/fiction prose, memoirs, writer-craft books, and expertise-required works are excluded |

### Reading the score

| Metric | What it measures |
|---|---|
| **Score** (0–100) | Demand × 0.45 + (1 − Competition) × 0.35 + Margin × 0.2, with a long-tail boost (×1.04 for 3–4 words, ×1.08 for 5+) |
| **Demand** | Total reviews 20%, BSR 30%, rating 10%, interest proxy 40% |
| **Competition** | True result count 30%, total reviews 25%, top-review concentration (≥300-review share) 25%, price 10%, ads 10% |
| **Margin** | Price headroom 50%, low competition 35%, Kindle share 15% |
| **Confidence** | % of the 5 required signals actually present (+ BSR-coverage bonus) |
| **Verdict** | Excellent ≥ 75 · Promising ≥ 60 · Competitive ≥ 40 · Hard < 40 |
| **Est. sales** | `⌊120000 / medianBSR × 0.62⌋` books/month heuristic |

---

## Features

- **Live research panel** on Amazon search results — opportunity score ring, demand /
  competition / margin / confidence bars, estimated monthly sales, top competitors,
  brand ⚠ badges, FBA share, format shares, registry + MyResearchBase links.
- **20 marketplaces** (each with its capital ZIP for realistic domestic results):
  US (New York 10001), UK (London), DE (Berlin), FR (Paris), IT (Rome), ES (Madrid),
  CA (Ottawa), JP (Tokyo), AU (Sydney), MX (Mexico City), BR (Brasília), IN (New Delhi),
  NL (Amsterdam), SE (Stockholm), PL (Warsaw), TR (Ankara), SA (Riyadh), AE (Dubai),
  SG (Singapore), EG (Cairo).
- **Serialized scrape queue**: one Amazon tab at a time (rate-limited, timeout-guarded,
  max 200 tasks), with persisted **pause/resume** that survives service-worker restarts.
- **BSR enrichment**: visits the top-N product pages per shortlisted keyword (default top 8,
  score ≥ 50, skipped when results > 3000) for real overall/sub-category BSR, categories,
  and locale-aware publication dates (EN/DE/FR/IT/ES/PT/JA + ISO).
- **Gemini AI or free alternatives (Settings → AI Provider):**
  - Google Gemini direct (default, needs a [Gemini API key](https://aistudio.google.com/apikey)).
  - OpenAI-compatible provider, defaulting to **OpenRouter** with the free
    `xiaomi/mimo-v2-flash:free` (key from `openrouter.ai/keys`). Any other
    OpenAI-compatible endpoint works too; the model field accepts any id.
    Note: OpenCode Zen's free models only answer inside the OpenCode app itself —
    from this extension they need paid Zen credit.
  - All four AI features route through the selected provider:
  - `Expand` — seed → adjacent, producible book concepts (keyword, category, title idea, *why*),
    with existing-title + high-content rejection at generation time.
  - `Analyze Niche` — competitive read from your actual scraped SERP.
  - `Generate Listing Package` — title, subtitle, 7 backend keywords, bullets, description.
  - `Legal sweep` — multi-market trademark/copyright screen with a compliant alternative keyword.
  - Default model `gemini-3.6-flash` (live model list fetched when a key is set).
- **No-key fallback**: Amazon autocomplete + Google Suggest expansion, local trademark screen,
  and full scoring all work without a Gemini API key.
- **Dashboard**: Explorer (research + queue progress), Suggestions (+ graveyard), Niches
  (sortable table, detail drawer, CSV export, Scrub out-of-scope, Start Over reset),
  Discovery (Best Sellers / Movers & Shakers / New Releases, scheduled), Markets, Settings.
- **Keyboard shortcuts**: `Alt+Shift+1` researches the selected text on US, `Alt+Shift+3` on DE
  (UK / FR commands also available to bind in `chrome://extensions/shortcuts`).

---

## Install

1. Download `kdp-copilot-v0.8.8.zip` from the
   [Releases page](https://github.com/YoucefSennoun/kdp-copilot/releases) and unzip it.
2. Open `chrome://extensions`.
3. Enable **Developer mode** (top-right toggle).
4. Click **Load unpacked** and select the unzipped folder (the one containing `manifest.json`).
5. Optional: click the extension icon → **Settings** → paste your
   [Gemini API key](https://aistudio.google.com/apikey).

> Tip: it runs without a key, but add one to unlock AI expansion, niche analysis, listing kits,
> and the AI trademark sweep.

---

## Quick Start

1. Click the extension icon (or press a research shortcut with text selected).
2. In **Explorer**, enter a seed like `anxiety journal` and pick a market.
3. Click **Expand & Auto-Scrape** — suggestions appear with interest proxies, then the queue
   scrapes each Amazon SERP automatically (pause any time; progress survives restarts).
4. Sort **Niches** by **Score**, filter to ✅ qualified rows.
5. Click **Detail** for competitors / BSR samples / brand + FBA flags, **AI** for a Gemini read,
   **Legal** for the trademark sweep before you commit to a niche.

---

## How it works

```
Seed ──► EXPAND (Gemini AI  OR  Amazon+Google A–Z autocomplete)
               │
               ▼
      scored keyword records  ──►  SERP queue (1 Amazon tab at a time)
                                      │
                                      ▼
            BSR enrichment (top-N product pages: BSR, category, pub date)
                                      │
                                      ▼
        rules-v1 gates ──► stored in IndexedDB (id = market:keyword, v6)
                      │
                      └─► live research panel on the page
```

- **`src/content/serp-parser.js`** — parses Amazon search cards, pins the market ZIP, renders the panel.
- **`src/content/product-parser.js`** — product-page data (BSR + categories, formats, author, pub date…).
- **`src/content/discovery-parser.js`** — Best Sellers / Movers & Shakers / New Releases cards.
- **`src/background/index.js`** — message router, A–Z autocomplete fetchers, orchestration.
- **`src/background/scrape-queue.js`** — serialized tab scraper with timeout + tab cleanup + persisted pause.
- **`src/background/ai.js`** — Gemini calls + keyless `localExpandSuggestions` fallback.
- **`src/background/discovery.js`** — title → keyword cleaning for discovery runs.
- **`src/lib/scoring.js`** — scoring engine, sales estimates, verdicts, rules-v1 `computeQualifies`.
- **`src/lib/markets.js`** — 20 marketplaces, Books-only search + per-market autocomplete URLs, ZIP pinning, MyResearchBase links.
- **`src/lib/content-type.js`** — KDP-publishable classifier (`rule8` / `strict` / `standard`).
- **`src/lib/brands.js`** — brand blocklist + famous authors + author-frequency detection.
- **`src/lib/trademark-registry.js`** — official registry directory + Marcaria aggregator + local screen.
- **`src/lib/proxy.js`** — transparent interest-proxy composite (NOT monthly search volume).
- **`src/lib/dates.js`** — locale-aware publication-date parser for the 6-month freshness rule.
- **`src/lib/storage.js`** — IndexedDB stores + settings wrapper (DB v6, market-qualified ids).
- **`src/dashboard/`** — Explorer, Suggestions, Niches, Markets, Settings views.

---

## Security

- Your Gemini API key is stored **only** in `chrome.storage.local` — never in the repo, never
  transmitted anywhere but Google's API.
- This project has **no telemetry** and makes no third-party network calls beyond Amazon
  (search + per-market autocomplete + delivery-location endpoint),
  Google Suggest, MyResearchBase deep links, official trademark-registry links,
  and the Gemini endpoint.

---

## Development

Reload from source instead of the ZIP: clone the repo and **Load unpacked** the project root.
No install/build step is required.

Unit tests cover the pure data layer (scoring, gates, proxy, content-type, brands,
trademark directory, markets, dates, discovery):

```bash
node tests/run-tests.mjs
node tests/check-imports.cjs
node tests/check-ids.cjs
```

---

## Disclaimer

For personal research and education. Respect Amazon's terms of service and rate limits —
the scraper intentionally runs one tab at a time with delays. Trademark screens are
informational, not legal advice — verify with the official registries and a qualified
attorney before publishing. KDP Copilot is not affiliated with Amazon or Google.
