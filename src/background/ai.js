const ENDPOINT = 'https://generativelanguage.googleapis.com/v1beta/models';
const DEFAULT_MODEL = 'gemini-3.6-flash';
const MAX_OUTPUT_TOKENS = 4096;

import { classifyContentType } from '../lib/content-type.js';

// Phase 0 hygiene: the old list included fully-retired (`gemini-1.5-flash`)
// and soon-to-be-shutdown (`gemini-2.5-pro`) models. Keep only live, current
// generation defaults. `fetchModelChoices()` tries Google's live model list
// first and falls back to this static list when unavailable.
export const MODEL_CHOICES = [
  { id: 'gemini-3.6-flash', label: 'Gemini 3.6 Flash (fast, cheap)' },
  { id: 'gemini-3.6-flash-lite', label: 'Gemini 3.6 Flash-Lite (cheapest)' },
  { id: 'gemini-3.6-pro', label: 'Gemini 3.6 Pro (highest quality)' }
];

const MODEL_LIST_URL = 'https://generativelanguage.googleapis.com/v1beta/models';

// ---------------------------------------------------------------------------
// Custom OpenAI-compatible provider (OpenCode Zen / OpenRouter / CometAPI…).
// Free options that work for Analyze / Listing / Legal / Expand:
//   Zen (https://opencode.ai/zen/v1, key from opencode.ai/auth):
//     big-pickle, mimo-v2.5-free            → chat/completions (OpenAI shape)
//     muse-spark-1.3-contributor-free       → /responses (Responses API only)
//   OpenRouter (https://openrouter.ai/api/v1):
//     xiaomi/mimo-v2-flash:free (free), meta/muse-spark-1.3-contributor (cheap)
// The model field stays free-text, so any future :free id works unmodified.
// ---------------------------------------------------------------------------

export const DEFAULT_CUSTOM_BASE_URL = 'https://opencode.ai/zen/v1';
export const DEFAULT_CUSTOM_MODEL = 'big-pickle';

export const CUSTOM_BASE_URLS = [
  { id: 'https://opencode.ai/zen/v1', label: 'OpenCode Zen (free: Big Pickle, MiMo-V2.5, Muse Spark 1.3 Contributor)' },
  { id: 'https://openrouter.ai/api/v1', label: 'OpenRouter (free :free models + cheap tiers)' }
];

// transport: 'chat' = POST {base}/chat/completions; 'responses' = POST
// {base}/responses (OpenAI Responses API — Zen serves the Muse Spark free
// tier only there).
export const CUSTOM_MODEL_CHOICES = [
  { id: 'big-pickle', label: 'Big Pickle (Zen, FREE, limited time)', api: 'chat' },
  { id: 'mimo-v2.5-free', label: 'MiMo-V2.5 Free (Zen, FREE, limited time)', api: 'chat' },
  { id: 'muse-spark-1.3-contributor-free', label: 'Muse Spark 1.3 Contributor Free (Zen, FREE, limited time)', api: 'responses' },
  { id: 'xiaomi/mimo-v2-flash:free', label: 'MiMo-V2-Flash (OpenRouter, FREE)', api: 'chat' },
  { id: 'meta/muse-spark-1.3-contributor', label: 'Muse Spark 1.3 Contributor (OpenRouter, ~$0.10/$0.20 per 1M)', api: 'chat' }
];

const RESPONSES_API_MODELS = new Set(
  CUSTOM_MODEL_CHOICES.filter((m) => m.api === 'responses').map((m) => m.id)
);

/** Which HTTP API a custom model id needs. Pure — safe to unit-test. */
export function customTransportFor(model) {
  return RESPONSES_API_MODELS.has(String(model || '').trim()) ? 'responses' : 'chat';
}

/** Resolved AI configuration from stored settings. */
export async function getAIConfig() {
  const { kdpSettings } = await chrome.storage.local.get(['kdpSettings']);
  const s = kdpSettings || {};
  return {
    provider: s.aiProvider === 'custom' ? 'custom' : 'gemini',
    geminiKey: s.apiKey || '',
    geminiModel: s.model || DEFAULT_MODEL,
    customBaseUrl: String(s.customBaseUrl || DEFAULT_CUSTOM_BASE_URL).replace(/\/+$/, ''),
    customKey: s.customApiKey || '',
    customModel: String(s.customModel || DEFAULT_CUSTOM_MODEL).trim()
  };
}

/** True when a custom provider is selected AND has a key. Never throws. */
export async function hasCustomAI() {
  try {
    const cfg = await getAIConfig();
    return cfg.provider === 'custom' && !!cfg.customKey;
  } catch {
    return false;
  }
}

/** OpenAI chat/completions request body. Pure — safe to unit-test. */
export function buildChatBody({ model, systemInstruction, prompt }) {
  const messages = [];
  if (systemInstruction) messages.push({ role: 'system', content: systemInstruction });
  messages.push({ role: 'user', content: prompt });
  return {
    model,
    messages,
    temperature: 0.7,
    max_tokens: MAX_OUTPUT_TOKENS,
    response_format: { type: 'json_object' }
  };
}

/** Extract the JSON payload from a chat/completions response. Pure. */
export function parseChatResponse(data) {
  const text = data?.choices?.[0]?.message?.content;
  if (!text || !String(text).trim()) throw new Error('Model returned an empty response.');
  return sanitizeJson(text);
}

/** OpenAI Responses API request body. Pure — safe to unit-test. */
export function buildResponsesBody({ model, systemInstruction, prompt }) {
  const input = [];
  if (systemInstruction) input.push({ role: 'system', content: systemInstruction });
  input.push({ role: 'user', content: prompt });
  return { model, input, max_output_tokens: MAX_OUTPUT_TOKENS };
}

/** Extract the JSON payload from a Responses API response. Pure. */
export function parseResponsesResponse(data) {
  const out = Array.isArray(data?.output) ? data.output : [];
  const text = out
    .filter((item) => item && (item.type === 'message' || item.type === 'output_text'))
    .flatMap((item) => {
      if (item.type === 'output_text') return [item.text];
      return (Array.isArray(item.content) ? item.content : [])
        .filter((c) => c && c.type === 'output_text')
        .map((c) => c.text);
    })
    .join('');
  if (!text.trim()) throw new Error('Model returned an empty response.');
  return sanitizeJson(text);
}

function providerLabelFor(baseUrl) {
  const base = String(baseUrl || '');
  if (base.includes('opencode.ai')) return 'OpenCode Zen';
  if (base.includes('openrouter.ai')) return 'OpenRouter';
  return 'Custom AI';
}

async function postJson(url, apiKey, body, label) {
  const res = await fetch(url, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${apiKey}`,
      ...(label === 'OpenRouter'
        ? { 'HTTP-Referer': 'https://github.com/YoucefSennoun/kdp-copilot', 'X-Title': 'KDP Copilot' }
        : {})
    },
    body: JSON.stringify(body)
  });
  if (!res.ok) {
    let detail = '';
    try {
      const parsed = await res.json();
      detail = parsed?.error?.message || JSON.stringify(parsed);
    } catch {
      detail = await res.text();
    }
    throw new Error(`${label} API error ${res.status}: ${detail}`);
  }
  return res.json();
}

export async function callCustomAI({ baseUrl, apiKey, model, systemInstruction, prompt }) {
  if (!apiKey) throw new Error('Custom AI provider has no API key — add one in Settings.');
  if (!model) throw new Error('Custom AI provider has no model — pick one in Settings.');
  const base = String(baseUrl || DEFAULT_CUSTOM_BASE_URL).replace(/\/+$/, '');
  const label = providerLabelFor(base);
  if (customTransportFor(model) === 'responses') {
    const data = await postJson(`${base}/responses`, apiKey, buildResponsesBody({ model, systemInstruction, prompt }), label);
    return parseResponsesResponse(data);
  }
  const data = await postJson(`${base}/chat/completions`, apiKey, buildChatBody({ model, systemInstruction, prompt }), label);
  return parseChatResponse(data);
}

/**
 * Single entry point for every AI feature (Expand, Analyze, Listing, Legal).
 * Routes to the configured provider: custom (Zen/OpenRouter/…) when selected
 * with a key, otherwise Gemini. Also fixes the stored Gemini model actually
 * being used (callers never passed it, so the Settings choice was ignored).
 */
export async function completeJson({ apiKey, model, systemInstruction, prompt }) {
  const cfg = await getAIConfig().catch(() => null);
  if (cfg && cfg.provider === 'custom' && cfg.customKey) {
    return callCustomAI({
      baseUrl: cfg.customBaseUrl,
      apiKey: cfg.customKey,
      model: cfg.customModel,
      systemInstruction,
      prompt
    });
  }
  return callGemini({
    apiKey: apiKey || (cfg && cfg.geminiKey) || '',
    model: (cfg && cfg.geminiModel) || model || DEFAULT_MODEL,
    systemInstruction,
    prompt
  });
}

export async function fetchModelChoices() {
  const cfg = await getAIConfig().catch(() => null);
  // The custom provider has no small live model list worth fetching (the
  // OpenRouter catalog is hundreds of models) — serve the curated presets.
  if (cfg && cfg.provider === 'custom') return CUSTOM_MODEL_CHOICES;
  const apiKey = await getApiKey();
  if (!apiKey) return MODEL_CHOICES;
  try {
    const res = await fetch(`${MODEL_LIST_URL}?key=${encodeURIComponent(apiKey)}&pageSize=100`);
    if (!res.ok) return MODEL_CHOICES;
    const data = await res.json();
    const flash = (data.models || [])
      .filter((mm) => /flash|lite/i.test(mm.name) && /generateContent/.test(mm.supportedGenerationMethods?.join(',') || ''))
      .map((mm) => {
        const id = mm.name.split('/').pop();
        const pretty = id.replace(/[-_]/g, ' ');
        return { id, label: `Gemini ${pretty} (live)` };
      });
    if (!flash.length) return MODEL_CHOICES;
    // De-duplicate against known defaults by exact id.
    const merged = [...MODEL_CHOICES];
    flash.forEach((f) => {
      if (!merged.some((m) => m.id === f.id)) merged.push(f);
    });
    return merged.slice(0, 12);
  } catch {
    return MODEL_CHOICES;
  }
}

export async function getApiKey() {
  const { kdpSettings } = await chrome.storage.local.get(['kdpSettings']);
  return (kdpSettings && kdpSettings.apiKey) || '';
}

function sanitizeJson(text) {
  const trimmed = (text || '').trim();
  if (!trimmed) return null;
  if (trimmed[0] === '[' || trimmed[0] === '{') {
    return JSON.parse(trimmed);
  }
  const fenced = trimmed.match(/```(?:json)?\s*([\s\S]*?)```/);
  if (fenced) return JSON.parse(fenced[1].trim());
  const start = trimmed.indexOf('[') === -1 ? trimmed.indexOf('{') : trimmed.indexOf('[');
  const open = trimmed[start];
  const close = open === '[' ? ']' : '}';
  const end = trimmed.lastIndexOf(close);
  if (start !== -1 && end > start) {
    return JSON.parse(trimmed.slice(start, end + 1));
  }
  throw new Error('Model returned an unexpected response format.');
}

async function callGemini({ apiKey, model = DEFAULT_MODEL, systemInstruction, prompt, schema }) {
  const contents = [];
  if (systemInstruction) {
    contents.push({ role: 'user', parts: [{ text: systemInstruction }] });
  }
  contents.push({ role: 'user', parts: [{ text: prompt }] });

  const generationConfig = {
    temperature: 0.7,
    maxOutputTokens: MAX_OUTPUT_TOKENS,
    responseMimeType: 'application/json'
  };

  const url = `${ENDPOINT}/${encodeURIComponent(model)}:generateContent?key=${encodeURIComponent(apiKey)}`;
  const res = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      contents,
      generationConfig,
      ...(schema ? { toolConfig: undefined, responseSchema: schema } : {})
    })
  });

  if (!res.ok) {
    let detail = '';
    try {
      const body = await res.json();
      detail = body?.error?.message || JSON.stringify(body);
    } catch {
      detail = await res.text();
    }
    throw new Error(`Gemini API error ${res.status}: ${detail}`);
  }

  const data = await res.json();
  const text = data.candidates?.[0]?.content?.parts
    ?.map((p) => p.text)
    .join('') || '{}';

  return sanitizeJson(text);
}

// ---------------------------------------------------------------------------
// 1. Niche expansion: seed -> adjacent low-competition book concepts
// ---------------------------------------------------------------------------

function buildExpansionPrompt(seed, market, count, scope = 'rule8') {
  const scopeRules = scope === 'strict'
    ? [
        `SCOPE: STRICT LOW-CONTENT ONLY (Amazon's official "generally low-content" definition).`,
        `You must ONLY propose BLANK-INTERIOR book families:`,
        `- notebooks (dot grid, composition, lined)`,
        `- planners (weekly, monthly, meal, budget, class/trip/planner)`,
        `- diaries and journals (plain, gratitude, manifestation, prompt journals)`,
        `- log / tracking books (habit, workout, food, reading, sleep, symptom, activity logs; thankfulness trackers)`,
        `- coupon books`,
        `- score card templates (sports scorecards, score sheets, game tracking)`,
        `- crafting templates (scrapbook paper, ephemera, card-making, stencils)`,
        `- blank sheet music / manuscript / staff paper`,
        `- personalized/name-variant blank books (e.g. "for a girl named…")`,
        `Forbidden in this scope (they are NOT "generally low-content" per Amazon): novels, fiction, non-fiction prose,`,
        `coloring books, puzzle/activity books, workbooks, photography books, printed sheet music, manuals, textbooks, children's story books.`,
        `If a niche is not one of the allowed blank-interior families, do NOT propose it at all.`
      ]
    : scope === 'rule8'
      ? [
          `SCOPE: RULES-v1 PUBLISHABLE LIST (low-content PLUS the "Not Generally Low-Content" families).`,
          `You must ONLY propose niches from these families:`,
          `- LOW-CONTENT: notebooks, planners, diaries/journals, prompt journals, log books (habit, activity, thankfulness tracking),`,
          `  coupon books, score card templates, crafting templates (scrapbook paper, ephemera), blank sheet music (manuscript/staff paper)`,
          `- PUZZLE BOOKS: crosswords, word search, sudoku, logic puzzles, mazes, cryptograms, dot-to-dot`,
          `- COLORING BOOKS: adult and kids coloring, color-by-number, activity coloring`,
          `- PHOTOGRAPHY BOOKS: photo books with captions (coffee-table style compilations an indie can assemble)`,
          `- SHEET MUSIC: published music notation books`,
          `- MANUALS: practical how-to manuals an indie can write (user guides, workflow manuals)`,
          `- TEXTBOOKS: educational workbooks/textbooks a subject-capable indie can write (math practice, language learning)`,
          `- CHILDREN'S BOOKS: picture books, early readers, chapter books, board books`,
          `Forbidden in this scope: novels, fiction, memoirs, biographies, non-fiction prose, expertise-required clinical/legal/academic works.`,
          `If a niche is not on the allowed list, do NOT propose it at all.`
        ]
      : [
          `SCOPE: STANDARD KDP-FRIENDLY (low-content + production-ready content).`,
          `ONLY propose niches whose physical book an indie can create without specialist credentials:`,
          `- low-content: journals, diaries, planners, notebooks, logbooks, trackers, calendars, gratitude/prompt books, guest books, coupon books, score cards, crafting templates, blank sheet music`,
          `- medium-content: coloring books, activity books, puzzle books (crosswords, word search, sudoku, mazes), workbooks, practice/handwriting books, flash cards`,
          `- personalized/name-variant books (e.g. "for a girl named…")`,
          `- researched-and-compiled guides: checklists, templates, curated how-to compilations, recipe collections, beginner guides a layperson can compile`,
          `- NARROW FICTION niches (optional): only when the niche names a specific sub-genre AND a concrete audience/setting (e.g. "cozy mysteries for seniors", "chapter books for girls 6-8"). Generic "novels", "romance", "fiction" broad terms are NEVER acceptable.`
        ];
  return [
    `Act as a senior Amazon KDP (Kindle Direct Publishing) niche research strategist.`,
    `Given the seed niche "${seed}" for the ${market.label} Amazon marketplace,`,
    `propose ${count} ADJACENT, low-to-mid competition book niches an independent publisher can ACTUALLY produce.`,
    ...scopeRules,
    `NEVER propose memoirs, biographies, essays, short-story anthologies, poetry, or expertise-required textbooks/clinical/scientific/legal/academic works.`,
    scope !== 'strict'
      ? `Never propose books whose subject is BECOMING a writer or self-publishing (e.g. "how to write a book", "book marketing for authors") -- those sell to authors, not to niche buyers. A planner/journal/workbook FOR that audience is fine ("novel writing planner").`
      : `Never propose books whose subject is BECOMING a writer or self-publishing -- they are non-fiction prose, outside this scope.`,
    scope !== 'strict'
      ? `A health-adjacent niche is allowed ONLY in its compiled/lay form (e.g. "diabetes-friendly recipes", "first-trimester guide") -- never clinical reference material.`
      : `A health-adjacent niche is allowed ONLY as a blank log/journal/planner (e.g. "diabetes logbook", "meal planner") -- never clinical reference or prose.`,
    `Prefer long-tail keywords with real buyer intent over broad head terms.`,
    ``,
    `CRITICAL RULE -- never suggest an existing book. If a keyword is the exact or near-exact title of a real, previously published, identifiable book you recognize, set "isExistingTitle": true. Existing titles are useless niches. Examples of EXISTING BOOKS you must NOT propose:`,
    `- "The Intelligent Investor" (Benjamin Graham finance classic)`,
    `- "Antifragile" (Nassim Taleb essay)`,
    `- "Principles: Life and Work" (Ray Dalio)`,
    `- "The Runaway Bunny" (children's picture book)`,
    `- "How Countries Go Broke" (published finance title)`,
    `If you recognize a keyword as a published book title, refuse it with "isExistingTitle": true rather than inventing a claim about it.`,
    ``,
    `Return JSON exactly in this shape:`,
    JSON.stringify({
      niches: [
        {
          keyword: 'long tail keyword phrase',
          category: 'Amazon book category this maps to',
          formats: ['paperback', 'kindle'],
          why: 'one sentence on why this niche is winnable',
          titleIdea: 'a marketable book title that hits this keyword',
          demandSignal: 'low | medium | high',
          contentType: scope === 'strict' ? 'low-content' : 'low-content | medium-content | personalized | guide | fiction-niche',
          isExistingTitle: false
        }
      ]
    }),
    `Only output the JSON object.`
  ].join('\n');
}

export async function expandNicheSeeds({ apiKey, seed, market, count = 10, allowFiction = true, scope = 'rule8' }) {
  const prompt = buildExpansionPrompt(seed, market, count, scope);
  const data = await completeJson({ apiKey, prompt });
  const niches = Array.isArray(data) ? data : data?.niches;
  if (!Array.isArray(niches)) throw new Error('Model response missing "niches" array.');
  return niches
    .filter((s) => isSuggestibleSuggestion(s, { allowFiction, scope }))
    .slice(0, count);
}

/**
 * Synchronous gate right after generation (Revision 2, Gap F / Bug 1).
 * Rejects suggestions the model itself flagged as existing titles, engine
 * suggestions that trip the high-content classifier, and phrasing tells that
 * indicate a real book ("by <Author>", "bestseller", "classic").
 */
export function isSuggestibleSuggestion(s = {}, { allowFiction = true, scope = 'rule8' } = {}) {
  if (s.isExistingTitle === true) return false;

  const keyword = String(s.keyword || '').trim();
  const titleIdea = String(s.titleIdea || '').trim();
  const ct = classifyContentType({ keyword: `${keyword} ${titleIdea}`.trim(), allowFiction, scope });
  if (ct.contentType === 'high-content-excluded') return false;

  const why = String(s.why || '');
  const category = String(s.category || '');
  const tells = ` ${why} ${category}`.toLowerCase();
  if (/by [a-z]+ [a-z]+/.test(tells)) return false;            // "by Warren Buffett"
  if (/\bbestseller\b/.test(tells)) return false;
  if (/\bclassic\b/.test(tells)) return false;
  return true;
}

// ---------------------------------------------------------------------------
// 2. Niche analysis: scraped SERP metrics -> competitive read + opportunities
// ---------------------------------------------------------------------------

function summarizeSample(sample) {
  return (sample || []).slice(0, 12).map((l) => ({
    title: (l.title || '').slice(0, 120),
    price: l.price ?? null,
    reviews: l.reviewCount ?? 0,
    rating: l.avgRating ?? null,
    type: l.mediaType || null,
    sponsored: !!l.sponsored
  }));
}

function buildAnalysisPrompt(keyword, keywordRecord) {
  const m = keywordRecord.metrics || {};
  const sample = summarizeSample(m.sample || keywordRecord.sample);
  const facts = {
    keyword,
    market: keywordRecord.market || 'us',
    totalResults: m.totalResultsCount ?? null,
    resultsAreApprox: m.resultsCountIsApprox ?? false,
    sampleSize: m.sampleSize ?? m.listingCount ?? null,
    distinctTitles: m.distinctTitleCount ?? null,
    avgPrice: m.avgPrice ?? null,
    priceRange: [m.lowPrice ?? null, m.highPrice ?? null],
    totalReviews: m.totalReviews ?? null,
    avgRating: m.avgRating ?? null,
    medianBsr: m.medianRank ?? m.avgBsr ?? null,
    bestSubcategoryBsr: m.bestSubcategoryBsr ?? null,
    interestProxy: m.demandProxyScore ?? null,
    estimatedMonthlySales: m.estimatedMonthlySales ?? null,
    topConcentration: m.topConcentration ?? null,
    kindleShare: m.kindleShare ?? null,
    sponsored: m.sponsoredCount ?? 0,
    score: keywordRecord.score ?? null
  };

  return [
    `You are an Amazon KDP niche analyzer. Analyse the scraped Amazon Books results for keyword "${keyword}".`,
    `Raw metrics collected from the search results:`,
    JSON.stringify(facts, null, 2),
    `Top listings (sample):`,
    JSON.stringify(sample, null, 2),
    `"totalResults" is the true Amazon result count; "interestProxy" is a transparent 0-100 proxy for search interest, NOT a verified monthly-search number.`,
    `Return JSON exactly in this shape:`,
    JSON.stringify({
      oneLineRead: 'verdict sentence for an indie author',
      competitionLevel: 'low | medium | high',
      demandLevel: 'low | medium | high',
      opportunityLevel: 'low | medium | high',
      entryDifficulty: 'why it is easy/hard to rank as a new book',
      contentAngles: ['5-8 specific book angles that are underserved'],
      differentiation: ['ways to stand out from the current leaders'],
      risks: ['risks this niche carries'],
      recommendedAudience: 'who to target',
      pricePoint: 'suggested price range given competitors'
    }),
    `Be specific and actionable. Only output the JSON object.`
  ].join('\n');
}

export async function analyzeNiche({ apiKey, keyword, keywordRecord }) {
  const prompt = buildAnalysisPrompt(keyword, keywordRecord);
  return completeJson({ apiKey, prompt });
}

// ---------------------------------------------------------------------------
// 3. Listing generator: title + 7 backend keywords + description for a niche
// ---------------------------------------------------------------------------

function buildListingPrompt(niche, keywordRecord) {
  const m = keywordRecord?.metrics || {};
  const leader = (m.sample || keywordRecord?.sample || [])[0];
  return [
    `You are a KDP listing copywriter. Create a listing kit for a book in the niche "${niche}".`,
    leader
      ? `A top competitor is "${leader.title}". Do not plagiarise it.`
      : '',
    `Return JSON exactly in this shape:`,
    JSON.stringify({
      title: 'A compelling, keyword-rich book title (max 200 chars ideal)',
      subtitle: 'Catchy subtitle',
      sevenKeywords: ['exactly 7 backend search keywords, comma-optimized phrases that buyers type'],
      bulletPoints: ['3-5 sales bullets shown on the Amazon detail page'],
      description: '2-4 sentence back-cover description with keywords woven in naturally'
    }),
    `Only output the JSON object.`
  ].filter(Boolean).join('\n');
}

export async function generateListing({ apiKey, niche, keywordRecord }) {
  const prompt = buildListingPrompt(niche, keywordRecord);
  return completeJson({ apiKey, prompt });
}

// ---------------------------------------------------------------------------
// 4. Trademark & copyright screen: multi-market sweep (rules v1, rule 5)
// ---------------------------------------------------------------------------

function buildLegalPrompt(keyword, keywordRecord, markets) {
  const leader = (keywordRecord?.metrics?.sample || keywordRecord?.sample || [])[0];
  const marketList = (markets && markets.length ? markets : ['us']).join(', ').toUpperCase();
  return [
    `You are an Amazon KDP compliance advisor for indie authors. Analyze the niche "${keyword}"`,
    `for trademark and copyright problems a self-publisher could face in EACH of these marketplaces: ${marketList}.`,
    `For every market, check: registered brands used generically, movie/TV/game characters, franchise names,`,
    `celebrity names, artist/song titles, publisher brands, and phrases protected by famous marks — with special`,
    `attention to trademark Class 16 (printed matter / books), because that is the class a book title lives in.`,
    `Consider that protection is territorial: a mark may be registered in one market but not another.`,
    leader ? `A top listing in this niche is "${leader.title}".` : '',
    `Return JSON exactly in this shape:`,
    JSON.stringify({
      risk: 'overall risk: low | medium | high (worst across markets)',
      safe: true,
      verdict: 'one-sentence plain-English explanation a non-lawyer can act on',
      perMarket: {
        us: {
          risk: 'low | medium | high',
          verdict: 'one-sentence market-specific note'
        }
      },
      flagged: [
        {
          term: 'the specific word/phrase that is risky',
          type: 'trademark | copyright | celebrity | franchise | brand',
          owner: 'who you think owns the rights, if known',
          markets: ['market codes where this is risky, e.g. "us", "jp"'],
          why: 'why publishing a book on this could be a problem'
        }
      ],
      safeKeyword: 'a reworded, compliant alternative niche targeting the same buyer intent',
      notes: ['2-3 practical actions or caveats']
    }),
    `"perMarket" must contain an entry for every marketplace listed above. An empty "flagged" array means the niche looks clean. Only output the JSON object.`
  ].filter(Boolean).join('\n');
}

export async function checkTrademark({ apiKey, keyword, keywordRecord, markets }) {
  const prompt = buildLegalPrompt(keyword, keywordRecord, markets);
  const data = await completeJson({ apiKey, prompt });
  return { ...data, ai: true, keyword, markets: markets || [] };
}

// Keyless multi-market fallback (rules v1, rule 5): local famous-marks screen
// from lib/trademark-registry.js — global + per-market term lists, plus the
// registry deep links so the user can verify in official databases.
import { localTrademarkScreen } from '../lib/trademark-registry.js';

export async function localTrademarkSweep(keyword, keywordRecord, markets) {
  const leader = (keywordRecord?.metrics?.sample || keywordRecord?.sample || [])[0];
  const scan = localTrademarkScreen(keyword, markets, leader ? leader.title : '');
  scan.ai = false;
  scan.market = keywordRecord?.market || 'us';
  scan.notes = [
    'Local multi-market screen, not a legal opinion. Use the per-market registry links for official records.',
    'Configure an AI provider in Settings (Gemini key, or Zen / OpenRouter with a free model) for a thorough AI trademark and copyright review.'
  ];
  return scan;
}

// ---------------------------------------------------------------------------
// 5. Local, dependency-free fallbacks (no API key required)
// ---------------------------------------------------------------------------

function matchesSeed(seed, word) {
  const seedLow = seed.toLowerCase().trim();
  const parts = seedLow.split(/\s+/).filter(Boolean);
  const w = word.toLowerCase();
  const wParts = w.split(/\s+/).filter(Boolean);

  if (parts.length === 0) return true;
  if (w.includes(seedLow)) return true;                // exact seed inside → valid offshoot
  if (parts.length === 1) return wParts.includes(parts[0]); // single-token seed
  // multi-token: share the head token and add specificity
  const head = parts[0];
  if (!wParts.includes(head)) return false;
  const shared = parts.filter((p) => wParts.includes(p)).length;
  return shared >= Math.min(2, parts.length) || wParts.length > parts.length;
}

/**
 * Expand beyond a seed using real Amazon + Google autocomplete data.
 * Builds an "alphabet soup" style set of adjacent commercial search terms.
 */
export async function localExpandSuggestions({ amazonWords, googleWords, seed, allowFiction = true, scope = 'rule8' }) {
  const seen = new Set();
  const out = [];

  const push = (word, source) => {
    const clean = (word || '').trim().toLowerCase();
    if (!clean || seen.has(clean)) return;
    if (clean === (seed || '').trim().toLowerCase()) return;
    if (matchesSeed(seed, clean)) {
      seen.add(clean);
      out.push({ keyword: clean, source, score: computeSuggestionRelevance(clean, seed, allowFiction, scope) });
    }
  };

  (amazonWords || []).forEach((w) => push(w, 'amazon-autocomplete'));
  (googleWords || []).forEach((w) => push(w, 'google-suggest'));

  return out
    .sort((a, b) => b.score - a.score)
    .slice(0, 30);
}

/**
 * 0-1 relevance of an autocomplete term to its seed. Weighted by shared words,
 * long-tail length, and commercial-intent markers. Used to rank suggestions
 * AND to persist a per-keyword "interest proxy" weight (Phase 3).
 */
export function computeSuggestionRelevance(word, seed, allowFiction = true, scope = 'rule8') {
  const seedParts = (seed || '').toLowerCase().trim().split(/\s+/).filter(Boolean);
  const wParts = word.split(/\s+/);
  const shared = wParts.filter((p) => seedParts.includes(p)).length;
  const seedPenalty = shared / (seedParts.length || 1);

  let score = 0.5 + seedPenalty * 0.5;
  if (wParts.length >= 3 && wParts.length <= 6) score += 0.25;
  if (wParts.length > 7) score -= 0.2;
  if (/free|pdf|download|printable/i.test(word)) score -= 0.15; // low-commercial intent books

  // Phase 1.5: deprioritize high-content suggestions an indie cannot produce.
  // In strict scope only blank-interior families survive, so give the
  // confirmed low-content families the bonus and push everything else down.
  const ct = classifyContentType({ keyword: word, allowFiction, scope });
  if (ct.contentType === 'high-content-excluded') score -= 0.35;
  else if (ct.contentType === 'low-content') score += 0.15;
  else if (ct.contentType !== 'unknown') score += 0.05;

  // Revision 2: explicit tells the classifier's phrase list can miss when the
  // token is glued to punctuation/case the signals don't cover. Fiction-word
  // penalties are left to the classifier so allowed narrow-fiction niches
  // aren't double-penalized.
  if (/\b(clinical|diagnos|patholog|textbook|dissertation|thesis)\w*/i.test(word)) score -= 0.1;
  if (/\b(m\.?d\.?|ph\.?d\.?|esq\.?|m d|ph d)\b/i.test(word)) score -= 0.1;

  if (/book|cookbook|guide|workbook|journal|planner|for\s+\w+/i.test(word)) score += 0.1;
  return Math.max(0.1, Math.min(1.2, score));
}