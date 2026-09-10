/**
 * Locale-aware publication-date parser (rules v1, rule 1).
 *
 * Amazon product pages render "Publication date" in the marketplace's locale
 * ("March 3, 2026" on .com, "3 mars 2026" on .fr, "2026年3月3日" on .co.jp…).
 * A naive Date.parse fails on most non-English locales, so this module knows
 * the month names for every market language the extension ships (en, en-GB,
 * de, fr, it, es, ja, pt) plus pure-ISO and year-only fallbacks.
 *
 * Pure module: no chrome APIs, safe to unit-test.
 */

const MONTHS = {
  en: ['january', 'february', 'march', 'april', 'may', 'june', 'july',
    'august', 'september', 'october', 'november', 'december'],
  de: ['januar', 'februar', 'märz', 'april', 'mai', 'juni', 'juli',
    'august', 'september', 'oktober', 'november', 'dezember'],
  fr: ['janvier', 'février', 'mars', 'avril', 'mai', 'juin',
    'juillet', 'août', 'septembre', 'octobre', 'novembre', 'décembre'],
  it: ['gennaio', 'febbraio', 'marzo', 'aprile', 'maggio', 'giugno', 'luglio',
    'agosto', 'settembre', 'ottobre', 'novembre', 'dicembre'],
  es: ['enero', 'febrero', 'marzo', 'abril', 'mayo', 'junio', 'julio',
    'agosto', 'septiembre', 'octubre', 'noviembre', 'diciembre'],
  pt: ['janeiro', 'fevereiro', 'março', 'abril', 'maio', 'junho', 'julho',
    'agosto', 'setembro', 'outubro', 'novembro', 'dezembro'],
  ja: ['1月', '2月', '3月', '4月', '5月', '6月', '7月', '8月', '9月', '10月', '11月', '12月']
};

// Accented variants map to their canonical month (index 0-11) — the parser
// normalizes these before lookup so duplicates never shift indices.
const MONTH_VARIANTS = {
  'maerz': 'märz', 'fevrier': 'février', 'aout': 'août', 'decembre': 'décembre',
  'marco': 'março', 'setiembre': 'septiembre', 'septembro': 'setembro'
};

/** Market code → primary month-name language. */
const MARKET_LANG = {
  us: 'en', uk: 'en', ca: 'en', au: 'en',
  de: 'de', fr: 'fr', it: 'it', es: 'es', mx: 'es',
  jp: 'ja', br: 'pt'
};

function monthIndexForToken(token) {
  const raw = String(token || '').toLowerCase().replace(/\./g, '').trim();
  const t = MONTH_VARIANTS[raw] || raw;
  for (const lang of Object.keys(MONTHS)) {
    const idx = MONTHS[lang].indexOf(t);
    if (idx !== -1) return [lang, idx];
  }
  return [null, null];
}

/** Strip Spanish/Portuguese "de"/"del" separators: "3 de marzo de 2026". */
function cleanMonthExpression(raw) {
  return String(raw || '')
    .replace(/\s+[dz]e[l]?\s+/gi, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

/**
 * Parse an Amazon "Publication date" string into a UTC epoch (ms) or null.
 * Handles:
 *   - "March 3, 2026" / "3 mars 2026" / "3. März 2026" / "2026年3月3日"
 *   - "03/03/2026" (assume day/month/year — Amazon's non-US convention)
 *   - "2026-03-03" (ISO)
 *   - "2026" (year only — Jan 1)
 * @param {string} text - raw publication-date string
 * @param {string} [marketCode] - marketplace code, used to prefer a locale
 */
export function parsePubDate(text, marketCode) {
  const rawOriginal = String(text || '').trim();
  if (!rawOriginal) return null;
  // "3 de marzo de 2026" → "3 marzo 2026" (de/del separators removed)
  const raw = cleanMonthExpression(rawOriginal);

  const lang = MARKET_LANG[(marketCode || '').toLowerCase()] || 'en';

  // ISO first: yyyy-mm-dd
  const iso = raw.match(/(\d{4})-(\d{1,2})-(\d{1,2})/);
  if (iso) return epochUtc(+iso[1], +iso[2], +iso[3]);

  // Japanese: yyyy年m月d日
  const jp = raw.match(/(\d{4})年\s*(\d{1,2})月\s*(\d{1,2})日/);
  if (jp) return epochUtc(+jp[1], +jp[2], +jp[3]);

  // Month-name forms: "March 3, 2026" | "3 mars 2026" | "3. März 2026"
  const monthName = raw.match(/([A-Za-zÀ-ÿ\u3000-\u30ff]+)\.?\s*(\d{1,2})\s*(?:st|nd|rd|th)?\s*,?\s*(\d{4})|(\d{1,2})\s*\.?\s*([A-Za-zÀ-ÿ]+)\.?\s*(\d{4})/);
  if (monthName) {
    const token = monthName[1] || monthName[5];
    const day = monthName[2] || monthName[4];
    const year = monthName[3] || monthName[6];
    const [, idx] = monthIndexForToken(token);
    if (idx != null) return epochUtc(+year, idx + 1, +day);
  }

  // Numeric d/m/yyyy or m/d/yyyy — prefer locale convention
  const num = raw.match(/(\d{1,2})[/.](\d{1,2})[/.](\d{4})/);
  if (num) {
    const a = +num[1], b = +num[2], y = +num[3];
    // Non-US markets: day first. US/CA/AU: month first.
    const monthFirst = ['us', 'ca', 'au'].includes((marketCode || '').toLowerCase());
    const m = monthFirst ? a : b;
    const d = monthFirst ? b : a;
    return epochUtc(y, m, d);
  }

  // Year-only fallback
  const yearOnly = raw.match(/^(\d{4})$/);
  if (yearOnly) return epochUtc(+yearOnly[1], 1, 1);

  // Last resort: native parser
  const native = Date.parse(raw);
  return Number.isNaN(native) ? null : native;
}

function epochUtc(year, month, day) {
  if (month < 1 || month > 12 || day < 1 || day > 31) return null;
  return Date.UTC(year, month - 1, day);
}

/** True when `pubDateEpoch` is within `months` of now (rule 1 freshness). */
export function isFreshPub(pubDateEpoch, months = 6, now = Date.now()) {
  if (pubDateEpoch == null) return false;
  const cutoff = now - months * 30.44 * 24 * 60 * 60 * 1000;
  return pubDateEpoch >= cutoff;
}

/** Days between two epochs (positive = newer). */
export function daysBetween(newerEpoch, olderEpoch) {
  if (newerEpoch == null || olderEpoch == null) return null;
  return (newerEpoch - olderEpoch) / (24 * 60 * 60 * 1000);
}
