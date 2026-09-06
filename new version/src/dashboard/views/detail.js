import { send, fmt, escapeHtml } from '../helpers.js';

const drawer = document.getElementById('detail-drawer');
const legalModal = document.getElementById('legal-modal');
const legalContent = document.getElementById('legal-content');

let lastKeyword = null;

function spinner() {
  return '<p class="muted">Loading…</p>';
}

async function loadRecord(keyword) {
  const r = await send('GET_KEYWORD', { keyword });
  return r;
}

export async function openDetailDrawer(keyword, opts = {}) {
  lastKeyword = keyword;
  drawer.hidden = false;
  drawer.scrollIntoView({ behavior: 'smooth', block: 'start' });
  drawer.innerHTML = spinner();

  try {
    const k = await loadRecord(keyword);
    if (!k) {
      drawer.innerHTML = `<h3>${escapeHtml(keyword)}</h3><p class="muted">No saved data for this keyword yet.</p>`;
      return;
    }
    renderDetail(k, opts);
  } catch (err) {
    drawer.innerHTML = `<h3>${escapeHtml(keyword)}</h3><p style="color:#e53935;">Failed to load: ${escapeHtml(err.message)}</p>`;
  }
}

function renderDetail(k, opts) {
  const m = k.metrics || {};
  const hasBsr = m.bestSubcategoryBsr != null || (Array.isArray(m.bsrSamples) && m.bsrSamples.length);
  const hasResults = m.totalResultsCount != null;
  const hasProxy = m.demandProxyScore != null;

  const bsrRows = Array.isArray(m.bsrSamples)
    ? m.bsrSamples
        .filter((s) => s.bsr != null)
        .map(
          (s) =>
            `<tr>
              <td class="muted">${escapeHtml(s.asin || '—')}</td>
              <td>${fmt.num(s.bsr)}</td>
              <td class="muted">${escapeHtml(
                Array.isArray(s.allRanks) && s.allRanks.length
                  ? s.allRanks.slice(0, 3).map((r) => `#${fmt.num(r.rank)} ${escapeHtml(r.category || '')}`).join(' · ')
                  : escapeHtml(s.bsrCategory || '—')
              )}</td>
            </tr>`
        )
        .join('')
    : '';

  const proxyDetail =
    hasProxy && m.demandProxyBreakdown
      ? `<ul class="muted" style="font-size:.82rem; margin:0.3rem 0;">
          <li>Engine depth: ${fmt.num(m.demandProxyBreakdown.corpusAmazon || 0)} Amazon / ${fmt.num(m.demandProxyBreakdown.corpusGoogle || 0)} Google suggestions collected</li>
          <li>Cross-engine matches: ${fmt.num(m.demandProxyBreakdown.crossMatches || 0)}</li>
          <li>Seed proxy score: ${fmt.score(m.demandProxyBreakdown.seedProxyScore)}</li>
        </ul>`
      : '';

  const sampleTable = Array.isArray(m.sample) && m.sample.length
    ? `<details>
        <summary>Sample of ${m.sample.length} scraped listing(s)</summary>
        <table>
          <thead><tr><th>Title</th><th>Reviews</th><th>Price</th><th>Rating</th></tr></thead>
          <tbody>
            ${m.sample
              .map(
                (l) =>
                  `<tr>
                    <td>${escapeHtml((l.title || '').slice(0, 70))}</td>
                    <td>${fmt.num(l.reviewCount)}</td>
                    <td>${escapeHtml(l.price || '—')}</td>
                    <td>${l.rating != null ? fmt.num(l.rating, 1) : '—'}</td>
                  </tr>`
              )
              .join('')}
          </tbody>
        </table>
      </details>`
    : '';

  const analysisHtml =
    k.analysis && k.analysis.report
      ? `<h3>Gemini Niche Analysis</h3>
         <div class="ai-output">${escapeHtml(k.analysis.report)}</div>`
      : opts.analysis && opts.analysis.report
        ? `<h3>Gemini Niche Analysis</h3>
           <div class="ai-output">${escapeHtml(opts.analysis.report)}</div>`
        : '';

  const titleIdea = k.aiTitleIdea
    ? `<p><b>Title idea:</b> ${escapeHtml(k.aiTitleIdea)}</p>`
    : '';
  const categoryIdea = k.aiCategory
    ? `<p><b>Suggested category:</b> ${escapeHtml(k.aiCategory)}</p>`
    : '';
  const rationale = k.aiRationale
    ? `<p class="muted">${escapeHtml(k.aiRationale)}</p>`
    : '';

  drawer.innerHTML = `
    <h3 style="margin-top:0;">${escapeHtml(k.keyword)}
      <span style="color:#${scoreHex(k.score)}; font-weight:800;">· ${fmt.score(k.score)}</span>
    </h3>
    ${titleIdea}${categoryIdea}${rationale}
    <div class="grid" style="grid-template-columns: repeat(auto-fit, minmax(150px, 1fr)); gap:.5rem; margin-bottom:.75rem;">
      <div class="product-card"><b>Demand</b><br>${fmt.pct(k.demand)}</div>
      <div class="product-card"><b>Competition</b><br>${fmt.pct(k.competition)}</div>
      <div class="product-card"><b>Margin</b><br>${fmt.pct(k.margin)}</div>
      <div class="product-card"><b>Confidence</b><br>${fmt.pct(k.confidence)}</div>
      <div class="product-card"><b>Est. sales</b><br>${fmt.sales(k.estimatedMonthlySales)}</div>
      <div class="product-card"><b>Verdict</b><br>${escapeHtml(k.verdict || '—')}</div>
    </div>

    <div class="grid" style="grid-template-columns: repeat(auto-fit, minmax(230px, 1fr)); gap:.5rem;">
      <div class="product-card">
        <h4>Total results</h4>
        ${hasResults
          ? `<b style="font-size:1.15rem;">${m.resultsCountIsApprox ? '≈' : ''}${fmt.num(m.totalResultsCount)}</b>
             <p class="meta">competition signal · filtered ${fmt.num(m.filteredCount ?? (Array.isArray(m.sample) ? m.sample.length : 0))} titles to ${fmt.num(m.distinctTitleCount ?? 0)} distinct · self-published ${fmt.pct(m.selfPublishRate)}</p>`
          : '<p class="muted">No SERP scraped yet — results count comes from Amazon SERP.</p>'}
      </div>
      <div class="product-card">
        <h4>BSR (sub-category)</h4>
        ${hasBsr
          ? m.bestSubcategoryBsr != null
            ? `<b style="font-size:1.15rem;">#${fmt.num(m.bestSubcategoryBsr)}</b>
               ${m.bestSubcategoryBsrCategory ? `<p class="meta">${escapeHtml(m.bestSubcategoryBsrCategory)}</p>` : ''}
               <p class="meta">coverage ${fmt.pct(m.bsrCoverage)} · ${fmt.num(Array.isArray(m.bsrSamples) ? m.bsrSamples.length : 0)}/${fmt.num(m.bsrExpected)} products</p>`
            : `<b style="font-size:1.15rem;">#${fmt.num(medianRank(m.bsrSamples))}</b><p class="meta">median of partial samples — enrichment still running</p>`
          : '<p class="muted">No BSR yet — auto-enrichment opens product pages for shortlisted keywords.</p>'}
        ${bsrRows ? `<table><thead><tr><th>ASIN</th><th>BSR</th><th>Category</th></tr></thead><tbody>${bsrRows}</tbody></table>` : ''}
      </div>
      <div class="product-card">
        <h4>Interest proxy</h4>
        ${hasProxy ? `<b style="font-size:1.15rem; color:${proxyColor(m.demandProxyScore)};">${fmt.score(m.demandProxyScore)}/100</b>` : '<p class="muted">Not computed yet.</p>'}
        ${proxyDetail}
      </div>
      <div class="product-card">
        <h4>KDP content type</h4>
        ${contentTypeHtml(m)}
      </div>
    </div>

    ${analysisHtml}
    ${opts.legalRequested ? `<button id="legal-btn-here" class="secondary outline">View trademark report</button>` : ''}
    ${sampleTable}
  `;

  if (opts.legalRequested) {
    document.getElementById('legal-btn-here').addEventListener('click', () => openLegalModal(k.keyword));
  }
}

function medianRank(samples) {
  const ranks = (samples || []).map((s) => s.bsr).filter((x) => x != null).sort((a, b) => a - b);
  if (!ranks.length) return null;
  return ranks[Math.floor(ranks.length / 2)];
}

function contentTypeHtml(m) {
  if (!m.contentType || m.contentType === 'unknown') {
    return '<p class="muted">Not classified — passes the publishable-content filter.</p>';
  }
  const excluded = m.contentType === 'high-content-excluded' || m.requiresExpertise;
  const label = escapeHtml(m.contentTypeLabel || m.contentType);
  const source = escapeHtml(m.contentTypeSource ? ` — ${m.contentTypeSource}` : '');
  const conf = m.contentTypeConfidence ? ` · confidence ${escapeHtml(m.contentTypeConfidence)}` : '';
  return excluded
    ? `<b style="color:#e53935;">${label}</b>
       <p class="meta">Excluded from niche shortlist${source}${conf}.</p>`
    : `<b style="color:#2e7d32;">${label}</b>
       <p class="meta">KDP-publishable${source}${conf}.</p>`;
}

function scoreHex(score) {
  if (score == null) return '999999';
  if (score >= 70) return '2e7d32';
  if (score >= 50) return '66bb6a';
  if (score >= 30) return 'f9a825';
  return 'e53935';
}

function proxyColor(s) {
  if (s == null) return '#999';
  if (s >= 60) return '#2e7d32';
  if (s >= 40) return '#f9a825';
  return '#e53935';
}

export async function openLegalModal(keyword) {
  legalModal.hidden = false;
  legalContent.innerHTML = spinner();
  try {
    const r = await send('GET_LEGAL', { keyword });
    if (!r || (!r.searches && !r.riskLevel && !r.report)) {
      legalContent.innerHTML = `<p class="muted">No trademark report saved. Run the trademark check from the row actions first.</p>`;
      return;
    }
    renderLegal(r);
  } catch (err) {
    legalContent.innerHTML = `<p style="color:#e53935;">${escapeHtml(err.message)}</p>`;
  }
}

function renderLegal(r) {
  const risk = r.riskLevel || (r.searches && r.searches.length && r.searches[0].risk) || null;
  const riskLabel = ['low', 'medium', 'high'].includes(risk) ? risk : null;
  const riskClass = riskLabel || 'low';

  const statusFrom = r.searches && r.searches.length
    ? r.searches.map(
        (s) =>
          `<div>
            <b>${escapeHtml(s.type || 'query')}</b> —
            ${s.status === 'ok' ? `No exact matches found for “${escapeHtml(s.phrase || '')}”.` : ''}
            ${s.status === 'flagged' ? `⚠ ${fmt.num(s.count)} potential match(es).` : ''}
            ${s.status === 'error' ? `Check failed (${escapeHtml(s.error || '')}).` : ''}
          </div>`
      ).join('')
    : '';

  const flags = Array.isArray(r.flags) && r.flags.length
    ? r.flags.map((f) => `<div class="legal-flag">⚠ ${escapeHtml(f)}</div>`).join('')
    : riskLabel === 'low'
      ? `<div class="legal-safekeyword">✓ No high-risk trademark or trademark-ish patterns found.</div>`
      : '';

  const safeKeyword = r.safeKeyword
    ? `<p class="legal-note">Safer formulation: <b>${escapeHtml(r.safeKeyword)}</b></p>`
    : '';

  legalContent.innerHTML = `
    <p class="legal-risk ${riskClass}">Risk: ${riskLabel || 'unchecked'}</p>
    ${flags}
    ${statusFrom}
    ${safeKeyword}
    <div class="legal-note">Source: local phrase screen${r.checkedDate ? ` · ${fmt.datetime(r.checkedDate)}` : ''}${r.detailNote ? ` · ${escapeHtml(r.detailNote)}` : ''}.</div>
    <button id="legal-close" class="secondary outline" style="margin-top:.75rem;">Close</button>
  `;
  document.getElementById('legal-close').addEventListener('click', () => (legalModal.hidden = true));
}

legalModal.addEventListener('click', (e) => {
  if (e.target === legalModal) legalModal.hidden = true;
});