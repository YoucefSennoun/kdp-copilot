# KDP Copilot — Development Plan: "Zero-to-Niche" Discovery Engine

**Prepared for:** Youcef Sennoun
**Target executor:** AI coding agent (OpenCode Desktop / Big Pickle)
**Source analyzed:** `github.com/YoucefSennoun/kdp-copilot` @ `master` (v0.3.0), full source tree read directly (manifest.json, all of `src/background`, `src/content`, `src/lib`, `src/dashboard`)
**Goal:** Evolve the extension so it can go from **zero input** to a **qualified niche list**, where "qualified" means:

| Criterion | Definition used in this plan |
|---|---|
| **BSR < 200** | The *best* (lowest) sub-category Best Sellers Rank found among the niche's top listings — not overall Books BSR. Configurable. |
| **Listings < 1000** | Amazon's *true total result count* for the keyword's search page (the "1–48 of over X results" number) — not the number of cards visible on one page. |
| **Good search volume** | A composite, transparently-labeled *interest proxy* built from autocomplete depth/position + cross-engine confirmation — not a fabricated "monthly searches" number, because no free, official source for that exists (see §3). |

This document does not contain implementation code. It is a spec/roadmap to hand to a coding agent.

---

## 1. What the repo actually does today (verified from source)

The architecture is genuinely solid: MV3, zero build step, clean separation between content scripts (`serp-parser.js`, `product-parser.js`), a background message router (`background/index.js`), a serialized single-tab scrape queue (`scrape-queue.js`), a pure scoring module (`lib/scoring.js`), and a 3-tab dashboard (Explorer / Suggestions / Settings) driven by a tiny router in `app.js`. Multi-market support (11 marketplaces) is real and wired through `lib/markets.js`. The Gemini integration has a working keyless fallback via Amazon+Google autocomplete. This is a good foundation — the gaps below are additive, not "start over" territory.

## 2. The four gaps that block your exact niche criteria

These were found by reading the code, not guessed:

### Gap A — "Listings < 1000" cannot currently be measured at all
`serp-parser.js`'s `getListings()` only counts `<div data-component-type="s-search-result">` cards **on the currently loaded page** — i.e. whatever Amazon renders in one page load (typically 16–48 cards). This count becomes `metrics.listingCount` in `scoring.js`. **Amazon's real total-result number (the "1–48 of over 6,000 results" string) is never parsed anywhere in the codebase.** Practically, this means a keyword with 40,000 competing books and a keyword with 400 competing books currently look almost identical to the tool, because both only ever return ≤48 sample cards, normalized against `NORMALIZE_MAX.listingCount = 200`. **This is the single most important fix** — your core "under 1000 results" filter is a no-op today.

### Gap B — "BSR-aware scoring" isn't actually BSR-aware in the automated flow
`product-parser.js` correctly extracts BSR (and sub-category BSR array `bsrAll`) — but **only** when a tab is manually on a `/dp/ASIN` product page. The auto-scrape queue (`scrape-queue.js`) only ever visits **search** pages, never product pages. `scoring.js`'s `computeListingsStats()` looks for `l.bsr` on each SERP listing, but `serp-parser.js`'s `getListings()` never sets a `.bsr` field. Result: `medianRank` is `null` for every keyword scored through the normal "Expand & Auto-Scrape" flow, so demand/`estimatedMonthlySales` silently fall back to a flat 0.5 factor. The BSR half of the README's scoring formula is currently dead code in practice.

### Gap C — No search-volume signal of any kind, real or proxy
Demand today = reviews + (broken) BSR + rating. There is no autocomplete-depth mining, no suggestion-position weighting, no cross-engine confirmation score — even though the raw ingredients (`amazonAutocomplete()`, `googleSuggest()`) already exist in `background/index.js`. I checked: there is no free, official Amazon API for real search volume, and even paid tools (Publisher Rocket, Helium 10, etc.) use proprietary/undisclosed estimates rather than ground truth — free tools that claim "volume" are explicit that it's a relative popularity score, not a real number. So the right target here is a well-built, honestly-labeled **proxy score**, not a fake absolute number.

### Gap D — Everything requires a human-typed seed; there is no "from nothing" mode
Every path into the tool (`EXPAND_SEED`, `FETCH_SUGGESTIONS`, keyboard shortcuts) requires you to type or select a starting keyword. There is no code anywhere that reads Amazon's Best Sellers / Movers & Shakers / New Releases pages, which are the natural "seedless" entry point (public pages, no query needed, inherently reflect current demand). The `alarms` permission is declared in `manifest.json` but **`chrome.alarms` is never called anywhere in the codebase** — scheduled/background discovery is a capability you're already permissioned for but not using.

---

## 3. Target data model (what "qualifies" should mean in code)

Add this as an explicit, first-class object on every keyword record (not just derived at render time), so the dashboard, CSV export, and AI prompts all agree on the same qualification contract:

```
metrics.totalResultsCount        // true Amazon result count (Gap A fix)
metrics.resultsCountIsApprox     // true if Amazon showed "over X"
metrics.sampleSize               // renamed from today's listingCount (cards actually scraped)
metrics.distinctTitleCount       // sampleSize deduped by title+author (see 4.1 note)
metrics.bsrSamples[]             // per-ASIN {asin, bsr, bsrCategory, allRanks[]} from enrichment
metrics.bestSubcategoryBsr       // min(bsrSamples[].bsr) — this is your "< 200" number
metrics.bsrCoverage              // bsrSamples.length / sampleSize, feeds confidence
metrics.demandProxyScore         // 0-100 composite, clearly labeled "proxy, not verified volume"
qualifies: {
  bsr: boolean,
  listings: boolean,
  volume: boolean,
  all: boolean            // AND of the three — this is your one-click filter
}
```

Thresholds (BSR max, listings max, min proxy score) should live in **Settings**, defaulted to your stated numbers (200 / 1000 / a to-be-tuned proxy cutoff), not hardcoded — you'll want to loosen/tighten these once you see real data.

---

## 4. Phased roadmap

Each phase lists: objective, why it's needed (tied to the gaps above), concrete tasks, files touched, and how to know it's done. Phases 0–2 are prerequisites — they fix the measurement layer that Phases 4–5 depend on. Do not build the "seedless discovery" UI before Phases 1–2 are done, or it will just produce a faster stream of unreliable scores.

### Phase 0 — Hygiene fixes (½ day)
- `background/ai.js`: `MODEL_CHOICES` includes `gemini-1.5-flash` (already fully retired, returns 404) and will lose `gemini-2.5-pro` (Google has announced an Oct 16, 2026 shutdown). Replace the hardcoded list with either a live call to Google's model-list endpoint, or at minimum refresh the hardcoded options to the current Gemini 3.x Flash lineup. Low effort, prevents confusing dead-model errors in Settings.
- Confirm `DB_VERSION` bump strategy in `lib/storage.js`: adding new fields to the `keywords` object store needs no schema migration (IndexedDB is schemaless per-record), but **adding any new object store** (e.g. a `discoveries` or `snapshots` store — see Phase 4/3b) does require bumping `DB_VERSION` and handling it in `onupgradeneeded`.
- **Acceptance:** Settings no longer offers a dead model; storage layer changes documented for the phases that need new stores.

### Phase 1 — True total-results capture (fixes Gap A) — **highest priority**
- In `content/serp-parser.js`, add a `getTotalResultsCount()` that locates Amazon's result-count string (commonly inside `div[data-component-type="s-result-info-bar"]` or a nearby `span`; text pattern `/of (over )?([\d,]+) results/i`). Parse "over X" as an approximate lower bound and set `resultsCountIsApprox: true`. Handle the "no results" and small-exact-count cases explicitly — those are exactly the golden low-competition niches you're hunting for. Amazon's markup shifts periodically, so write this defensively with 2–3 fallback selectors, the same style already used in `getListings()`.
- Thread `totalResultsCount` / `resultsCountIsApprox` through the `SERP_PARSED` message payload into `background/index.js`'s `handleSerpParsed` → `preprocessMetrics`.
- In `lib/scoring.js`: rename the current sample-based `listingCount` usage to `sampleSize` for clarity; make `computeCompetition()` use `totalResultsCount` (when present) as the primary competition-volume signal instead of the always-≤48 sample count, with `NORMALIZE_MAX` retuned around real Amazon result-count distributions for Books (worth sampling ~20 real searches by hand to calibrate this constant instead of guessing).
- Add the dedup refinement: Amazon SERPs list separate cards per format (hardcover/paperback/Kindle/audiobook) for what's really one title. Add `distinctTitleCount` (group by normalized title + author within the sample) alongside raw `sampleSize`, since "how many *actual books* am I competing with" is the number that matters for niche-picking, not raw card count.
- **Acceptance:** scraping a known broad term (e.g. "journal") shows a total in the thousands/tens-of-thousands; a known narrow term shows a small exact number; dashboard and CSV export both surface `totalResultsCount` distinctly from sample size.

### Phase 2 — BSR enrichment pipeline (fixes Gap B)
- Extend the scrape-queue task model (`background/scrape-queue.js`) to support a second task type — after a SERP scrape resolves, enqueue lightweight product-detail visits for a **capped subset** of that keyword's listings (e.g. top 5–10 by review count/position, not all 48 — this is a rate-limit and stealth decision, see §6). Tag each task with its `parentKeyword` so the result can be merged back (the existing `pendingTabs` map in `scrape-queue.js` is the natural place to carry this context through tab→content-script→message round trips).
- `background/index.js`'s `handleProductParsed` currently stores product data as a fully separate `dp/{asin}` keyword record, orphaned from the SERP record. Change it to *also* merge `{asin, bsr, bsrCategory, bsrAll}` into the parent keyword's `metrics.bsrSamples[]`, then recompute `medianRank` / `bestSubcategoryBsr` / `estimatedMonthlySales` now that real BSR data exists for at least the enriched subset.
- Add `metrics.bsrCoverage` and fold it into `computeConfidence()` in `lib/scoring.js` (which currently checks presence of 5 signals but doesn't check for real, non-null BSR specifically).
- **Gate this phase's traffic**: only run BSR enrichment on keywords that already look promising post-SERP-scrape (e.g. `totalResultsCount` under some ceiling, or a pre-BSR score above a threshold). This turns BSR enrichment from "10x more Amazon traffic on everything" into "targeted deep-dive on shortlisted candidates only" — better for both your Amazon footprint and your own scrape time budget.
- **Acceptance:** a scored keyword record shows a real, non-null `bestSubcategoryBsr` sourced from actual product pages, and `estimatedMonthlySales` stops defaulting to the flat heuristic for enriched keywords.

### Phase 3 — Search-interest proxy engine (fixes Gap C)
- Build `metrics.demandProxyScore` from signals you can actually get for free, combined transparently:
  - **Autocomplete depth/position**: extend `amazonAutocomplete()` to query the seed + each letter a–z ("alphabet soup"), not just the bare seed as today; count distinct completions and weight by each suggestion's rank position (position 1 = stronger signal than position 10).
  - **Cross-engine confirmation**: a keyword appearing in both Amazon suggest *and* Google suggest is a stronger signal than either alone. `background/ai.js` already has `computeSuggestionRelevance()` scaffolding for something adjacent to this — extend it into a persisted per-keyword score rather than only using it to rank AI-fallback suggestions.
  - **(Stretch, Phase 3b) Review-growth velocity**: `lib/storage.js` already has an unused `scrapes` object store (autoincrement, never called anywhere). Wire it up to log a lightweight snapshot `{keyword, totalReviews, scrapedAt}` on every scrape. Once you have 2+ snapshots weeks apart for the same keyword, review-count delta becomes a real, first-party sales-velocity signal — independent of everything else. This only pays off with repeated use over time, so treat it as a later increment, not a blocker.
- Label this everywhere in the UI as **"Interest proxy"**, not "search volume" — don't let the dashboard or AI prompts imply a number you don't actually have. This is both more honest and more defensible than most competing tools in this space, which quietly do the same thing under vaguer branding.
- **Acceptance:** `demandProxyScore` visibly differentiates a keyword you already know is high-interest (e.g. a proven bestseller category) from a low-interest one, using only free signals; the UI never claims a monthly search count.

### Phase 4 — Seedless "Discovery Mode" (fixes Gap D)
- Add `src/lib/categories.js`: a curated static list (~150–300 entries) of KDP-friendly Amazon Books browse-node IDs (low-content, journals/planners, niche nonfiction sub-genres, genre-fiction sub-genres). Start static/curated rather than a live category-tree crawler — Amazon's category tree structure shifts and a dynamic crawler is meaningfully more fragile; a hand-curated list you extend over time is the safer v1.
- Add a background fetcher for Amazon's public Best Sellers / Movers & Shakers / New Releases pages (`/gp/bestsellers/books/{node}`, `/gp/movers-and-shakers/books/{node}`, `/gp/new-releases/books/{node}`) — these need no search query and inherently reflect current demand.
- New dashboard action, **"Discover Niches"** (no seed field): pick N random/round-robin category nodes → scrape their bestseller/movers pages → extract distinct titles/keywords from what's already selling → feed those through the existing `expandNicheSeeds` / `localExpandFallback` pipeline exactly as if they were manually typed seeds → auto-enqueue for full Phase 1+2 scraping.
- Wire the already-declared-but-unused `chrome.alarms` permission to run Discovery Mode on a schedule (e.g. daily), so a "from nothing" session can mean literally opening the dashboard to a pre-built, freshly-scored candidate queue.
- **Acceptance:** clicking "Discover Niches" with zero prior input produces a populated, scored keyword queue within one scrape cycle; a scheduled alarm can trigger the same flow unattended.

### Phase 5 — Niche Qualification Engine + dashboard "Niche Finder" view
- Implement the `qualifies: {bsr, listings, volume, all}` object from §3 as a pure function in `lib/scoring.js`, driven by the configurable thresholds in Settings.
- Add a 4th nav tab alongside Explorer / Suggestions / Settings (the router in `dashboard/app.js` already makes this a ~10-line addition: new `<li><a data-view="niches">Niche Finder</a></li>`, new `#view-niches` section, new `views/niche-finder.js` module following the exact pattern of `views/explorer.js`). This view shows **only** records where `qualifies.all === true`, sorted by score, with the three qualifying numbers (best sub-BSR, total results, proxy score) shown as its own columns instead of buried in a detail drawer.
- Add one-click hand-off from a qualifying row straight into the existing `GENERATE_LISTING` AI action (`handleGenerateListing`) — the moment a niche clears your bar, you should be able to go straight to title/keywords/description without re-navigating.
- **Acceptance:** the Niche Finder tab, with zero manual filtering, shows exactly the set of keywords meeting all three of your stated criteria, and nothing else.

### Phase 6 — One-click "Find Me Niches" orchestration
- Chain Phases 4 → 1 → 2 → 5 into a single background job: Discover → scrape SERPs (get real totals) → enrich BSR on the shortlist only → score → qualify → land in Niche Finder. This is the literal "start from nothing, get a niche" pipeline you asked for.
- Surface a simple progress indicator reusing the existing queue-progress pattern (`scrapeQueue.onProgress` → `QUEUE_PROGRESS` message → dashboard progress bar), extended to show which pipeline stage is active.
- **Acceptance:** one button press with no input produces, unattended, a populated Niche Finder tab.

### Phase 7 — Reliability, stealth, and scale (ongoing, but formalize before scheduling unattended runs)
- BSR enrichment and Discovery Mode both multiply Amazon traffic significantly versus today's single-SERP-per-keyword flow. Before enabling scheduled/unattended runs (Phase 4's alarm), tighten intervals specifically for the enrichment queue (slower than the existing 3.5s SERP interval — consider 5–8s), and keep the "cap enrichment to shortlisted keywords only" rule from Phase 2 non-negotiable.
- Add explicit CAPTCHA/block detection (e.g. checking for a captcha-page marker in scraped HTML) so a blocked tab fails loudly into `scrapeQueue.failed` instead of silently poisoning scores with empty data.
- Keep the existing "one tab at a time, rate-limited, timeout-guarded" posture — don't parallelize tabs to go faster; the risk/reward is bad. Extending the interval slightly is safer than adding concurrency.

### Phase 8 — Testing
- The README references a separate `kdp-copilot-tests` project using `fake-indexeddb`. Extend it phase-by-phase: Phase 1 needs fixture SERP HTML with known result-count strings (including the "over X" and small-exact-count edge cases); Phase 2 needs fixture product-page HTML with known BSR strings; Phase 3's proxy score needs a fixed-input regression test so future tuning doesn't silently drift; Phase 5's `qualifies` function is pure and trivially unit-testable against the new data model in §3.

---

## 5. Suggested execution order

1. Phase 0 (hygiene) — fast, unblocks nothing but costs little.
2. **Phase 1 first, always** — it's the direct fix for your explicit "< 1000 listings" criterion and currently a complete no-op.
3. Phase 2 — fixes the "< 200 BSR" criterion; depends on nothing from Phase 1 but is more valuable once Phase 1 lets you gate enrichment sensibly.
4. Phase 3 — independent of 1/2, can be built in parallel by the agent if you're running multiple sessions.
5. Phase 5 (qualification engine + Niche Finder tab) — depends on 1, 2, and 3 all landing real values in the data model.
6. Phase 4 (seedless discovery) — can be built anytime, but its output is only as good as Phases 1/2/3/5 that score it; build the *pipeline* early if you want to see real data sooner, but treat its scores as provisional until 1–3 land.
7. Phase 6 (orchestration) — glue step, do last.
8. Phase 7 (stealth/scale hardening) — do before ever turning on the Phase 4 alarm for unattended scheduled runs.

## 6. Open questions to settle (either now, or leave as agent defaults it flags back to you)

- **BSR basis**: confirm "< 200" means best sub-category BSR (recommended, matches how most KDP niche-hunters use this number) rather than overall Amazon Books BSR — overall Books BSR under 200 is an extremely high bar (top-200-of-all-books), almost certainly not what's intended.
- **Enrichment sample size**: how many top listings per keyword to visit for BSR (proposed default: top 8). Bigger = more accurate median, more Amazon traffic and time per keyword.
- **Proxy score cutoff**: "good search volume" needs a numeric threshold on `demandProxyScore` once you see real output distributions — expect to tune this after the first real Discovery Mode run, not before.
- **Discovery category list scope**: start with your own niches (baby/mom-adjacent, given your existing e-commerce focus, plus the ataxia/health-nonfiction space you're already publishing in) as the first curated category list, then broaden.
