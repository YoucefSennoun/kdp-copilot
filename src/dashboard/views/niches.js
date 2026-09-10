import { send, fmt, escapeHtml, showStatus, startBusyStatus } from '../helpers.js';
import { settings } from '../app.js';
import { openDetailDrawer } from './detail.js';
import { classifyContentType, scopeAllows } from '../../lib/content-type.js';

const $ = (id) => document.getElementById(id);
let allKeywords = [];
let thresholds = {
  overallBsrMax: 200000,
  usListingsMax: 1000,
  otherListingsMax: 800,
  volumeThreshold: 50,
  maxBookAgeMonths: 6,
  freshHitsMin: 1,
  brandFilterEnabled: true,
  contentTypeEnabled: true,
  contentScope: 'rule8'
};

export async function onShow() {
  const s = await settings();
  thresholds = {
    overallBsrMax: s.overallBsrMax ?? 200000,
    usListingsMax: s.usListingsMax ?? 1000,
    otherListingsMax: s.otherListingsMax ?? 800,
    volumeThreshold: s.volumeThreshold ?? 50,
    maxBookAgeMonths: s.maxBookAgeMonths ?? 6,
    freshHitsMin: s.freshHitsMin ?? 1,
    brandFilterEnabled: s.brandFilterEnabled !== false,
    contentTypeEnabled: s.contentTypeEnabled !== false,
    contentScope: s.contentScope || 'rule8'
  };
  $('niche-bsr-cap').textContent = (thresholds.overallBsrMax / 1000).toFixed(0) + 'k';
  $('niche-listings-cap').textContent = `${thresholds.usListingsMax}/${thresholds.otherListingsMax}`;
  $('niche-volume-cap').textContent = thresholds.volumeThreshold;
  await refresh();
}

async function refresh() {
  allKeywords = await send('GET_KEYWORDS');
  renderNicheTable();
}

/** Count fresh hits client-side identically to the background rule engine. */
function countFreshHits(m) {
  const now = Date.now();
  const cutoff = now - thresholds.maxBookAgeMonths * 30.44 * 24 * 60 * 60 * 1000;
  const blocked = new Set(m.brandBlockedAsins || []);
  return (m.bsrSamples || []).filter((s) =>
    s && s.bsr != null &&
    s.pubDateEpoch != null &&
    s.pubDateEpoch >= cutoff &&
    s.bsr <= thresholds.overallBsrMax &&
    !blocked.has(s.asin)
  ).length;
}

function bestOverallBsr(m) {
  const ranks = (m.bsrSamples || []).map((s) => s && s.bsr).filter((r) => r != null);
  return ranks.length ? Math.min(...ranks) : null;
}

function qualifiesAgainst(record) {
  const m = record.metrics || {};
  const listingsCap = (record.market || 'us') === 'us' ? thresholds.usListingsMax : thresholds.otherListingsMax;

  // Re-check the record under the CURRENT content scope so legacy rows saved
  // under an older scope can't slip past the gate.
  let storedOk = m.contentType !== 'high-content-excluded' && m.requiresExpertise !== true;
  if (thresholds.contentTypeEnabled && storedOk) {
    storedOk = scopeAllows(classifyContentType({ keyword: record.keyword || '', scope: thresholds.contentScope }), thresholds.contentScope);
  }

  return {
    fresh: countFreshHits(m) >= thresholds.freshHitsMin,
    bsrOverall: (bestOverallBsr(m) ?? Infinity) <= thresholds.overallBsrMax,
    listings: m.totalResultsCount != null && m.totalResultsCount <= listingsCap,
    volume: m.demandProxyScore != null && m.demandProxyScore >= thresholds.volumeThreshold,
    brand: thresholds.brandFilterEnabled ? !m.brandRisk?.topBranded : true,
    contentType: thresholds.contentTypeEnabled ? storedOk : true
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
    (k) => !(k.keyword || '').startsWith('dp/') && k.metrics &&
      ((k.metrics.bsrSamples || []).length || k.metrics.bestSubcategoryBsr != null)
  );

  const scored = candidates
    .map((k) => ({ record: k, qual: qualifiesAgainst(k) }))
    .filter((x) => x.qual.fresh && x.qual.bsrOverall && x.qual.listings && x.qual.volume && x.qual.brand && x.qual.contentType)
    .sort((a, b) => (bestOverallBsr(a.record.metrics) ?? Infinity) - (bestOverallBsr(b.record.metrics) ?? Infinity));

  $('niche-status').textContent = `${scored.length} of ${candidates.length} BSR-enriched keywords pass all rules-v1 gates (fresh<${thresholds.maxBookAgeMonths}mo · BSR≤${(thresholds.overallBsrMax / 1000).toFixed(0)}k · list≤${thresholds.usListingsMax}/${thresholds.otherListingsMax} · proxy≥${thresholds.volumeThreshold}${thresholds.brandFilterEnabled ? ' · brand-free' : ''}).`;

  const body = $('niches-body');
  if (!scored.length) {
    body.innerHTML =
      '<tr><td colspan="11" class="muted">No niches pass all rules-v1 gates. Run "Find Me Niches" to auto-discover, scrape and enrich — or adjust the gates in Settings.</td></tr>';
    return;
  }

  body.innerHTML = scored
    .map(({ record: k, qual }) => {
      const m = k.metrics || {};
      const fresh = countFreshHits(m);
      const bsr = bestOverallBsr(m);
      const brandOk = qual.brand;
      const gates = [
        `<span class="qual-chip ${qual.fresh ? 'qual-ok' : 'qual-bad'}" title="New (<${thresholds.maxBookAgeMonths}mo) + selling + unbranded">NEW</span>`,
        `<span class="qual-chip ${qual.bsrOverall ? 'qual-ok' : 'qual-bad'}" title="Overall BSR ≤ ${thresholds.overallBsrMax}">BSR</span>`,
        `<span class="qual-chip ${qual.listings ? 'qual-ok' : 'qual-bad'}" title="Results ≤ market cap">LIST</span>`,
        `<span class="qual-chip ${qual.volume ? 'qual-ok' : 'qual-bad'}" title="Interest proxy ≥ ${thresholds.volumeThreshold}">VOL</span>`
      ].join(' ');
      return `<tr data-keyword="${escapeHtml(k.keyword)}" data-market="${escapeHtml(k.market || 'us')}">
        <td><a href="#" class="niche-detail">${escapeHtml(k.keyword)}</a></td>
        <td class="muted">${escapeHtml(k.market || 'us').toUpperCase()}</td>
        <td class="score-badge">${fmt.score(k.score)}</td>
        <td>${fresh}</td>
        <td><b>#${fmt.num(bsr)}</b></td>
        <td>${fmt.num(m.totalResultsCount)}</td>
        <td>${fmt.score(m.demandProxyScore)}</td>
        <td>${renderContentCell(m)}</td>
        <td>${brandOk ? '✓' : '✗'}</td>
        <td>${gates}</td>
        <td>
          <a href="#" class="niche-action" data-act="view">Details</a> ·
          <a href="#" class="niche-action" data-act="scrape">Scrape</a> ·
          <a href="#" class="niche-action" data-act="legal">Legal</a>
        </td>
      </tr>`;
    })
    .join('');

  body.querySelectorAll('.niche-detail, .niche-action').forEach((a) => {
    a.addEventListener('click', async (e) => {
      e.preventDefault();
      const tr = a.closest('tr');
      const keyword = tr.dataset.keyword;
      const market = tr.dataset.market || 'us';
      if (a.dataset.act === 'scrape') {
        await send('SCRAPE_KEYWORD', { keyword, market });
        $('niche-status').textContent = `Queued scrape for "${keyword}".`;
      } else if (a.dataset.act === 'legal') {
        a.style.pointerEvents = 'none';
        a.style.opacity = '0.4';
        const stop = startBusyStatus($('niche-status'), `Checking trademark for "${keyword}" — the AI review can take up to a minute`);
        try {
          await send('CHECK_TRADEMARK', { keyword, market });
          showStatus($('niche-status'), `Trademark report ready for "${keyword}" — see the detail drawer.`);
          openDetailDrawer(keyword, { market, legalRequested: true });
        } catch (err) {
          showStatus($('niche-status'), `Trademark check failed: ${err.message}`, true);
        } finally {
          stop();
          a.style.pointerEvents = '';
          a.style.opacity = '';
        }
      } else {
        openDetailDrawer(keyword, { market });
      }
    });
  });
}

$('niche-refresh').addEventListener('click', refresh);

$('niche-scrub').addEventListener('click', async () => {
  const btn = $('niche-scrub');
  btn.disabled = true;
  try {
    const { removed } = await send('PURGE_OUTSIDE_SCOPE');
    $('niche-status').textContent = removed
      ? `Removed ${removed} stored keyword${removed === 1 ? '' : 's'} that don't fit ${thresholds.contentScope} scope.`
      : 'No out-of-scope keywords found — stored list is clean.';
    await refresh();
  } finally {
    btn.disabled = false;
  }
});
