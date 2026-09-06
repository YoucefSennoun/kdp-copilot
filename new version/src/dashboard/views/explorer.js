import { send, fmt, toneClass, escapeHtml, showStatus, totalResultsLabel, bsrLabel, contentChip } from '../helpers.js';
import { settings } from '../app.js';
import { openDetailDrawer } from './detail.js';
import { getMarkets } from './markets.js';

let allKeywords = [];
let sortState = { key: 'score', dir: 'desc' };
let queueSnapshot = { size: 0, idle: true, pending: 0, stage: 'idle' };
let discoveryInFlight = false;

const $ = (id) => document.getElementById(id);

export function onShow() {
  populateMarkets();
  refreshKeywords();
}

async function populateMarkets() {
  const list = await getMarkets();
  const sel = $('market-select');
  const current = await settings();
  sel.innerHTML = list
    .map((m) => `<option value="${m.code}">${escapeHtml(m.name)}</option>`)
    .join('');
  if (current.market) sel.value = current.market;
}

async function refreshKeywords() {
  allKeywords = await send('GET_KEYWORDS');
  renderTable();
}

function currentMarket() {
  return $('market-select').value || 'us';
}

// ---------------------------------------------------------------------------
// Rendering
// ---------------------------------------------------------------------------

function renderTable() {
  const rows = [...allKeywords].filter((k) => !(k.keyword || '').startsWith('dp/'));
  const { key, dir } = sortState;
  const val = (k) => {
    switch (key) {
      case 'score': return k.score ?? -Infinity;
      case 'demand': return k.demand ?? -Infinity;
      case 'competition': return k.competition ?? Infinity;
      case 'margin': return k.margin ?? -Infinity;
      case 'confidence': return k.confidence ?? -Infinity;
      case 'scrapedAt': return k.scrapedAt ?? 0;
      default: return k[key] ?? '';
    }
  };
  rows.sort((a, b) => {
    const av = val(a); const bv = val(b);
    if (typeof av === 'string' || typeof bv === 'string') {
      return (dir === 'asc' ? 1 : -1) * String(av).localeCompare(String(bv));
    }
    return (dir === 'asc' ? 1 : -1) * ((av || 0) - (bv || 0));
  });

  const body = $('keywords-body');
  if (!rows.length) {
    body.innerHTML =
      '<tr><td colspan="11" class="muted">No keywords yet. Expand a seed, browse Amazon, or click "Discover Niches".</td></tr>';
    return;
  }

  body.innerHTML = rows
    .map((k, i) => {
      const bsr = bsrLabel(k);
      const results = totalResultsLabel(k);
      const hasBsr = (k.metrics && Array.isArray(k.metrics.bsrSamples) && k.metrics.bsrSamples.length) || (k.metrics && k.metrics.bestSubcategoryBsr != null);
      return `<tr data-keyword="${escapeHtml(k.keyword)}" data-index="${i}">
        <td>
          <a href="#" class="kw-detail" title="Open detail">${escapeHtml(k.keyword)}</a>
          ${hasBsr ? `<span class="pill" title="BSR enriched">BSR</span>` : ''}
          ${contentChip(k)}
        </td>
        <td class="muted">${escapeHtml(k.market || 'us').toUpperCase()}</td>
        <td class="score-badge" style="color:${scoreColor(k.score)}">${fmt.score(k.score)}</td>
        <td>${fmt.pct(k.demand)}</td>
        <td>${fmt.pct(k.competition)}</td>
        <td>${fmt.pct(k.margin)}</td>
        <td>${fmt.pct(k.confidence)}</td>
        <td class="muted">${fmt.sales(k.estimatedMonthlySales)}</td>
        <td class="muted">${results}</td>
        <td class="muted" title="${escapeHtml(k.scrapedAt || '')}">${fmt.date(k.scrapedAt)}</td>
        <td>
          <a href="#" class="af-link" data-act="ai" title="Analyze niche">AI</a> ·
          <a href="#" class="af-link" data-act="legal" title="Trademark/copyright">LK</a> ·
          <a href="#" class="af-link" data-act="scrape" title="(Re)scrape SERP">SC</a> ·
          <a href="#" class="af-link" data-act="delete" title="Delete">DEL</a>
        </td>
      </tr>`;
    })
    .join('');

  body.querySelectorAll('th.sortable').forEach(() => {});
}

function scoreColor(s) {
  if (s == null) return '#999';
  const cls = toneClass(s);
  return cls;
}

// ---------------------------------------------------------------------------
// Actions
// ---------------------------------------------------------------------------

async function handleExpand() {
  const seed = $('seed-input').value.trim();
  if (!seed) {
    showStatus($('status'), 'Enter a seed keyword first.', true);
    return;
  }
  const btn = $('go-btn');
  btn.disabled = true;
  btn.classList.add('loading');
  try {
    const res = await send('EXPAND_SEED', { seed, market: currentMarket() });
    showStatus($('status'), `Expanded "${seed}" → ${res.count} keywords; queued scraping.`);
    refreshKeywords();
  } catch (err) {
    showStatus($('status'), `Expansion failed: ${err.message}`, true);
  } finally {
    btn.disabled = false;
    btn.classList.remove('loading');
  }
}

async function handleDiscover(mode) {
  if (discoveryInFlight) return;
  discoveryInFlight = true;
  const btn = mode === 'findme' ? $('find-me-btn') : $('discover-btn');
  btn.disabled = true;
  btn.classList.add('loading');
  try {
    const res = await send(mode === 'findme' ? 'FIND_ME_NICHES' : 'DISCOVER_NICHES', {
      market: currentMarket()
    });
    showStatus(
      $('status'),
      res.count
        ? `Discover: ${res.count} new keywords sourced from ${res.consumed} live listings; queued for scraping + BSR enrichment.`
        : 'Discover: no new keywords (all already tracked).'
    );
    refreshKeywords();
  } catch (err) {
    showStatus($('status'), `Discovery failed: ${err.message}`, true);
  } finally {
    discoveryInFlight = false;
    btn.disabled = false;
    btn.classList.remove('loading');
  }
}

async function handleFetchSuggestions() {
  const seed = $('seed-input').value.trim();
  if (!seed) {
    showStatus($('status'), 'Enter a keyword to fetch autocomplete.', true);
    return;
  }
  try {
    const r = await send('FETCH_SUGGESTIONS', { seed, market: currentMarket() });
    showStatus($('status'), `Autocomplete: ${r.amazon.length} Amazon + ${r.google.length} Google suggested keywords.`);
  } catch (err) {
    showStatus($('status'), `Autocomplete failed: ${err.message}`, true);
  }
}

async function handleScrapeAll() {
  try {
    const r = await send('SCRAPE_ALL', { market: currentMarket() });
    showStatus($('status'), r.count ? `Queued scraping for ${r.count} keywords.` : 'Nothing unscraped to queue.');
  } catch (err) {
    showStatus($('status'), `Scrape all failed: ${err.message}`, true);
  }
}

function exportCsv() {
  const cols = [
    'keyword', 'market', 'score', 'demand', 'competition', 'margin', 'confidence',
    'estimatedMonthlySales', 'bestSubcategoryBsr', 'bestSubcategoryBsrCategory',
    'totalResultsCount', 'resultsCountIsApprox', 'demandProxyScore', 'bsrCoverage',
    'verdict', 'scrapedAt'
  ];
  const esc = (v) => {
    const s = v == null ? '' : String(v);
    return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  };
  const header = cols.map((c) => esc(c)).join(',');
  const lines = allKeywords
    .filter((k) => !(k.keyword || '').startsWith('dp/'))
    .map((k) => {
      const m = k.metrics || {};
      const row = {
        keyword: k.keyword,
        market: k.market,
        score: k.score,
        demand: k.demand,
        competition: k.competition,
        margin: k.margin,
        confidence: k.confidence,
        estimatedMonthlySales: k.estimatedMonthlySales,
        bestSubcategoryBsr: m.bestSubcategoryBsr,
        bestSubcategoryBsrCategory: m.bestSubcategoryBsrCategory,
        totalResultsCount: m.totalResultsCount,
        resultsCountIsApprox: m.resultsCountIsApprox,
        demandProxyScore: m.demandProxyScore,
        bsrCoverage: m.bsrCoverage,
        verdict: k.verdict,
        scrapedAt: k.scrapedAt
      };
      return cols.map((c) => esc(row[c])).join(',');
    });
  const blob = new Blob([[header, ...lines].join('\n')], { type: 'text/csv' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = `kdp-copilot-${new Date().toISOString().slice(0, 19).replace(/[:T]/g, '-')}.csv`;
  a.click();
  URL.revokeObjectURL(a.href);
}

async function handleStartOver() {
  if (!confirm('Clear ALL keywords, suggestions, analyses and discovery history?')) return;
  try {
    await send('CLEAR_ALL');
    allKeywords = [];
    renderTable();
    showStatus($('status'), 'Workspace cleared.');
  } catch (err) {
    showStatus($('status'), err.message, true);
  }
}

async function handleRowAction(keyword, act) {
  const k = allKeywords.find((x) => x.keyword === keyword);
  if (!k) return;
  try {
    switch (act) {
      case 'ai': {
        const btn = document.querySelector(`#keywords-body a.kw-detail`);
        showStatus($('status'), `Analyzing "${keyword}" with Gemini…`);
        const r = await send('ANALYZE_NICHE', { keyword });
        openDetailDrawer(keyword, { analysis: r });
        break;
      }
      case 'legal':
        await send('CHECK_TRADEMARK', { keyword });
        openDetailDrawer(keyword, { legalRequested: true });
        break;
      case 'scrape':
        await send('SCRAPE_KEYWORD', { keyword, market: currentMarket() });
        showStatus($('status'), `Queued scrape for "${keyword}".`);
        break;
      case 'delete':
        await send('DELETE_KEYWORD', { keyword });
        refreshKeywords();
        showStatus($('status'), `Deleted "${keyword}".`);
        break;
    }
  } catch (err) {
    showStatus($('status'), err.message, true);
  }
}

// ---------------------------------------------------------------------------
// Events
// ---------------------------------------------------------------------------

export function bind() {
  $('go-btn').addEventListener('click', handleExpand);
  $('discover-btn').addEventListener('click', () => handleDiscover('discover'));
  $('find-me-btn').addEventListener('click', () => handleDiscover('findme'));
  $('suggest-btn').addEventListener('click', handleFetchSuggestions);
  $('scrape-all-btn').addEventListener('click', handleScrapeAll);
  $('export-btn').addEventListener('click', exportCsv);
  $('refresh-btn').addEventListener('click', refreshKeywords);
  $('start-over-btn').addEventListener('click', handleStartOver);
  $('pause-btn').addEventListener('click', () => {
    if (queueSnapshot.idle) return;
    if (queueSnapshot.paused) {
      send('RESUME_QUEUE');
    } else {
      send('PAUSE_QUEUE');
    }
  });

  $('seed-input').addEventListener('keydown', (e) => {
    if (e.key === 'Enter') handleExpand();
  });

  $('keywords-body').addEventListener('click', (e) => {
    const link = e.target.closest('a');
    if (!link) return;
    e.preventDefault();
    const tr = link.closest('tr');
    if (!tr) return;
    const keyword = tr.dataset.keyword;
    if (link.classList.contains('kw-detail')) {
      openDetailDrawer(keyword, {});
    } else if (link.classList.contains('af-link')) {
      handleRowAction(keyword, link.dataset.act);
    }
  });

  document.querySelectorAll('th.sortable').forEach((th) => {
    th.addEventListener('click', () => {
      const key = th.dataset.sort;
      if (sortState.key === key) {
        sortState.dir = sortState.dir === 'asc' ? 'desc' : 'asc';
      } else {
        sortState.key = key;
        sortState.dir = key === 'competition' ? 'asc' : 'desc';
      }
      document.querySelectorAll('th.sortable').forEach((t) => {
        t.classList.toggle('asc', t === th && sortState.dir === 'asc');
        t.classList.toggle('desc', t === th && sortState.dir === 'desc');
      });
      renderTable();
    });
  });

  pollQueue();
  pollKeywordUpdates();
}

// ---------------------------------------------------------------------------
// Live updates
// ---------------------------------------------------------------------------

export function onQueueProgress(snapshot) {
  if (!snapshot) return;
  if (typeof snapshot.size === 'number' || typeof snapshot.pending === 'number') {
    queueSnapshot = { ...queueSnapshot, ...snapshot };
    if (snapshot.idle) queueSnapshot.pipelineText = '';
  } else if (snapshot.pipelineText) {
    queueSnapshot.pipelineText = snapshot.pipelineText;
  }
  renderQueueBar();
}

function renderQueueBar() {
  const stage = queueSnapshot.stage ?? 'idle';
  const pending = queueSnapshot.pending ?? 0;
  const completed = queueSnapshot.completed ?? 0;
  const failed = queueSnapshot.failed ?? 0;
  const size = queueSnapshot.size ?? 0;
  const idle = !!queueSnapshot.idle;
  const paused = !!queueSnapshot.paused;
  const pipelineText = queueSnapshot.pipelineText;
  const done = (completed || 0) + (failed || 0);
  const total = size || 0;
  const pct = total ? Math.min(100, Math.round((done / total) * 100)) : 0;

  const stageText =
    stage === 'serp' ? 'scraping search results' :
    stage === 'enrichment' ? 'enriching BSR (product pages)' :
    stage === 'discovery' ? 'discovering' :
    'idle';

  $('queue-status').textContent = idle
    ? 'Idle'
    : paused
      ? `${pipelineText ? pipelineText + ' · ' : ''}⏸ Paused — ${total} remaining`
      : pipelineText
        ? `${pipelineText} · ${pending}/${total} remaining`
        : `${pending}/${total} remaining · ${stageText} · ${failed} failed`;
  $('queue-fill').style.width = `${pct}%`;
  $('queue-status').classList.toggle('muted', idle);

  const btn = $('pause-btn');
  btn.textContent = paused ? 'Resume' : 'Pause';
  btn.style.opacity = idle ? '0.4' : '1';
}

async function pollQueue() {
  try {
    const s = await send('QUEUE_STATUS');
    queueSnapshot = { ...queueSnapshot, ...s };
  } catch {}
  renderQueueBar();
  setTimeout(pollQueue, 2000);
}

async function pollKeywordUpdates() {
  try {
    const fresh = await send('GET_KEYWORDS');
    const dirty = JSON.stringify(fresh.map((k) => [k.keyword, k.score, k.metrics && k.metrics.bestSubcategoryBsr, k.metrics && k.metrics.bsrSamples && k.metrics.bsrSamples.length]).map((x) => x.join('|')).join('\n'));
    const prev = JSON.stringify(allKeywords.map((k) => [k.keyword, k.score, k.metrics && k.metrics.bestSubcategoryBsr, k.metrics && k.metrics.bsrSamples && k.metrics.bsrSamples.length].map((x) => x.join('|')).join('\n')));
    if (dirty !== prev) {
      allKeywords = fresh;
      renderTable();
    }
  } catch {}
  setTimeout(pollKeywordUpdates, 4000);
}

bind();