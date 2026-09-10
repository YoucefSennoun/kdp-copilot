import { send, fmt, toneClass, escapeHtml, showStatus, startBusyStatus, totalResultsLabel, bsrLabel, contentChip } from '../helpers.js';
import { settings, invalidateSettings } from '../app.js';
import { openDetailDrawer } from './detail.js';
import { getMarkets } from './markets.js';

let allKeywords = [];
let sortState = { key: 'score', dir: 'desc' };
let queueSnapshot = { size: 0, idle: true, pending: 0, stage: 'idle' };

const $ = (id) => document.getElementById(id);

export async function onShow() {
  await populateMarkets();
  const s = await settings();
  if (s.formatFilter && ['kindle', 'paperback', 'hardcover'].includes(s.formatFilter)) {
    $('format-select').value = s.formatFilter;
  } else {
    $('format-select').value = '';
  }
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
      '<tr><td colspan="11" class="muted">No keywords yet. Enter a format keyword (e.g. "logbook", "journal", "cahier") and click Research.</td></tr>';
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
    showStatus($('status'), 'Enter a keyword first (e.g. "logbook", "journal", "planner").', true);
    return;
  }
  const btn = $('go-btn');
  btn.disabled = true;
  btn.classList.add('loading');
  try {
    const res = await send('RESEARCH_FORMAT', { seed, market: currentMarket() });
    showStatus(
      $('status'),
      `Researching "${seed}" — ${res.phrasesFound} phrases from autocomplete, ${res.tasksQueued} SERP scrapes queued. ` +
      `Corpus: ${res.corpus.amazon} Amazon + ${res.corpus.google} Google suggestions. ` +
      `Results will appear as they scrape.`
    );
    refreshKeywords();
  } catch (err) {
    showStatus($('status'), `Research failed: ${err.message}`, true);
  } finally {
    btn.disabled = false;
    btn.classList.remove('loading');
  }
}

/** Rules v1 (rule 6): the format select is persisted into settings so scrape
 *  tasks + the format qualify gate use it. */
async function persistFormatFilter() {
  try {
    const s = await settings();
    const format = $('format-select').value || null;
    if (s.formatFilter !== format) {
      await send('SAVE_SETTINGS', { settings: { ...s, formatFilter: format } });
      invalidateSettings();
    }
  } catch {
    // non-fatal: format filter simply won't persist this session
  }
}

function exportCsv() {
  const cols = [
    'keyword', 'market', 'score', 'demand', 'competition', 'margin', 'confidence',
    'estimatedMonthlySales', 'freshHits', 'bestOverallBsr', 'bestSubcategoryBsr',
    'totalResultsCount', 'resultsCountIsApprox', 'demandProxyScore', 'keywordSuggested',
    'suffixHits', 'prefixHits',
    'brandRiskCount', 'brandRiskMatched', 'authorBrand',
    'fbaCount', 'fbaShare',
    'kindleShare', 'paperbackShare', 'hardcoverShare',
    'bsrCoverage', 'verdictLabel', 'qualifiesAll', 'contentType', 'scrapedAt'
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
      const samples = Array.isArray(m.bsrSamples) ? m.bsrSamples : [];
      const overallRanks = samples.map((s) => s && s.bsr).filter((r) => r != null);
      const freshHits = samples.filter((s) =>
        s && s.bsr != null && s.pubDateEpoch != null &&
        s.pubDateEpoch >= (Date.now() - 6 * 30.44 * 24 * 60 * 60 * 1000) &&
        s.bsr <= 200000
      ).length;
      const shares = m.formatShares || {};
      const proof = (m.demandProxyBreakdown && m.demandProxyBreakdown.alphabetProof) || {};
      const row = {
        keyword: k.keyword,
        market: k.market,
        score: k.score,
        demand: k.demand,
        competition: k.competition,
        margin: k.margin,
        confidence: k.confidence,
        estimatedMonthlySales: k.estimatedMonthlySales,
        freshHits,
        bestOverallBsr: overallRanks.length ? Math.min(...overallRanks) : '',
        bestSubcategoryBsr: m.bestSubcategoryBsr,
        totalResultsCount: m.totalResultsCount,
        resultsCountIsApprox: m.resultsCountIsApprox,
        demandProxyScore: m.demandProxyScore,
        keywordSuggested: m.keywordSuggested,
        suffixHits: proof.suffixHits ?? '',
        prefixHits: proof.prefixHits ?? '',
        brandRiskCount: m.brandRisk ? m.brandRisk.count : '',
        brandRiskMatched: m.brandRisk ? (m.brandRisk.matched || []).join('|') : '',
        authorBrand: m.authorBrand ? `${m.authorBrand.author} (${m.authorBrand.count})` : '',
        fbaCount: m.fbaCount ?? '',
        fbaShare: m.fbaShare ?? '',
        kindleShare: shares.kindle,
        paperbackShare: shares.paperback,
        hardcoverShare: shares.hardcover,
        bsrCoverage: m.bsrCoverage,
        verdictLabel: (k.verdict && k.verdict.label) || '',
        qualifiesAll: k.qualifies ? k.qualifies.all : '',
        contentType: m.contentType,
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
    showStatus($('status'), 'Workspace cleared and queue paused. Your next Research will resume it automatically.');
  } catch (err) {
    showStatus($('status'), err.message, true);
  }
}

async function handleRowAction(keyword, act) {
  const k = allKeywords.find((x) => x.keyword === keyword);
  const market = (k && k.market) || currentMarket();
  if (!k) return;
  try {
    switch (act) {
      case 'ai': {
        showStatus($('status'), `Analyzing "${keyword}" with AI…`);
        const r = await send('ANALYZE_NICHE', { keyword, market });
        openDetailDrawer(keyword, { market, analysis: r });
        break;
      }
      case 'legal': {
        const stop = startBusyStatus($('status'), `Checking trademark for "${keyword}" across markets — the AI review can take up to a minute`);
        try {
          await send('CHECK_TRADEMARK', { keyword, market });
          openDetailDrawer(keyword, { market, legalRequested: true });
          showStatus($('status'), `Trademark report ready for "${keyword}" — click View trademark report.`);
        } finally {
          stop();
        }
        break;
      }
      case 'scrape':
        await send('SCRAPE_KEYWORD', { keyword, market });
        showStatus($('status'), `Queued scrape for "${keyword}".`);
        break;
      case 'delete':
        await send('DELETE_KEYWORD', { keyword, market });
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
  $('export-btn').addEventListener('click', exportCsv);
  $('refresh-btn').addEventListener('click', refreshKeywords);
  $('start-over-btn').addEventListener('click', handleStartOver);
  $('format-select').addEventListener('change', () => {
    persistFormatFilter().then(() =>
      showStatus($('status'), $('format-select').value
        ? `Format filter set to ${$('format-select').value} — applies to new scrapes.`
        : 'Format filter cleared — all formats.')
    );
  });
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