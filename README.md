# KDP Copilot

A Chrome extension that turns Amazon KDP keyword research into a **scored, AI-assisted workflow**.
It injects a Productor-style research panel into Amazon search results, ranks niches with a
BSR-aware scoring engine, expands seed ideas with **Gemini AI**, and keeps working even without
an API key via live Amazon + Google autocomplete.

> Zero build step. Pure ES modules (MV3). No runtime dependencies.

---

## Features

- **Live research panel** on Amazon search results — big opportunity score ring, demand /
  competition / margin / confidence bars, estimated monthly sales, top-5 competitor list.
- **Multi-marketplace**: US, UK, DE, FR, IT, ES, CA, JP, AU, MX, BR.
- **Auto-scraping batch engine**: expands a seed into keywords, then visits each Amazon search
  page one at a time (rate-limited, timeout-guarded) and scores every result.
- **Gemini AI:**
  - `Expand` — turns a seed niche into adjacent, low-competition book concepts
    (keyword, category, title idea, *why* it's winnable).
  - `Analyze Niche` — reads your actual scraped SERP and returns a competitive read.
  - `Generate Listing Package` — title, subtitle, 7 backend keywords, bullets, description.
- **No-key fallback**: without a Gemini API key it expands via Amazon autocomplete +
  Google Suggest instead, so the tool is fully usable out of the box.
- **Dashboard** with sortable keyword table, per-niche detail drawer, suggestion graveyard,
  CSV export, queue progress, configurable model/settings.
- **Keyboard shortcuts** (`Alt+Shift+1` US, `Alt+Shift+3` DE, …) research the currently
  selected text as a seed.

---

## Install

1. Download the release ZIP (`kdp-copilot-vX.Y.Z.zip`) from the
   [Releases page](https://github.com/YoucefSennoun/kdp-copilot/releases) and unzip it.
2. Open `chrome://extensions`.
3. Enable **Developer mode** (top-right toggle).
4. Click **Load unpacked** and select the unzipped folder (the one containing `manifest.json`).
5. Optional: click the extension icon → **Settings** → paste your
   [Gemini API key](https://aistudio.google.com/apikey).

> Tip: it runs without a key, but add one to unlock the AI niche analysis and listing kit.

---

## Quick Start

1. Click the extension icon (or press a research shortcut with text selected).
2. In **Explorer**, enter a seed like `low carb cookbook` and pick a market.
3. Click **Expand & Auto-Scrape** — suggested niches appear, then get scraped automatically.
4. Watch the progress bar, then sort by **Score**.
5. Click **Detail** on any keyword to see competitors, or **AI** for a Gemini niche read.

### Reading the score

| Metric | What it measures |
|---|---|
| **Score** (0–100) | Demand × 0.45 + (1 − Competition) × 0.35 + Margin × 0.2, with a long-tail boost |
| **Demand** | Total reviews 40%, median BSR 40% (lower rank = more demand), rating 20% |
| **Competition** | Listing count 30%, total reviews 25%, **top-review concentration** 25%, price 10%, ads 10% |
| **Margin** | Price headroom 50%, low competition 35%, Kindle share 15% |
| **Confidence** | % of the 5 required signals actually present in the scraped data |
| **Verdict** | Excellent ≥ 75 · Promising ≥ 60 · Competitive ≥ 40 · Hard < 40 |
| **Est. sales** | `⌊120000 / medianBSR × 0.62⌋` books/month heuristic |

---

## How it works

```
Seed ──► EXPAND (Gemini AI  OR  Amazon+Google autocomplete)
              │
              ▼
      scored keyword records  ──►  auto-enqueue
                                     │
                     Scrape queue (1 Amazon tab at a time)
                                     │
                                     ▼
              SERP parser ──► metrics ──► scoring engine ──► stored in IndexedDB
                     │
                     └─► live research panel on the page
```

- **`src/content/serp-parser.js`** — parses Amazon search cards and renders the floating panel.
- **`src/content/product-parser.js`** — product page data (BSR + category, formats, author…).
- **`src/background/index.js`** — message router, autocomplete fetchers, batch orchestration.
- **`src/background/scrape-queue.js`** — serialized tab scraper with timeout + tab cleanup.
- **`src/background/ai.js`** — Gemini calls + keyless `localExpandSuggestions` fallback.
- **`src/lib/scoring.js`** — pure scoring engine / sales estimates / verdicts.
- **`src/lib/markets.js`** — 11 marketplaces, search + autocomplete URL builders.
- **`src/lib/storage.js`** — IndexedDB stores + settings wrapper.
- **`src/dashboard/`** — Explorer, Suggestions, Settings views.

---

## Security

- Your Gemini API key is stored **only** in `chrome.storage.local` — never in the repo, never
  transmitted anywhere but Google's API.
- This project has **no telemetry** and makes no third-party network calls beyond Amazon,
  Google Suggest, and the Gemini endpoint.

---

## Development

Reload from source instead of the ZIP: clone the repo and **Load unpacked** the project root.
No install/build step is required.

Integration tests live in the separate `kdp-copilot-tests` project (mirrors Chrome APIs with
`fake-indexeddb`):

```bash
cd kdp-copilot-tests && npm install && node test.mjs
```

---

## Disclaimer

For personal research and education. Respect Amazon's terms of service and rate limits —
the scraper intentionally runs one tab at a time with delays. KDP Copilot is not affiliated
with Amazon or Google.