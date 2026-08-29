const ENDPOINT = 'https://generativelanguage.googleapis.com/v1beta/models';
const DEFAULT_MODEL = 'gemini-3.6-flash';
const MAX_OUTPUT_TOKENS = 4096;

export const MODEL_CHOICES = [
  { id: 'gemini-3.6-flash', label: 'Gemini 3.6 Flash (fast, cheap)' },
  { id: 'gemini-3.6-flash-lite', label: 'Gemini 3.6 Flash-Lite (cheapest)' },
  { id: 'gemini-2.5-flash', label: 'Gemini 2.5 Flash (previous gen)' },
  { id: 'gemini-2.5-pro', label: 'Gemini 2.5 Pro (highest quality)' },
  { id: 'gemini-1.5-flash', label: 'Gemini 1.5 Flash (legacy)' }
];

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
    `propose ${count} ADJACENT, low-to-mid competition book niches an independent author can actually win.`,
    `Prefer long-tail keywords with real buyer intent over broad head terms.`,
    `Return JSON exactly in this shape:`,
    JSON.stringify({
      niches: [
        {
          keyword: 'long tail keyword phrase',
          category: 'Amazon book category this maps to',
          formats: ['paperback', 'kindle'],
          why: 'one sentence on why this niche is winnable',
          titleIdea: 'a marketable book title that hits this keyword',
          demandSignal: 'low | medium | high'
        }
      ]
    }),
    `Only output the JSON object.`
  ].join('\n');
}

export async function expandNicheSeeds({ apiKey, seed, market, count = 10 }) {
  const prompt = buildExpansionPrompt(seed, market, count);
  const data = await callGemini({ apiKey, prompt });
  const niches = Array.isArray(data) ? data : data?.niches;
  if (!Array.isArray(niches)) throw new Error('Model response missing "niches" array.');
  return niches.slice(0, count);
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
    listings: m.listingCount ?? null,
    avgPrice: m.avgPrice ?? null,
    priceRange: [m.lowPrice ?? null, m.highPrice ?? null],
    totalReviews: m.totalReviews ?? null,
    avgRating: m.avgRating ?? null,
    medianBsr: m.medianRank ?? m.avgBsr ?? null,
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
// 4. Local, dependency-free fallbacks (no API key required)
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
export async function localExpandSuggestions({ amazonWords, googleWords, seed }) {
  const seen = new Set();
  const out = [];

  const push = (word, source) => {
    const clean = (word || '').trim().toLowerCase();
    if (!clean || seen.has(clean)) return;
    if (clean === (seed || '').trim().toLowerCase()) return;
    if (matchesSeed(seed, clean)) {
      seen.add(clean);
      out.push({ keyword: clean, source, score: computeSuggestionRelevance(clean, seed) });
    }
  };

  (amazonWords || []).forEach((w) => push(w, 'amazon-autocomplete'));
  (googleWords || []).forEach((w) => push(w, 'google-suggest'));

  return out
    .sort((a, b) => b.score - a.score)
    .slice(0, 30);
}

function computeSuggestionRelevance(word, seed) {
  const seedParts = (seed || '').toLowerCase().trim().split(/\s+/).filter(Boolean);
  const wParts = word.split(/\s+/);
  const shared = wParts.filter((p) => seedParts.includes(p)).length;
  const seedPenalty = shared / (seedParts.length || 1);

  let score = 0.5 + seedPenalty * 0.5;
  if (wParts.length >= 3 && wParts.length <= 6) score += 0.25;
  if (wParts.length > 7) score -= 0.2;
  if (/free|pdf|download|printable/i.test(word)) score -= 0.15; // low-commercial intent books
  if (/book|cookbook|guide|workbook|journal|planner|for\s+\w+/i.test(word)) score += 0.1;
  return Math.max(0.1, Math.min(1.2, score));
}