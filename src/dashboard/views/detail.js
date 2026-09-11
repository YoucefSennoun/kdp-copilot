import { send, fmt, escapeHtml } from '../helpers.js';
import { myResearchBaseUrl } from '../../lib/markets.js';
import { COPYRIGHT_NOTE } from '../../lib/trademark-registry.js';

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
    const k = await send('GET_KEYWORD', { keyword, market: opts.market });
    if (!k) {
      drawer.innerHTML = `<h3>${escapeHtml(keyword)}</h3><p class="muted">No saved data for this keyword yet.</p>`;
      return;
    }
    // Fresh analysis passed straight from the AI button, otherwise fall back
    // to the cached report so Details keeps showing the AI read without
    // re-running (and paying for) the call.
    let analysis = opts.analysis || null;
    if (!analysis) {
      try {
        analysis = await send('GET_ANALYSIS', { keyword, market: opts.market || k.market });
      } catch {
        analysis = null;
      }
    }
    renderDetail(k, { ...opts, analysis });
  } catch (err) {
    drawer.innerHTML = `<h3>${escapeHtml(keyword)}</h3><p style="color:#e53935;">Failed to load: ${escapeHtml(err.message)}</p>`;
  }
}

function renderDetail(k, opts) {
  const m = k.metrics || {};
  const hasBsr = m.bestSubcategoryBsr != null || (Array.isArray(m.bsrSamples) && m.bsrSamples.length);
  const hasResults = m.totalResultsCount != null;
  const hasProxy = m.demandProxyScore != null;

  // Rules v1 (rules 1+2+3, v0.8): per-book freshness + sales + brand read.
  // Each enriched sample shows its age (<6mo = fresh), overall BSR (≤200k =
  // selling), and whether it is a branded book excluded from the fresh-hits
  // count — so the user sees WHICH competitors prove the niche, not just a number.
  const nowTs = Date.now();
  const sixMoMs = 6 * 30.44 * 24 * 60 * 60 * 1000;
  const blockedSet = new Set(m.brandBlockedAsins || []);
  const bsrRows = Array.isArray(m.bsrSamples)
    ? m.bsrSamples
        .filter((s) => s && (s.bsr != null || s.pubDateEpoch != null))
        .map((s) => {
          const ageDays = s.pubDateEpoch != null ? Math.max(0, Math.round((nowTs - s.pubDateEpoch) / 86400000)) : null;
          const isFresh = s.pubDateEpoch != null && nowTs - s.pubDateEpoch <= sixMoMs;
          const isSelling = s.bsr != null && s.bsr <= 200000;
          const isBranded = blockedSet.has(s.asin);
          const freshBadge = s.pubDateEpoch == null
            ? '<span class="muted">—</span>'
            : `<span class="qual-chip ${isFresh ? 'qual-ok' : 'qual-bad'}" title="Published ${escapeHtml(s.pubDate || '')}">${ageDays}d</span>`;
          const bsrBadge = s.bsr == null
            ? '<span class="muted">—</span>'
            : `<b style="color:${s.bsr <= 200000 ? '#2e7d32' : '#c0392b'};">#${fmt.num(s.bsr)}</b>`;
          const brandBadge = isBranded ? ' ⚠<span title="Branded book — excluded from fresh-hits">brand</span>' : '';
          const titleShort = escapeHtml((s.title || s.asin || '—').slice(0, 42));
          return `<tr>
              <td title="${escapeHtml(s.title || s.asin || '')}">${titleShort}${brandBadge}</td>
              <td>${bsrBadge}</td>
              <td>${freshBadge}</td>
              <td class="muted">${escapeHtml(
                Array.isArray(s.allRanks) && s.allRanks.length
                  ? s.allRanks.slice(0, 2).map((r) => `#${fmt.num(r.rank)} ${escapeHtml(r.category || '')}`).join(' · ')
                  : escapeHtml(s.bsrCategory || '—')
              )}</td>
            </tr>`;
        })
        .join('')
    : '';

  // Rule 4 (v0.8): alphabet-soup proof — which a–z extensions hit.
  const proof = m.demandProxyBreakdown && m.demandProxyBreakdown.alphabetProof;
  const proofHtml = proof
    ? `<ul class="muted" style="font-size:.82rem; margin:0.3rem 0;">
        <li>Suffix hits (keyword + a–z): <b>${proof.suffixHits ?? 0}/26</b>${(proof.suffixLetters || []).length ? ` — ${escapeHtml((proof.suffixLetters || []).join(', '))}` : ''}</li>
        <li>Prefix hits (a–z + keyword): <b>${proof.prefixHits ?? 0}/26</b>${(proof.prefixLetters || []).length ? ` — ${escapeHtml((proof.prefixLetters || []).join(', '))}` : ''}</li>
        <li>Keyword itself suggested: <b>${m.keywordSuggested === true || proof.keywordSuggested ? 'yes ✓' : m.keywordSuggested === false ? 'no' : '—'}</b></li>
      </ul>`
    : (m.keywordSuggested != null
      ? `<p class="muted" style="font-size:.82rem;">Keyword itself suggested: <b>${m.keywordSuggested ? 'yes ✓' : 'no'}</b></p>`
      : '');

  // Rule 7 (v0.8): FBA share + MyResearchBase cross-check link.
  const fbaShare = m.fbaShare != null ? Math.round(m.fbaShare * 100) : null;
  const mrbUrl = myResearchBaseUrl(k.market || 'us', k.keyword);
  const fbaHtml = (fbaShare != null || m.fbaCount != null)
    ? `<p class="meta">FBA/Amazon-retail cards: ${fmt.num(m.fbaCount ?? 0)} of ${fmt.num(m.sampleSize ?? (m.sample || []).length)} (${fbaShare ?? 0}%) — verify the KDP-only pool via <a href="${escapeHtml(mrbUrl)}" target="_blank" rel="noreferrer">MyResearchBase ⤴</a></p>`
    : `<p class="meta">Cross-check the KDP-only pool: <a href="${escapeHtml(mrbUrl)}" target="_blank" rel="noreferrer">MyResearchBase ⤴</a></p>`;

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

  const analysisHtml = analysisHtmlFor(opts.analysis);

  function analysisHtmlFor(a) {
    if (!a || typeof a !== 'object') return '';
    // Legacy shape (plain report string).
    if (a.report) {
      return `<h3>AI Niche Analysis</h3><div class="ai-output">${escapeHtml(a.report)}</div>`;
    }
    // Current shape from analyzeNiche: levels + angles + risks.
    if (!a.oneLineRead && !a.entryDifficulty && !Array.isArray(a.contentAngles)) return '';
    const list = (arr) => Array.isArray(arr) && arr.length
      ? `<ul style="margin:.3rem 0;">${arr.map((x) => `<li>${escapeHtml(x)}</li>`).join('')}</ul>`
      : '';
    const level = (label, v) => v
      ? `<span class="muted">${label}:</span> <b>${escapeHtml(v)}</b> &nbsp;`
      : '';
    return `<h3>AI Niche Analysis${a.analyzedAt ? ` <span class="muted" style="font-weight:400; font-size:.8rem;">· ${fmt.datetime(a.analyzedAt)}</span>` : ''}</h3>
      <div class="ai-output">${escapeHtml(a.oneLineRead || '')}</div>
      <p style="margin:.4rem 0;">${level('Competition', a.competitionLevel)}${level('Demand', a.demandLevel)}${level('Opportunity', a.opportunityLevel)}</p>
      ${a.entryDifficulty ? `<p><b>Entry difficulty:</b> ${escapeHtml(a.entryDifficulty)}</p>` : ''}
      ${a.contentAngles ? `<p><b>Underserved angles:</b></p>${list(a.contentAngles)}` : ''}
      ${a.differentiation ? `<p><b>Stand out by:</b></p>${list(a.differentiation)}` : ''}
      ${a.risks ? `<p><b>Risks:</b></p>${list(a.risks)}` : ''}
      ${a.recommendedAudience ? `<p><b>Audience:</b> ${escapeHtml(a.recommendedAudience)}</p>` : ''}
      ${a.pricePoint ? `<p><b>Price point:</b> ${escapeHtml(a.pricePoint)}</p>` : ''}`;
  }

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
      <div class="product-card"><b>Verdict</b><br>${escapeHtml((k.verdict && k.verdict.label) || String(k.verdict || '—'))}</div>
    </div>

    <div class="grid" style="grid-template-columns: repeat(auto-fit, minmax(150px, 1fr)); gap:.5rem; margin-bottom:.75rem;">
      <div class="product-card"><b>Rules-v1 gates</b><br>${gatesHtml(k.qualifies)}</div>
      ${m.brandRisk ? `<div class="product-card"><b>Brand risk (rule 3)</b><br>${m.brandRisk.topBranded ? `<span style="color:#e53935;">⚠ ${m.brandRisk.count} big-brand hit(s): ${escapeHtml((m.brandRisk.matched || []).slice(0, 3).join(', '))}</span>` : '<span style="color:#2e7d32;">✓ brand-free sample</span>'}${m.authorBrand ? `<br><span style="color:#e53935;">✎ author-dominance: ${escapeHtml(m.authorBrand.author)} (${m.authorBrand.count} books)</span>` : ''}</div>` : ''}
      ${m.formatShares ? `<div class="product-card"><b>Formats (rule 6)</b><br>${formatSharesHtml(m.formatShares)}<br><span class="muted" style="font-size:.75rem;">Books-only search ✓</span></div>` : ''}
    </div>

    <div class="grid" style="grid-template-columns: repeat(auto-fit, minmax(230px, 1fr)); gap:.5rem;">
      <div class="product-card">
        <h4>Total results (rule 1)</h4>
        ${hasResults
          ? `<b style="font-size:1.15rem;">${m.resultsCountIsApprox ? '≈' : ''}${fmt.num(m.totalResultsCount)}</b>
             <p class="meta">cap: US ≤1000 / others ≤800 · filtered ${fmt.num(m.filteredCount ?? (Array.isArray(m.sample) ? m.sample.length : 0))} titles to ${fmt.num(m.distinctTitleCount ?? 0)} distinct</p>
             ${fbaHtml}
             ${m.locationDesired || m.locationActual ? `<p class="meta">📍 Deliver-to: ${escapeHtml(m.locationActual || m.locationDesired)}${m.locationPinned === true ? ' ✓ pinned' : m.locationPinned === false ? ' (pin failed — session location used)' : ''} · market zip ${escapeHtml(m.locationDesired || '—')}</p>` : ''}`
          : `<p class="muted">No SERP scraped yet — results count comes from Amazon SERP.</p>${fbaHtml}`}
      </div>
      <div class="product-card">
        <h4>BSR — sellers proving demand (rule 2)</h4>
        ${hasBsr
          ? m.bestSubcategoryBsr != null
            ? `<b style="font-size:1.15rem;">#${fmt.num(m.bestSubcategoryBsr)}</b>
               ${m.bestSubcategoryBsrCategory ? `<p class="meta">${escapeHtml(m.bestSubcategoryBsrCategory)}</p>` : ''}
               <p class="meta">good niche ≤200k · coverage ${fmt.pct(m.bsrCoverage)} · ${fmt.num(Array.isArray(m.bsrSamples) ? m.bsrSamples.length : 0)}/${fmt.num(m.bsrExpected)} products</p>`
            : `<b style="font-size:1.15rem;">#${fmt.num(medianRank(m.bsrSamples))}</b><p class="meta">median of partial samples — enrichment still running</p>`
          : '<p class="muted">No BSR yet — auto-enrichment opens product pages for shortlisted keywords.</p>'}
        ${bsrRows ? `<table><thead><tr><th>Book</th><th>BSR</th><th>Age</th><th>Category</th></tr></thead><tbody>${bsrRows}</tbody></table><p class="meta">Age = days since publication (green ≤6mo = fresh, rule 1). Branded books are excluded from fresh-hits (rule 3).</p>` : ''}
      </div>
      <div class="product-card">
        <h4>Search volume proof (rule 4)</h4>
        ${hasProxy ? `<b style="font-size:1.15rem; color:${proxyColor(m.demandProxyScore)};">${fmt.score(m.demandProxyScore)}/100</b>` : '<p class="muted">Not computed yet.</p>'}
        ${proxyDetail}
        ${proofHtml}
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
    document.getElementById('legal-btn-here').addEventListener('click', () => openLegalModal(k.keyword, k.market));
  }
}

function medianRank(samples) {
  const ranks = (samples || []).map((s) => s.bsr).filter((x) => x != null).sort((a, b) => a - b);
  if (!ranks.length) return null;
  return ranks[Math.floor(ranks.length / 2)];
}

function gatesHtml(q) {
  if (!q) return '<span class="muted">—</span>';
  const chip = (ok, label, title) =>
    `<span class="qual-chip ${ok ? 'qual-ok' : 'qual-bad'}" title="${escapeHtml(title || '')}">${label}</span>`;
  const parts = [];
  if (q.fresh != null) parts.push(chip(q.fresh, 'NEW', 'New (<6mo) + selling + unbranded competitors'));
  if (q.bsrOverall != null) parts.push(chip(q.bsrOverall, 'BSR', 'Overall Books BSR ≤ 200k'));
  if (q.listings != null) parts.push(chip(q.listings, 'LIST', 'Results ≤ market cap (US 1000 / others 800)'));
  if (q.volume != null) parts.push(chip(q.volume, 'VOL', 'Interest proxy ≥ threshold'));
  if (q.brand != null) parts.push(chip(q.brand, 'BRAND', 'No big-brand book in sample'));
  if (!parts.length) return '<span class="muted">—</span>';
  return parts.join(' ');
}

function formatSharesHtml(shares) {
  return Object.entries(shares || {})
    .filter(([key, v]) => v > 0 && key !== 'unknown')
    .map(([key, v]) => `${escapeHtml(key)} ${Math.round(v * 100)}%`)
    .join(' · ') || '<span class="muted">—</span>';
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

export async function openLegalModal(keyword, market) {
  legalModal.hidden = false;
  legalContent.innerHTML = spinner();
  try {
    const r = await send('GET_LEGAL', { keyword, market });
    if (!r || (!r.risk && !r.verdict && !r.perMarket && !r.flagged)) {
      legalContent.innerHTML = `<p class="muted">No trademark report saved. Run the trademark check from the row actions first.</p>
        <button id="legal-close" class="secondary outline" style="margin-top:.75rem;">Close</button>`;
      document.getElementById('legal-close').addEventListener('click', () => (legalModal.hidden = true));
      return;
    }
    renderLegal(r, market);
  } catch (err) {
    legalContent.innerHTML = `<p style="color:#e53935;">${escapeHtml(err.message)}</p>`;
  }
}

function renderLegal(r, market) {
  const risk = r.risk || 'unchecked';
  const riskLabel = ['low', 'medium', 'high'].includes(risk) ? risk : null;
  const riskClass = riskLabel || 'low';

  // Per-market rows (rule 5): AI or local screen per marketplace.
  const perMarket = r.perMarket || {};
  const marketRows = Object.keys(perMarket).map((mc) => {
    const v = perMarket[mc] || {};
    const tone = v.risk === 'high' ? '#e53935' : v.risk === 'medium' ? '#f9a825' : '#2e7d32';
    return `<tr>
      <td><b>${mc.toUpperCase()}</b></td>
      <td style="color:${tone}; font-weight:700;">${escapeHtml(v.risk || '—')}</td>
      <td>${escapeHtml(v.verdict || '—')}</td>
    </tr>`;
  }).join('');

  // Registry deep links (rule 5) — official databases + the aggregator.
  const lookups = (r.registryLookups || []).map((l) =>
    `<a class="legal-registry-link" href="${escapeHtml(l.searchUrl)}" target="_blank" rel="noreferrer" title="${escapeHtml(l.registry)} — ${escapeHtml(l.classHint || '')}">
      ${escapeHtml(l.label)}${l.prefilled ? ' ⤴' : ''}</a>`
  ).join(' ');

  const flags = Array.isArray(r.flagged) && r.flagged.length
    ? r.flagged.map((f) => {
        const markets = Array.isArray(f.markets) && f.markets.length ? ` <span class="muted">(${f.markets.map((m) => m.toUpperCase()).join(', ')})</span>` : '';
        return `<div class="legal-flag">⚠ <b>${escapeHtml(f.term || '')}</b>${markets} <span class="muted">${escapeHtml(f.type || '')}${f.owner ? ` · ${escapeHtml(f.owner)}` : ''}</span><div>${escapeHtml(f.why || '')}</div></div>`;
      }).join('')
    : riskLabel === 'low'
      ? `<div class="legal-safekeyword">✓ No high-risk trademark or trademark-ish patterns found.</div>`
      : '';

  const safeKeyword = r.safeKeyword && r.safeKeyword !== r.keyword
    ? `<p class="legal-note">Safer formulation: <b>${escapeHtml(r.safeKeyword)}</b></p>`
    : '';

  legalContent.innerHTML = `
    <p class="legal-risk ${riskClass}">Risk: ${riskLabel || 'unchecked'}</p>
    <p>${escapeHtml(r.verdict || '')}</p>
    ${flags}
    ${marketRows ? `<h3 style="font-size:.95rem; margin:.8rem 0 .3rem;">Per-market screen</h3>
      <table><thead><tr><th>Mkt</th><th>Risk</th><th>Note</th></tr></thead><tbody>${marketRows}</tbody></table>` : ''}
    ${lookups ? `<h3 style="font-size:.95rem; margin:.8rem 0 .3rem;">Registry verification (official databases)</h3>
      <p style="margin:.2rem 0 .5rem;" class="muted">Verify in each market's official registry. ⤴ = search pre-filled with the keyword.</p>
      <div style="display:flex; flex-wrap:wrap; gap:.4rem;">${lookups}</div>` : ''}
    ${safeKeyword}
    ${(r.notes || []).map((n) => `<p class="legal-note">• ${escapeHtml(n)}</p>`).join('')}
    <p class="legal-note">© Copyright: ${escapeHtml(COPYRIGHT_NOTE)}</p>
    <div class="legal-note">Source: ${r.ai ? 'AI review + local screen' : 'local multi-market phrase screen'}${r.checkedAt ? ` · ${fmt.datetime(r.checkedAt)}` : ''}.</div>
    <div style="display:flex; gap:.5rem; margin-top:.75rem;">
      <button id="legal-rerun" class="secondary outline">Re-check</button>
      <button id="legal-close" class="contrast outline">Close</button>
    </div>`;

  document.getElementById('legal-rerun').onclick = async () => {
    const btn = document.getElementById('legal-rerun');
    btn.disabled = true;
    btn.textContent = 'Checking…';
    legalContent.insertAdjacentHTML('afterbegin',
      '<p class="legal-note" id="legal-wait">Asking the AI to review every market — this can take up to a minute…</p>');
    try {
      const res = await send('CHECK_TRADEMARK', { keyword: r.keyword, market: market || r.market });
      renderLegal(res, market || r.market);
    } catch (err) {
      document.getElementById('legal-wait')?.remove();
      legalContent.insertAdjacentHTML('beforeend',
        `<p class="legal-note" style="color:#e53935;">Re-check failed: ${escapeHtml(err.message)}</p>`);
      btn.disabled = false;
      btn.textContent = 'Re-check';
    }
  };
  document.getElementById('legal-close').addEventListener('click', () => (legalModal.hidden = true));
}

legalModal.addEventListener('click', (e) => {
  if (e.target === legalModal) legalModal.hidden = true;
});