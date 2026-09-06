import { send, fmt, escapeHtml } from '../helpers.js';
import { settings } from '../app.js';
import { openDetailDrawer } from './detail.js';

const $ = (id) => document.getElementById(id);
let allKeywords = [];
let thresholds = { bsrThreshold: 200, listingsThreshold: 1000, volumeThreshold: 50 };

export async function onShow() {
  const s = await settings();
  thresholds = {
    bsrThreshold: s.bsrThreshold ?? 200,
    listingsThreshold: s.listingsThreshold ?? 1000,
    volumeThreshold: s.volumeThreshold ?? 50,
    contentTypeEnabled: s.contentTypeEnabled !== false
  };
  $('niche-bsr-cap').textContent = thresholds.bsrThreshold;
  $('niche-listings-cap').textContent = thresholds.listingsThreshold;
  $('niche-volume-cap').textContent = thresholds.volumeThreshold;
  await refresh();
}

async function refresh() {
  allKeywords = await send('GET_KEYWORDS');
  renderNicheTable();
}

function qualifiesAgainst(record) {
  const m = record.metrics || {};
  const excluded = m.contentType === 'high-content-excluded' || m.requiresExpertise === true;
  return {
    bsr:
      m.bestSubcategoryBsr != null &&
      m.bestSubcategoryBsr <= thresholds.bsrThreshold,
    listings:
      m.totalResultsCount != null &&
      m.totalResultsCount <= thresholds.listingsThreshold,
    volume: m.demandProxyScore != null && m.demandProxyScore >= thresholds.volumeThreshold,
    contentType: thresholds.contentTypeEnabled ? !excluded : true
  };
}

function renderContentCell(m) {
  if (thresholds.contentTypeEnabled === false) return '<span class="muted">off</span>';
  const label = m.contentTypeLabel || m.contentType || 'Unknown';
  if (m.contentType === 'high-content-excluded') {
    return `<span class="chip chip-bad" title="Excluded: ${escapeHtml(m.contentTypeSource || '')}">${escapeHtml(label)}</span>`;
  }
  const source = m.contentTypeSource ? ` (${m.contentTypeSource})` : '';
  return `<span class="chip" title="${escapeHtml(m.contentType || '')}${escapeHtml(source)}">${escapeHtml(label)}</span>`;
}

function renderNicheTable() {
  const candidates = allKeywords.filter(
    (k) => !(k.keyword || '').startsWith('dp/') && k.metrics && (k.metrics.bestSubcategoryBsr != null || (Array.isArray(k.metrics.bsrSamples) && k.metrics.bsrSamples.length))
  );

  const scored = candidates
    .map((k) => ({ record: k, qual: qualifiesAgainst(k) }))
    .filter((x) => x.qual.bsr && x.qual.listings && x.qual.volume && x.qual.contentType)
    .sort(
      (a, b) =>
        (a.record.metrics.bestSubcategoryBsr ?? Infinity) -
        (b.record.metrics.bestSubcategoryBsr ?? Infinity)
    );

  $('niche-status').textContent = `${scored.length} of ${candidates.length} BSR-enriched keywords qualify (${thresholds.bsrThreshold}/${thresholds.listingsThreshold}/${thresholds.volumeThreshold}${thresholds.contentTypeEnabled ? ' + publishable' : ''}).`;

  const body = $('niches-body');
  if (!scored.length) {
    body.innerHTML =
      '<tr><td colspan="11" class="muted">No niches pass all thresholds. Run "Find Me Niches" to auto-discover, scrape and enrich — or lower your thresholds / disable the publishable-content filter in Settings.</td></tr>';
    return;
  }

  body.innerHTML = scored
    .map(({ record: k, qual }) => {
      const m = k.metrics || {};
      return `<tr data-keyword="${escapeHtml(k.keyword)}">
        <td><a href="#" class="niche-detail">${escapeHtml(k.keyword)}</a></td>
        <td class="muted">${escapeHtml(k.market || 'us').toUpperCase()}</td>
        <td class="score-badge">${fmt.score(k.score)}</td>
        <td><b>#${fmt.num(m.bestSubcategoryBsr)}</b></td>
        <td>${fmt.num(m.totalResultsCount)}</td>
        <td>${fmt.score(m.demandProxyScore)}</td>
        <td>${renderContentCell(m)}</td>
        <td>${qual.bsr ? '✓' : '✗'}</td>
        <td>${qual.listings ? '✓' : '✗'}</td>
        <td>${qual.volume ? '✓' : '✗'}</td>
        <td>
          <a href="#" class="niche-action" data-act="view">Details</a> ·
          <a href="#" class="niche-action" data-act="scrape">Scrape</a>
        </td>
      </tr>`;
    })
    .join('');

  body.querySelectorAll('.niche-detail, .niche-action').forEach((a) => {
    a.addEventListener('click', async (e) => {
      e.preventDefault();
      const tr = a.closest('tr');
      const keyword = tr.dataset.keyword;
      if (a.dataset.act === 'scrape') {
        await send('SCRAPE_KEYWORD', { keyword, market: (tr.querySelector('td:nth-child(2)').textContent || 'us').toLowerCase() });
        $('niche-status').textContent = `Queued scrape for "${keyword}".`;
      } else {
        openDetailDrawer(keyword, {});
      }
    });
  });
}

$('niche-refresh').addEventListener('click', refresh);