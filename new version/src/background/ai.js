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

export async function fetchModelChoices() {
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

function buildExpansionPrompt(seed, market, count) {
  return [
    `Act as a senior Amazon KDP (Kindle Direct Publishing) niche research strategist.`,
    `Given the seed niche "${seed}" for the ${market.label} Amazon marketplace,`,
    `propose ${count} ADJACENT, low-to-mid competition book niches an independent publisher can ACTUALLY produce.`,
    `ONLY propose niches whose physical book an indie can create without specialist credentials or years of writing:`,
    `- low-content: journals, diaries, planners, notebooks, logbooks, trackers, calendars, gratitude/prompt books, guest books`,
    `- medium-content: coloring books, activity books, puzzle books (crosswords, word search, sudoku, mazes), workbooks, practice/handwriting books, flash cards`,
    `- personalized/name-variant books (e.g. "for a girl named…")`,
    `- researched-and-compiled guides: checklists, templates, curated how-to compilations, recipe collections, beginner guides a layperson can compile`,
    `- NARROW FICTION niches (optional): only when the niche names a specific sub-genre AND a concrete audience/setting (e.g. "cozy mysteries for seniors", "chapter books for girls 6-8", "sci-fi romance for adults"). Generic "novels", "romance", "fiction" broad terms are NEVER acceptable.`,
    `NEVER propose memoirs, biographies, essays, short-story anthologies, poetry, or expertise-required textbooks/clinical/scientific/legal/academic works.`,
    `Never propose books whose subject is BECOMING a writer or self-publishing (e.g. "how to write a book", "book marketing for authors") -- those sell to authors, not to niche buyers. A planner/journal/workbook FOR that audience is fine ("novel writing planner").`,
    `A health-adjacent niche is allowed ONLY in its compiled/lay form (e.g. "diabetes-friendly recipes", "first-trimester guide") -- never clinical reference material.`,
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
          contentType: 'low-content | medium-content | personalized | guide | fiction-niche',
          isExistingTitle: false
        }
      ]
    }),
    `Only output the JSON object.`
  ].join('\n');
}

export async function expandNicheSeeds({ apiKey, seed, market, count = 10, allowFiction = true }) {
  const prompt = buildExpansionPrompt(seed, market, count);
  const data = await callGemini({ apiKey, prompt });
  const niches = Array.isArray(data) ? data : data?.niches;
  if (!Array.isArray(niches)) throw new Error('Model response missing "niches" array.');
  return niches
    .filter((s) => isSuggestibleSuggestion(s, { allowFiction }))
    .slice(0, count);
}

/**
 * Synchronous gate right after generation (Revision 2, Gap F / Bug 1).
 * Rejects suggestions the model itself flagged as existing titles, engine
 * suggestions that trip the high-content classifier, and phrasing tells that
 * indicate a real book ("by <Author>", "bestseller", "classic").
 */
export function isSuggestibleSuggestion(s = {}, { allowFiction = true } = {}) {
  if (s.isExistingTitle === true) return false;

  const keyword = String(s.keyword || '').trim();
  const titleIdea = String(s.titleIdea || '').trim();
  const ct = classifyContentType({ keyword: `${keyword} ${titleIdea}`.trim(), allowFiction });
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
  return callGemini({ apiKey, prompt });
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
  return callGemini({ apiKey, prompt });
}

// ---------------------------------------------------------------------------
// 4. Trademark & copyright screen: does this niche collide with protected IP?
// ---------------------------------------------------------------------------

function buildLegalPrompt(keyword, keywordRecord) {
  const leader = (keywordRecord?.metrics?.sample || keywordRecord?.sample || [])[0];
  return [
    `You are an Amazon KDP compliance advisor for indie authors. Analyze the niche "${keyword}"`,
    `for potential US trademark and copyright problems a self-publisher could face.`,
    `Look for: registered brands used generically, movie/TV/game characters, franchise names,`,
    `celebrity names, artist/song titles, publisher brands, or phrases protected by famous marks.`,
    leader ? `A top listing in this niche is "${leader.title}".` : '',
    `Return JSON exactly in this shape:`,
    JSON.stringify({
      risk: 'low | medium | high',
      safe: true,
      verdict: 'one-sentence plain-English explanation a non-lawyer can act on',
      flagged: [
        {
          term: 'the specific word/phrase that is risky',
          type: 'trademark | copyright | celebrity | franchise | brand',
          owner: 'who you think owns the rights, if known',
          why: 'why publishing a book on this could be a problem'
        }
      ],
      safeKeyword: 'a reworded, compliant alternative niche targeting the same buyer intent',
      notes: ['2-3 practical actions or caveats']
    }),
    `An empty "flagged" array means the niche looks clean. Only output the JSON object.`
  ].filter(Boolean).join('\n');
}

export async function checkTrademark({ apiKey, keyword, keywordRecord }) {
  const prompt = buildLegalPrompt(keyword, keywordRecord);
  const data = await callGemini({ apiKey, prompt });
  return { ...data, ai: true, keyword };
}

// Keyless fallback: a small, conservative list of widely protected terms.
// NOT a legal database — it only catches obvious collisions.
const PROTECTED_TERMS = [
  { term: 'disney', type: 'trademark', owner: 'The Walt Disney Company' },
  { term: 'pixar', type: 'trademark', owner: 'Pixar / Disney' },
  { term: 'marvel', type: 'trademark', owner: 'Marvel Entertainment' },
  { term: 'dc comics', type: 'trademark', owner: 'DC Comics' },
  { term: 'harry potter', type: 'trademark', owner: 'J.K. Rowling / Warner Bros.' },
  { term: 'pokemon', type: 'trademark', owner: 'The Pokémon Company' },
  { term: 'star wars', type: 'trademark', owner: 'Lucasfilm / Disney' },
  { term: 'star trek', type: 'trademark', owner: 'Paramount' },
  { term: 'lego', type: 'trademark', owner: 'LEGO Group' },
  { term: 'barbie', type: 'trademark', owner: 'Mattel' },
  { term: 'netflix', type: 'trademark', owner: 'Netflix Inc.' },
  { term: 'nike', type: 'trademark', owner: 'Nike Inc.' },
  { term: 'adidas', type: 'trademark', owner: 'adidas AG' },
  { term: 'coca-cola', type: 'trademark', owner: 'The Coca-Cola Company' },
  { term: 'mcdonald', type: 'trademark', owner: 'McDonald\'s Corp.' },
  { term: 'starbucks', type: 'trademark', owner: 'Starbucks Corp.' },
  { term: 'apple', type: 'trademark', owner: 'Apple Inc.' },
  { term: 'google', type: 'trademark', owner: 'Google LLC' },
  { term: 'microsoft', type: 'trademark', owner: 'Microsoft Corp.' },
  { term: 'amazon prime', type: 'trademark', owner: 'Amazon.com Inc.' },
  { term: 'game of thrones', type: 'copyright', owner: 'George R.R. Martin / HBO' },
  { term: 'lord of the rings', type: 'trademark', owner: 'The Tolkien Estate / Middle-earth Enterprises' },
  { term: 'the hobbit', type: 'trademark', owner: 'The Tolkien Estate' },
  { term: 'sherlock holmes', type: 'copyright', owner: 'Conan Doyle Estate (US, until 2049)' },
  { term: 'doctor who', type: 'trademark', owner: 'BBC' },
  { term: 'halo', type: 'trademark', owner: 'Microsoft / 343 Industries' },
  { term: 'minecraft', type: 'trademark', owner: 'Mojang / Microsoft' },
  { term: 'fortnite', type: 'trademark', owner: 'Epic Games' },
  { term: 'roblox', type: 'trademark', owner: 'Roblox Corp.' },
  { term: 'mario', type: 'trademark', owner: 'Nintendo' },
  { term: 'zelda', type: 'trademark', owner: 'Nintendo' },
  { term: 'super mario', type: 'trademark', owner: 'Nintendo' },
  { term: 'sonic the hedgehog', type: 'trademark', owner: 'Sega' },
  { term: 'peppa pig', type: 'trademark', owner: 'Hasbro / Entertainment One' },
  { term: 'bluey', type: 'trademark', owner: 'BBC Studios' },
  { term: 'paw patrol', type: 'trademark', owner: 'Spin Master / Nickelodeon' },
  { term: 'elsa', type: 'trademark', owner: 'Disney (Frozen)' },
  { term: 'frozen', type: 'trademark', owner: 'Disney' },
  { term: 'spiderman', type: 'trademark', owner: 'Marvel / Sony' },
  { term: 'batman', type: 'trademark', owner: 'DC / Warner Bros.' },
  { term: 'superman', type: 'trademark', owner: 'DC / Warner Bros.' },
  { term: 'wonka', type: 'trademark', owner: 'Roald Dahl Estate / Warner Bros.' },
  { term: 'dr. seuss', type: 'trademark', owner: 'Dr. Seuss Enterprises' },
  { term: 'eric carle', type: 'copyright', owner: 'Eric Carle Estate' },
  { term: 'cocomelon', type: 'trademark', owner: 'Moonbug Entertainment' },
  { term: 'kanye', type: 'celebrity', owner: 'Kanye West' },
  { term: 'taylor swift', type: 'celebrity', owner: 'Taylor Swift' },
  { term: 'beyonce', type: 'celebrity', owner: 'Beyoncé Knowles-Carter' },
  { term: 'rihanna', type: 'celebrity', owner: 'Rihanna' },
  { term: 'the beatles', type: 'trademark', owner: 'Apple Corps / Sony' }
];

export async function localTrademarkSweep(keyword, keywordRecord) {
  const text = `${keywordRecord?.title || keyword} ${keywordRecord?.description || ''} ${keyword}`.toLowerCase();
  const flagged = PROTECTED_TERMS.filter((p) => text.includes(p.term))
    .map((p) => ({ term: p.term, type: p.type, owner: p.owner, why: `The niche contains the protected name "${p.term}".` }))
    .slice(0, 8);

  if (flagged.length) {
    return {
      keyword,
      ai: false,
      risk: flagged.length > 2 ? 'high' : 'medium',
      safe: false,
      verdict: `Heuristic screen (no API key): flagged ${flagged.length} protected term${flagged.length === 1 ? '' : 's'}. Verify with a trademark attorney before publishing.`,
      flagged,
      safeKeyword: keyword,
      notes: ['This is a local keyword-match check, not a legal opinion. Add your Gemini API key for a full AI review.']
    };
  }
  return {
    keyword,
    ai: false,
    risk: 'low',
    safe: true,
    verdict: 'Heuristic screen (no API key): no common protected terms found in the keyword. Review with AI for complete safety.',
    flagged: [],
    safeKeyword: keyword,
    notes: ['Add your Gemini API key in Settings for a thorough AI trademark and copyright review.']
  };
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
export async function localExpandSuggestions({ amazonWords, googleWords, seed, allowFiction = true }) {
  const seen = new Set();
  const out = [];

  const push = (word, source) => {
    const clean = (word || '').trim().toLowerCase();
    if (!clean || seen.has(clean)) return;
    if (clean === (seed || '').trim().toLowerCase()) return;
    if (matchesSeed(seed, clean)) {
      seen.add(clean);
      out.push({ keyword: clean, source, score: computeSuggestionRelevance(clean, seed, allowFiction) });
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
export function computeSuggestionRelevance(word, seed, allowFiction = true) {
  const seedParts = (seed || '').toLowerCase().trim().split(/\s+/).filter(Boolean);
  const wParts = word.split(/\s+/);
  const shared = wParts.filter((p) => seedParts.includes(p)).length;
  const seedPenalty = shared / (seedParts.length || 1);

  let score = 0.5 + seedPenalty * 0.5;
  if (wParts.length >= 3 && wParts.length <= 6) score += 0.25;
  if (wParts.length > 7) score -= 0.2;
  if (/free|pdf|download|printable/i.test(word)) score -= 0.15; // low-commercial intent books

  // Phase 1.5: deprioritize high-content suggestions (novels, clinical texts,
  // academic works) an indie cannot produce; slightly reward the ones we can.
  // Narrow-fiction niches count as publishable when allowed.
  const ct = classifyContentType({ keyword: word, allowFiction });
  if (ct.contentType === 'high-content-excluded') score -= 0.35;
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