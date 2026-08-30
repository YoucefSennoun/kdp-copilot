import { loadDetailView } from './detail.js';
import { populateMarketSelects } from './../app.js';

let rows = [];
let sortField = 'score';
let sortDir = 'desc';
let loadedMarket = null;

export { updateQueueBar };

export function loadExplorerView() {
  populateMarketSelects();

  const marketSelect = document.getElementById('market-select');
  const seedInput = document.getElementById('seed-input');

  if (!marketSelect.dataset.bound) {
    marketSelect.addEventListener('change', () => {
      loadedMarket = marketSelect.value;
      refresh();
    });
    document.getElementById('go-btn').onclick = () => handleExpand(seedInput.value);
    document.getElementById('suggest-btn').onclick = () => handleFetchSuggestions(seedInput.value);
    document.getElementById('scrape-all-btn').onclick = handleScrapeAll;
    document.getElementById('export-btn').onclick = exportCsv;
    document.getElementById('refresh-btn').onclick = refresh;
    document.getElementById('start-over-btn').onclick = startOver;
    document.getElementById('pause-btn').onclick = () => {
      const btn = document.getElementById('pause-btn');
      if (btn.dataset.paused === 'true') {
        chrome.runtime.sendMessage({ type: 'RESUME_QUEUE' });
        btn.textContent = 'Pause';
        btn.dataset.paused = '';
      } else {
        chrome.runtime.sendMessage({ type: 'PAUSE_QUEUE' });
        btn.textContent = 'Resume';
        btn.dataset.paused = 'true';
      }
    };
    seedInput.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') handleExpand(seedInput.value);
    });
    marketSelect.dataset.bound = 'true';
  }

  document.querySelectorAll('th.sortable').forEach((th) => {
    th.onclick = () => {
      const field = th.dataset.sort;
      if (sortField === field) {
        sortDir = sortDir === 'desc' ? 'asc' : 'desc';
      } else {
        sortField = field;
        sortDir = 'desc';
      }
      render();
    };
  });

  refresh();
}

async function refresh() {
  setStatus('Loading…');
  try {
    const res = await chrome.runtime.sendMessage({ type: 'GET_KEYWORDS' });
    if (!res.ok) throw new Error(res.error);
    rows = res.result || [];
    const settingsRes = await chrome.runtime.sendMessage({ type: 'GET_SETTINGS' });
    if (settingsRes.ok) {
      loadedMarket = loadedMarket || settingsRes.result.market || 'us';
      if (document.getElementById('market-select').value !== loadedMarket) {
        document.getElementById('market-select').value = loadedMarket;
      }
    }
    render();
    setStatus(`Loaded ${rows.length} keyword${rows.length === 1 ? '' : 's'}.`);
    refreshQueueBar();
  } catch (err) {
    setStatus(`Error: ${err.message}`);
  }
}

async function refreshQueueBar() {
  const res = await chrome.runtime.sendMessage({ type: 'QUEUE_STATUS' });
  if (res.ok) updateQueueBar(res.result);
}

function updateQueueBar(q) {
  if (!q) return;
  const el = document.getElementById('queue-status');
  const fill = document.getElementById('queue-fill');
  const total = q.completed + q.failed + q.size;
  const pct = total ? Math.round(((q.completed + q.failed) / total) * 100) : 0;
  el.textContent = q.running
    ? `Scraping… ${q.pending} open tab${q.pending === 1 ? '' : 's'}, ${q.size} queued, ${q.completed} done, ${q.failed} failed`
    : q.idle
      ? `Idle — ${q.completed} scraped, ${q.failed} failed`
      : `Paused — ${q.size} queued, ${q.completed} done`;
  fill.style.width = `${pct}%`;
  const btn = document.getElementById('pause-btn');
  if (btn) btn.textContent = q.paused ? 'Resume' : 'Pause';
  if (q.idle) render();
}

function setStatus(text) {
  document.getElementById('status').textContent = text;
}

function render() {
  const filterMarket = document.getElementById('market-select').value;
  const visible = loadedMarket || filterMarket
    ? rows.filter((r) => (loadedMarket ? r.market === loadedMarket : r.market === filterMarket))
    : rows;

  const sorted = [...visible].sort((a, b) => {
    const av = a[sortField] ?? 0;
    const bv = b[sortField] ?? 0;
    if (sortField === 'scrapedAt') return sortDir === 'desc' ? (av || 0) - (bv || 0) : (bv || 0) - (av || 0);
    return sortDir === 'desc' ? bv - av : av - bv;
  });

  const body = document.getElementById('keywords-body');

  if (!sorted.length) {
    body.innerHTML = '<tr><td colspan="10" class="muted">No keywords for this market yet. Expand a seed or browse Amazon.</td></tr>';
    return;
  }

  body.innerHTML = sorted
    .map((r) => {
      const ver = r.verdict || {};
      return `<tr>
        <td>${escapeHtml(r.keyword)}</td>
        <td class="muted">${escapeHtml((r.market || 'us').toUpperCase())}</td>
        <td class="score-badge">${fmt(r.score)}</td>
        <td>${fmtPct(r.demand)}</td>
        <td>${fmtPct(r.competition)}</td>
        <td>${fmtPct(r.margin)}</td>
        <td>${fmtPct(r.confidence)}</td>
        <td>${fmtSales(r.estimatedMonthlySales)}</td>
        <td class="muted">${fmtDate(r.scrapedAt)}</td>
        <td>
          <button data-action="detail" data-keyword="${escapeAttr(r.keyword)}" class="secondary outline">Detail</button>
          <button data-action="ai" data-keyword="${escapeAttr(r.keyword)}" class="secondary outline">AI</button>
          <button data-action="delete" data-keyword="${escapeAttr(r.keyword)}" class="secondary outline">Delete</button>
        </td>
      </tr>`;
    })
    .join('');

  body.querySelectorAll('[data-action="detail"]').forEach((btn) => {
    btn.onclick = () => showDetail(btn.dataset.keyword);
  });
  body.querySelectorAll('[data-action="ai"]').forEach((btn) => {
    btn.onclick = () => handleAi(btn.dataset.keyword);
  });
  body.querySelectorAll('[data-action="delete"]').forEach((btn) => {
    btn.onclick = () => removeKeyword(btn.dataset.keyword);
  });
}

async function showDetail(keyword) {
  const res = await chrome.runtime.sendMessage({ type: 'GET_KEYWORD', keyword });
  if (!res.ok || !res.result) return setStatus(`Error: ${res.error || 'not found'}`);
  await loadDetailView(res.result);
}

async function handleAi(keyword) {
  setStatus(`Analyzing "${keyword}" with Gemini…`);
  try {
    const res = await chrome.runtime.sendMessage({ type: 'ANALYZE_NICHE', keyword });
    if (!res.ok) {
      setStatus(`AI error: ${res.error}`);
      return;
    }
    setStatus('AI analysis saved.');
    showDetail(keyword);
  } catch (err) {
    setStatus(`AI error: ${err.message}`);
  }
}

async function handleExpand(seed) {
  if (!seed || !seed.trim()) return setStatus('Enter a seed keyword first.');
  const market = document.getElementById('market-select').value;
  setStatus(`Expanding "${seed}" (${market.toUpperCase()})…`);
  try {
    const res = await chrome.runtime.sendMessage({ type: 'EXPAND_SEED', seed: seed.trim(), market });
    if (!res.ok) throw new Error(res.error);
    setStatus(`Got ${res.result.count} suggestions. Auto-scraping starting — check the progress bar.`);
    refresh();
  } catch (err) {
    setStatus(`Error: ${err.message}`);
  }
}

async function handleFetchSuggestions(seed) {
  if (!seed || !seed.trim()) return setStatus('Enter a keyword to pull suggestions for.');
  const market = document.getElementById('market-select').value;
  setStatus(`Fetching Amazon & Google suggestions for "${seed}"…`);
  try {
    const res = await chrome.runtime.sendMessage({
      type: 'FETCH_SUGGESTIONS',
      seed: seed.trim(),
      market
    });
    if (!res.ok) throw new Error(res.error);
    const { amazon, google } = res.result;
    await chrome.runtime.sendMessage({
      type: 'SCRAPE_KEYWORD',
      payload: { keyword: seed.trim(), market }
    });
    setStatus(`Got ${amazon.length} Amazon + ${google.length} Google suggestions.`);
  } catch (err) {
    setStatus(`Error: ${err.message}`);
  }
}

async function handleScrapeAll() {
  const market = document.getElementById('market-select').value;
  setStatus('Queueing unscraped keywords…');
  try {
    const res = await chrome.runtime.sendMessage({
      type: 'SCRAPE_ALL',
      filter: { market }
    });
    if (!res.ok) throw new Error(res.error);
    setStatus(`Queued ${res.result.count} keywords for scraping.`);
    refreshQueueBar();
  } catch (err) {
    setStatus(`Error: ${err.message}`);
  }
}

async function startOver() {
  const confirmed = confirm(
    'Start over?\n\nThis permanently deletes all researched keywords, suggestions and AI analyses ' +
    'and aborts any running scrape. Your settings are kept.'
  );
  if (!confirmed) return;

  setStatus('Clearing workspace…');
  try {
    const res = await chrome.runtime.sendMessage({ type: 'CLEAR_ALL' });
    if (!res.ok) throw new Error(res.error);
    rows = [];
    setStatus('Cleared. Ready for a fresh niche search.');
    render();
    refreshQueueBar();
  } catch (err) {
    setStatus(`Error: ${err.message}`);
  }
}

async function removeKeyword(keyword) {
  const res = await chrome.runtime.sendMessage({ type: 'DELETE_KEYWORD', keyword });
  if (!res.ok) return setStatus(`Error: ${res.error}`);
  setStatus('Deleted.');
  refresh();
}

function exportCsv() {
  const filterMarket = loadedMarket || document.getElementById('market-select').value;
  const visible = rows.filter((r) => r.market === filterMarket);
  const header = [
    'keyword', 'market', 'score', 'demand', 'competition', 'margin', 'confidence',
    'est_monthly_sales', 'listing_count', 'avg_price', 'avg_reviews', 'avg_rating',
    'median_bsr', 'top_concentration', 'closing', 'forecast'
  ];
  const lines = visible.map((r) => {
    const m = r.metrics || {};
    return [
      csv(r.keyword),
      r.market || 'us',
      Math.round(r.score || 0),
      (r.demand || 0).toFixed(3),
      (r.competition || 0).toFixed(3),
      (r.margin || 0).toFixed(3),
      (r.confidence || 0).toFixed(3),
      r.estimatedMonthlySales ?? '',
      m.listingCount ?? '',
      m.avgPrice ?? '',
      m.avgReviewCount ?? m.avgReviews ?? '',
      m.avgRating ?? '',
      m.medianRank ?? m.avgBsr ?? '',
      m.topConcentration ?? '',
      r.scrapedAt ? new Date(r.scrapedAt).toISOString() : '',
      (r.verdict && r.verdict.label) || ''
    ].join(',');
  });
  const blob = new Blob([[header.join(','), ...lines].join('\n')], { type: 'text/csv' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = `kdp-copilot-${filterMarket}.csv`;
  a.click();
  URL.revokeObjectURL(a.href);
  setStatus(`Exported ${lines.length} rows.`);
}

function csv(s) {
  return `"${String(s).replace(/"/g, '""')}"`;
}

function fmt(v) {
  return v == null ? '—' : Number(v).toFixed(0);
}

function fmtPct(v) {
  return v == null ? '—' : `${(Number(v) * 100).toFixed(0)}%`;
}

function fmtSales(v) {
  return v == null ? '—' : `~${Number(v).toLocaleString()}/mo`;
}

function fmtDate(ts) {
  return ts ? new Date(ts).toLocaleDateString() : '—';
}

function escapeHtml(s) {
  return String(s).replace(/[&<>"']/g, (c) => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
  }[c]));
}

function escapeAttr(s) {
  return escapeHtml(s);
}