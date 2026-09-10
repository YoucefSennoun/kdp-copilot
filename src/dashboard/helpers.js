export const fmt = {
  num(n, digits) {
    if (n == null || Number.isNaN(Number(n))) return '—';
    return Number(n).toLocaleString(undefined, { maximumFractionDigits: digits ?? 0 });
  },

  compact(n) {
    if (n == null || Number.isNaN(Number(n))) return '—';
    n = Number(n);
    if (Math.abs(n) >= 1e6) return `${(n / 1e6).toFixed(1)}M`;
    if (Math.abs(n) >= 1e3) return `${(n / 1e3).toFixed(1)}k`;
    return `${n}`;
  },

  score(n) {
    return n == null ? '—' : `${n}`;
  },

  sales(n) {
    if (n == null) return '—';
    if (n >= 1000) return `≈${this.compact(Math.round(n / 50) * 50)}/mo`;
    return `≈${Math.round(n)}/mo`;
  },

  pct(x) {
    if (x == null || Number.isNaN(Number(x))) return '—';
    return `${Math.round(Number(x) * 100)}%`;
  },

  date(ts) {
    if (!ts) return '—';
    const d = new Date(ts);
    if (Number.isNaN(d.getTime())) return '—';
    return d.toLocaleDateString(undefined, { day: '2-digit', month: 'short' });
  },

  time(ts) {
    if (!ts) return '—';
    const d = new Date(ts);
    if (Number.isNaN(d.getTime())) return '—';
    return d.toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' });
  },

  datetime(ts) {
    if (!ts) return '—';
    const d = new Date(ts);
    if (Number.isNaN(d.getTime())) return '—';
    return `${d.toLocaleDateString(undefined, { day: '2-digit', month: 'short' })} ${d.toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' })}`;
  }
};

export function toneClass(score) {
  if (score == null) return 'tone-muted';
  if (score >= 70) return 'tone-excellent';
  if (score >= 50) return 'tone-good';
  if (score >= 30) return 'tone-fair';
  return 'tone-poor';
}

export function verdictChip(record) {
  let v = null;
  if (record && record.qualifies) v = record.qualifies;
  else if (record && typeof record.qualifies === 'boolean') v = { all: record.qualifies };
  if (!v) return '<span class="muted">—</span>';

  const agreed = v.all ? 'yes' : 'no';
  const chips = [
    v.fresh != null ? `<span class="qual-chip ${v.fresh ? 'qual-ok' : 'qual-bad'}" title="New (<6mo) + selling + unbranded competitors">NEW</span>` : '',
    v.bsrOverall != null ? `<span class="qual-chip ${v.bsrOverall ? 'qual-ok' : 'qual-bad'}" title="Overall Books BSR ≤ threshold">BSR</span>` : '',
    `<span class="qual-chip ${v.listings ? 'qual-ok' : 'qual-bad'}" title="Total results ≤ market cap (US 1000 / others 800)">LIST</span>`,
    `<span class="qual-chip ${v.volume ? 'qual-ok' : 'qual-bad'}" title="Interest proxy ≥ threshold">VOL</span>`,
    v.brand === false ? '<span class="qual-chip qual-bad" title="Big-brand book in sample">BRAND</span>' : '',
    `<span class="muted" style="margin-left:2px;font-size:.7rem;">${agreed}</span>`
  ];
  return chips.filter(Boolean).join(' ');
}

export function directParentKeyword(record) {
  return (record && record.expandedFrom) || null;
}

export async function send(type, payload) {
  const res = await chrome.runtime.sendMessage({ type, payload });
  if (res && res.ok) return res.result;
  throw new Error((res && res.error) || `Message ${type} failed`);
}

export function showStatus(el, text, isError) {
  el.textContent = text || '';
  el.classList.toggle('muted', !isError);
  el.style.color = isError ? '#e53935' : '';
}

export function escapeHtml(str) {
  return String(str ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

export function debounce(fn, ms) {
  let t;
  return (...args) => {
    clearTimeout(t);
    t = setTimeout(() => fn(...args), ms);
  };
}

export function totalResultsLabel(record) {
  const m = (record && record.metrics) || {};
  if (m.totalResultsCount == null) {
    const count = Array.isArray(m.sample) ? m.sample.length : null;
    return count == null ? '—' : fmt.num(count) + ' scraped';
  }
  const approx = m.resultsCountIsApprox ? '≈' : '';
  return `${approx}${fmt.compact(m.totalResultsCount)}`;
}

export function bsrLabel(record) {
  const m = (record && record.metrics) || {};
  if (m.bestSubcategoryBsr != null) {
    const cat = m.bestSubcategoryBsrCategory ? ` (${m.bestSubcategoryBsrCategory})` : '';
    return { text: `#${fmt.num(m.bestSubcategoryBsr)}${cat}`, tone: toneClassBestBsr(m.bestSubcategoryBsr) };
  }
  if (Array.isArray(m.bsrSamples) && m.bsrSamples.length) {
    const ranks = m.bsrSamples.map((s) => s.bsr).filter((x) => x != null);
    if (ranks.length) {
      const median = [...ranks].sort((a, b) => a - b)[Math.floor(ranks.length / 2)];
      return { text: `#${fmt.num(median)}*`, tone: toneClassBestBsr(median) };
    }
  }
  return { text: '—', tone: 'tone-muted' };
}

function toneClassBestBsr(bsr) {
  if (bsr == null) return 'tone-muted';
  if (bsr <= 100) return 'tone-excellent';
  if (bsr <= 300) return 'tone-good';
  if (bsr <= 1000) return 'tone-fair';
  return 'tone-poor';
}

export function qualifiesCell(record) {
  const v = record && record.qualifies;
  if (!v) return '<span class="muted">—</span>';
  return verdictChip(record);
}

/**
 * KDP-publishable content-type chip. Renders empty for missing/unknown, a
 * red-tinted chip for excluded types, and a neutral chip otherwise.
 */
export function contentChip(record) {
  const m = (record && record.metrics) || {};
  if (!m.contentType || m.contentType === 'unknown') return '';
  const label = escapeHtml(m.contentTypeLabel || m.contentType);
  if (m.contentType === 'high-content-excluded' || m.requiresExpertise) {
    const source = escapeHtml(m.contentTypeSource || '');
    return `<span class="chip chip-bad" title="Excluded: ${source}">${label}</span>`;
  }
  const source = escapeHtml(m.contentTypeSource ? ` (${m.contentTypeSource})` : '');
  return `<span class="chip" title="${escapeHtml(m.contentType)}${source}">${label}</span>`;
}