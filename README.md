# KDP Copilot — v0.8.15

A Chrome extension (Manifest V3) that turns Amazon KDP keyword research into a **scored, rules-driven workflow**.
It injects a research panel into Amazon search results, qualifies niches with a **rules-v1 engine**
(fresh sellers, BSR, listing caps, brand screen, search-volume proof, trademark sweep, Books-only +
format filter, real-location results), expands seeds with **AI** (Gemini or free alternatives),
and works without any API key via live Amazon + Google autocomplete.

> Zero build step. Pure ES modules (MV3). No runtime dependencies.

---

## Contents

1. [Install](#1-install)
2. [First-time setup](#2-first-time-setup-5-minutes)
3. [The A-to-Z workflow: seed → best niche](#3-the-a-to-z-workflow-seed--best-niche)
4. [How to read the Niche Finder table](#4-how-to-read-the-niche-finder-table)
5. [How to vet a finalist in the detail drawer](#5-how-to-vet-a-finalist-in-the-detail-drawer)
6. [What a "best niche" looks like (checklist)](#6-what-a-best-niche-looks-like-checklist)
7. [Section-by-section reference](#7-section-by-section-reference)
8. [Settings & gates: what to change (and what to leave alone)](#8-settings--gates-what-to-change-and-what-to-leave-alone)
9. [Pro tips](#9-pro-tips)
10. [Troubleshooting](#10-troubleshooting)
11. [How it works (internals)](#11-how-it-works-internals)
12. [Security](#12-security)
13. [Development](#13-development)
14. [Disclaimer](#14-disclaimer)

---

## 1. Install

1. Download `kdp-copilot-v0.8.15.zip` from the
   [Releases page](https://github.com/YoucefSennoun/kdp-copilot/releases) and unzip it.
2. Open `chrome://extensions`, enable **Developer mode** (top-right), click **Load unpacked**,
   and select the unzipped folder (the one containing `manifest.json`).
3. Click the extension icon to open the dashboard. If Chrome says the extension
   "requests new permissions", accept them and reload the extension.

> Tip: everything works without an API key. Add one when you want AI expansion, niche
> analysis, and the AI trademark sweep (see [setup](#2-first-time-setup-5-minutes)).

---

## 2. First-time setup (5 minutes)

Open the dashboard → **Settings**.

1. **Default Market** — leave `US` unless you publish mainly elsewhere. Every research run
   lets you override it per search.
2. **AI Provider** — two options, all four AI features (Expand, Analyze, Legal sweep, and the
   AI part of Research) use whichever you pick:
   - **Google Gemini (direct)** — paste a [Gemini API key](https://aistudio.google.com/apikey),
     keep model `gemini-3.6-flash`.
    - **OpenAI-compatible** — for free/cheap models. Set Base URL to
      `https://openrouter.ai/api/v1`, paste a key from `openrouter.ai/keys`, and use model
      `xiaomi/mimo-v2.5` (cheap; OpenRouter's free starter credit covers many checks).
      ⚠️ OpenCode Zen's *free* models only answer inside the OpenCode app — from this
      extension they need paid Zen credit, so prefer OpenRouter for free use.
    - <span>**You are not limited to the dropdown presets: the Model field accepts any
      OpenRouter model id.** Type it in exactly (e.g. `nvidia/nemotron-3-super-120b-a12b:free`),
      Save, and Analyze, Listing, Legal sweep and AI Expand will all run on it. Free `:free`
      models are rate-limited (the tool retries automatically); if an id is wrong or retired,
      the error message names the problem.</span>
3. **Leave every gate at its default** for your first niches (see [§8](#8-settings--gates-what-to-change-and-what-to-leave-alone)
   for what each one means). The defaults encode the built-in research rules.
4. Click **Save Settings**.

Optional: bind the research shortcuts at `chrome://extensions/shortcuts`. `Alt+Shift+1`
researches your currently selected text on US, `Alt+Shift+3` on DE (UK/FR available to bind).

---

## 3. The A-to-Z workflow: seed → best niche

A full run takes roughly **10–20 minutes**, most of it unattended scraping. The pipeline is:

```
Suggestions = is there demand? (seconds, free)
      → Explorer = is it winnable? (minutes, scrapes pages)
          → Niche Finder = show me only the winners
```

### Step 0 — Start with a seed idea (1 minute)

Think in **book formats buyers already search for**, not clever concepts:
good seeds are `anxiety journal`, `meal planner`, `word search`, `prayer journal`,
`logbook`, `coloring book`. One or two words is ideal — the tool discovers the long tail itself.

> If you just finished another niche, hit **Start Over** in Explorer first. It clears all
> data and pauses the queue (your next Research resumes it automatically).

### Step 1 — Cheap demand check in Suggestions (30 seconds, free)

1. Go to the **Suggestions** tab, type your seed, click **Fetch Suggested Keywords**.
2. Within seconds you see raw autocomplete phrases real shoppers type, tagged
   `amazon-autocomplete` / `google-suggest`, ranked by relevance.
3. Read it like this:
   - **Rich list of long-tail variants** (`anxiety journal for teens`, `anxiety relief journal`…)
     → real search demand exists. Proceed to Step 2.
   - **Almost nothing comes back** → shoppers don't search this space. Pick another seed —
     you just saved yourself a 15-minute scrape.
   - A warning like "Google Suggest unavailable" is harmless: Amazon results still save
     (Google throttles bots occasionally; the tool retries, then degrades gracefully).

### Step 2 — Research in Explorer (2 minutes of clicking, then walk away)

1. Go to **Explorer**, type the same seed, pick the **market**, leave format on **All formats**
   for the first pass.
2. Click **Research**. What happens now, automatically:
   - **Alphabet-soup expansion** — the tool queries Amazon + Google autocomplete for
     `seed a…z` and `a…z seed` (the literal search-volume proof procedure) and discovers
     every related long-tail phrase.
   - **SERP scraping** — it opens Amazon search tabs **one at a time** (rate-limited,
     ~3.5s apart) and scores every phrase: demand, competition, margin, confidence.
   - **BSR enrichment** — shortlisted keywords (score ≥ 50) get their top-8 product pages
     visited for real overall/sub-category BSR, categories, and publication dates.
3. Watch the **queue bar**. You can **Pause** any time (pause survives browser restarts);
   **Research/Expand/Scrape automatically resume** a paused queue.
4. Rows appear live in the Explorer table, sorted by score. Don't judge yet — enrichment
   arrives later and changes verdicts.

### Step 3 — Let enrichment finish

The queue bar shows stages: *scraping search results* → *enriching BSR (product pages)* → *Idle*.
A niche is only trustworthy **after** enrichment: freshness, BSR, and brand gates all need
product-page data. Go make coffee.

### Step 4 — Open Niche Finder and read the shortlist

Switch to the **Niche Finder** tab. It shows **only** keywords passing **all** rules-v1 gates,
sorted by best (lowest) overall BSR. See [§4](#4-how-to-read-the-niche-finder-table) for every column.

- **Empty table?** Read the status line — it tells you how many BSR-enriched keywords exist
  and the active gate values. Either the seed's space is genuinely too competitive (pick a
  more specific seed), or enrichment hasn't finished yet.
- **Rows present?** Your winners are here. Take the top 3–5 by score into Step 5.

### Step 5 — Vet each finalist in the detail drawer (5 minutes each)

Click **Details** on a row. Work through [§5](#5-how-to-vet-a-finalist-in-the-detail-drawer):
fresh-seller proof, BSR, brand screen, formats, FBA share, volume proof, location pin.

### Step 6 — AI analysis on the survivors

In the drawer (or the row's **AI** button), run the AI niche analysis. You get a verdict
sentence, competition/demand/opportunity levels, entry difficulty, underserved content
angles, differentiation ideas, risks, audience, and price point. The report is **cached** —
reopening Details shows it without paying for another call. **Write down the underserved
angles: they are your book concept.**

### Step 7 — Trademark check before you commit (non-negotiable)

Click **Legal** (row) or **View trademark report** (drawer):

1. Wait for the AI sweep — it reviews the keyword against every selected market and returns
   an overall risk (**low / medium / high**), a per-market table, flagged terms with owners,
   and a compliant alternative keyword. This takes up to a minute; a progress indicator
   with elapsed time keeps you informed.
2. If risk is **medium or high**, take the suggested safe keyword and research *it* instead.
3. If risk is **low**, still click through 2–3 **registry links** (USPTO for US, EUIPO for
   EU markets…) — they are the official databases, pre-filled with your keyword, Class 16
   (printed matter). The in-tool screen is a screen, not legal advice.
4. Open the **MyResearchBase** link from the detail drawer to confirm the KDP-only
   competition pool (it strips FBA/Amazon-retail noise from the results).

### Step 8 — Decide and build

Pick the niche with the best combination of **low best-BSR + fresh sellers + low risk +
angles you can execute**. Your book = the winning keyword + the AI's underserved angles +
a compliant title. Then go make it — the tool did its job.

---

## 4. How to read the Niche Finder table

| Column | Meaning | What "good" looks like |
|---|---|---|
| **Keyword / Mkt** | The niche phrase and marketplace | Long-tail (3+ words) beats head terms — more specific buyer, weaker competition |
| **Score** | 0–100 opportunity score (demand × 0.45 + (1 − competition) × 0.35 + margin × 0.2, long-tail boosted) | Higher is better; compare *within* one research run |
| **Fresh Hits** | Competitors that are ≤ 6 months old **and** already selling (BSR ≤ 200k) **and** unbranded | ≥ 1 (the gate minimum). **This is the single most important column**: it proves newcomers are currently winning here |
| **Best BSR** | Lowest overall Books BSR among enriched competitors | ≤ 200,000 (gate). Lower = the niche demonstrably sells |
| **Total Results** | True Amazon result count | ≤ 1000 (US) / ≤ 800 (other markets). Lower = fewer competitors |
| **Interest Proxy** | 0–100 composite of autocomplete depth/position + cross-engine confirmation. **Honestly not a monthly-search number** — no free source for that exists | ≥ 50 (gate). Higher = more shopper interest |
| **Content** | KDP-publishable family (Journal, Planner, Puzzle Book…) | Must be a family you can produce; red = excluded |
| **Brand** | ✓ brand-free sample | Must be ✓ — a ✗ means sales come from fame, not search traffic |
| **Gates** | NEW · BSR · LIST · VOL chips | All green = the row qualified |
| **Actions** | Details · Scrape · Legal | Details vets, Scrape refreshes data, Legal runs the trademark sweep |

> Only **BSR-enriched** keywords are eligible for this table. A fresh scrape with no
> enrichment yet won't appear here even if it looks promising — wait for Idle.

---

## 5. How to vet a finalist in the detail drawer

Open **Details** and check top to bottom:

1. **Headline metrics** — Demand / Competition / Margin / Confidence bars, verdict
   (Excellent ≥ 75 · Promising ≥ 60 · Competitive ≥ 40 · Hard < 40), est. monthly sales
   heuristic.
2. **Rules-v1 gates chips** — confirm NEW · BSR · LIST · VOL · BRAND all green.
3. **BSR table (rule 2)** — per-competitor rows: overall rank (green ≤ 200k), age in days
   (green = fresh < 6mo), category ranks. Look for **multiple green-green rows**: several
   young books already selling = the pattern you want to replicate, not a one-hit wonder.
4. **Brand risk (rule 3)** — must say brand-free. A ⚠ brand badge on a competitor means
   that book sells on fame; branded books are already excluded from the fresh-hit count.
5. **Formats (rule 6)** — kindle/paperback/hardcover shares. Blank-interior niches should
   show little Kindle share; a high Kindle share in a "journal" niche is a smell.
6. **Total results + FBA (rules 1 & 7)** — result count under cap; note the FBA share and
   use the **MyResearchBase** link to see the KDP-only pool you'll actually fight.
7. **Search volume proof (rule 4)** — proxy score plus the A–Z hit counts
   (`keyword + a–z: 14/26`). Real typed extensions = real demand. "Keyword itself
   suggested: yes" is the strongest single signal.
8. **Location pin (rule 7)** — "Deliver-to" should show the market's capital ZIP as pinned,
   proving results reflect real domestic ranking, not generic results.
9. **AI analysis + trademark report** — run both (Steps 6–7) before deciding.

---

## 6. What a "best niche" looks like (checklist)

A niche worth your next book months has **all** of these:

- [ ] Appears in **Niche Finder** (passes every gate — no exceptions by hand-waving)
- [ ] **≥ 2 fresh hits**: young (≤ 6mo), selling (BSR ≤ 200k), unbranded competitors
- [ ] **Best BSR comfortably under 200k** (under 100k is strong)
- [ ] **Interest proxy ≥ 50** with several literal A–Z extensions hit
- [ ] **Keyword itself appears in autocomplete** ("suggested: yes")
- [ ] **Brand-free** sample, content family you can actually produce
- [ ] **Trademark risk low**, verified in USPTO/EUIPO for your launch markets
- [ ] **AI analysis** names concrete underserved angles (your table of contents)
- [ ] **Long-tail phrasing** (3+ words) with clear buyer intent
- [ ] You can describe the book in one sentence a buyer would type into search

If two niches pass everything, pick the one with **more fresh hits** — it proves the door
is open *right now*.

---

## 7. Section-by-section reference

### Explorer — the workbench
Seed input + market + format, **Research** button, queue bar with **Pause/Resume**,
**Export CSV**, **Refresh**, **Start Over** (clears everything and pauses; next Research
auto-resumes). The table holds **all** researched keywords with sortable Score / Demand /
Competition / Margin / Confidence, est. sales, results, scraped date. Row actions:
**AI** (niche analysis), **LK** (trademark check), **SC** (re-scrape), **DEL** (delete).
Click any keyword for its detail drawer. Keyboard shortcuts (`Alt+Shift+1` US, …) research
selected text as a seed.

### Niche Finder — the shortlist
Described fully in [§4](#4-how-to-read-the-niche-finder-table). **Refresh** reloads,
**Scrub out-of-scope** deletes stored keywords that fail the current content scope
(use after changing scopes). Row actions: Details · Scrape · Legal.

### Suggestions — the staging area
**Fetch Suggested Keywords**: 2-second, zero-tab preview of what shoppers type for a seed
(Amazon + Google, relevance-ranked). **Expand** (per row): full pipeline rooted at that
phrase — slow (minutes), with live progress. **Scrape** (per row): score just that one
phrase. **Expand From All Suggestions**: convert the whole staging list into scored
keywords + queued scrapes. **Clear Suggestions** empties the staging list. This tab also
fills automatically as a by-product of every Research.

### Settings — the control room
API keys and provider, default market, SERP pages per scrape (1–3), autocomplete toggles,
SERP panel toggle, all rules-v1 gates, trademark markets, BSR enrichment (on/off, products
per keyword, minimum pre-BSR score), and scheduled Discovery (daily alarm over category
pages: Best Sellers / Movers & Shakers / New Releases). Discovery is schedule-only — there
is no manual "discover now" button; enable it and results flow into your tables daily.

---

## 8. Settings & gates: what to change (and what to leave alone)

**Leave alone until you've run 5+ niches:** max book age (6), fresh-hits minimum (1),
overall BSR max (200000), listing caps (1000/800), interest threshold (50), brand filter
(on), content scope (`rule8`), enrichment (on, 8 products, min score 50).

**Safe to adjust early:**
- **Default market** — your launch market.
- **Format filter** — set Kindle/paperback/hardcover when you only make one binding
  (applies to new scrapes; the format gate then requires ≥ 50% share).
- **SERP pages 1 → 2–3** — deeper samples for finalists (slower; keep 1 for broad sweeps).
- **Trademark markets** — uncheck markets you'll never publish in to shorten AI sweeps.
- **Enrichment min score** — lower it (e.g. 40) to enrich more borderline keywords when a
  seed yields little; raise it (60–70) to save time on huge runs.
- **Content scope** — `rule8` (default: low-content + puzzle/coloring/photo/sheet-music/
  manual/textbook/children's) · `strict` (blank interiors only, Amazon's definition) ·
  `standard` (adds guides + narrow fiction). Changing scope re-filters old rows too.

**Advanced (know why before touching):** sub-category BSR gate (off by default — overall
BSR is the real rule), "keyword must appear in autocomplete" strict mode, min fresh hits
above 1 (much stricter — demands *repeated* newcomer success), disabling the content or
brand filters (shows you *why* rows fail, useful for learning, not for picking).

---

## 9. Pro tips

- **Seed broad, pick narrow.** `journal` → research → winners like `gratitude journal for
  teen girls` emerge by themselves. Never start with the long tail; let autocomplete find it.
- **One seed, one market at a time.** Cross-market comparison comes after you have a winner
  (re-run the exact winning phrase in UK/DE/FR).
- **Re-scrape finalists a week later** (row SC button). Fresh hits age out and BSR moves —
  a niche that still qualifies twice is real.
- **Export CSV** before Start Over to keep a personal niche journal outside the tool.
- **When AI is overloaded**, expansion falls back to autocomplete automatically (you'll see
  a pipeline note) — results keep flowing, just less creative.
- **Google 403 warnings are cosmetic.** Google throttles bots; the tool retries, then uses
  Amazon data alone. Only worry if *both* engines fail repeatedly.
- **Red trademark risk is a redirect, not a dead end.** Take the suggested safe keyword and
  research it — often the compliant rephrase is itself an underserved niche.

---

## 10. Troubleshooting

| Symptom | Cause → fix |
|---|---|
| Suggestions tab empty after fetch | Both autocomplete engines unreachable → check network/VPN; Amazon alone still saves partial results |
| Per-row Expand slow (minutes) | Normal: alphabet soup + AI + probes. Watch the live progress status |
| AI "model overloaded / under demand" | Server-side; the tool retries with backoff, then falls back (Expand) — just wait or retry |
| `models/X is not found` (Gemini 404) | Stale model id — re-pick the model in Settings → Save (fixed properly in v0.8.10+) |
| CORS / preflight errors on Zen/OpenRouter | Missing host permission → reinstall the latest ZIP and accept new hosts in `chrome://extensions` |
| `free tier can only be used in OpenCode` | Zen free is app-only → use OpenRouter + `xiaomi/mimo-v2.5` |
| `model deprecated` 404 | Provider retired the id → pick the replacement preset in Settings |
| Start Over "doesn't stop" | Fixed in v0.8.5+: reset now cancels in-flight flows and pauses; next Research resumes |
| Queue stuck on a CAPTCHA page | Timeout guard (30s) closes orphans automatically; solve captchas in your own browsing sparingly — scraping is intentionally slow to respect rate limits |
| Scores look odd (e.g. `53.19…`) | Display rounding only — fixed in v0.8.15 (1 decimal everywhere) |

---

## 11. How it works (internals)

```
Seed ──► EXPAND (AI  OR  Amazon+Google A–Z autocomplete)
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
- **`src/background/scrape-queue.js`** — serialized tab scraper with timeout + tab cleanup + persisted pause + reset generation counter.
- **`src/background/ai.js`** — Gemini + OpenAI-compatible providers (chat/completions and Responses API), tolerant JSON parsing, overload retries, keyless fallbacks.
- **`src/background/discovery.js`** — title → keyword cleaning for discovery runs.
- **`src/lib/scoring.js`** — scoring engine, sales estimates, verdicts, rules-v1 `computeQualifies`.
- **`src/lib/markets.js`** — 20 marketplaces, Books-only search + per-market autocomplete URLs, ZIP pinning, MyResearchBase links.
- **`src/lib/content-type.js`** — KDP-publishable classifier (`rule8` / `strict` / `standard`).
- **`src/lib/brands.js`** — brand blocklist + famous authors + author-frequency detection.
- **`src/lib/trademark-registry.js`** — official registry directory + Marcaria aggregator + local screen.
- **`src/lib/proxy.js`** — transparent interest-proxy composite (NOT monthly search volume).
- **`src/lib/dates.js`** — locale-aware publication-date parser for the freshness rule.
- **`src/lib/storage.js`** — IndexedDB stores + settings wrapper (DB v6, market-qualified ids).
- **`src/dashboard/`** — Explorer, Suggestions, Niche Finder, Settings views.

Score math: Score = demand × 0.45 + (1 − competition) × 0.35 + margin × 0.2 (×1.04 for
3–4-word phrases, ×1.08 for 5+). Demand = reviews 20% + BSR 30% + rating 10% + interest
proxy 40%. Competition = result count 30% + reviews 25% + top-concentration 25% + price
10% + ads 10%. Margin = price headroom 50% + low competition 35% + Kindle share 15%.

---

## 12. Security

- API keys live **only** in `chrome.storage.local` — never in the repo, never sent anywhere
  but the configured provider.
- **No telemetry.** Network calls go only to Amazon (search + per-market autocomplete +
  delivery-location endpoint), Google Suggest, MyResearchBase deep links, official
  trademark-registry links, and your chosen AI endpoint.

---

## 13. Development

Clone the repo and **Load unpacked** the project root. No install/build step.

```bash
node tests/run-tests.mjs
node tests/check-imports.cjs
node tests/check-ids.cjs
```

235+ unit tests cover the pure data layer (scoring, gates, proxy, content-type, brands,
trademark directory, markets, dates, discovery, AI transports/parsing/retries).

---

## 14. Disclaimer

For personal research and education. Respect Amazon's terms of service and rate limits —
the scraper intentionally runs one tab at a time with delays. Trademark screens are
informational, not legal advice — verify with the official registries and a qualified
attorney before publishing. KDP Copilot is not affiliated with Amazon or Google.
