export async function loadDetailView(record) {
  const drawer = document.getElementById('detail-drawer');
  drawer.hidden = false;

  const m = record.metrics || {};
  const products = m.sample || record.sample || [];

  drawer.innerHTML = `
    <h3>${escapeHtml(record.keyword)} <span class="muted">(${(record.market || 'us').toUpperCase()})</span></h3>
    <div class="pill-row">
      <span class="pill highlight">Score ${fmt(record.score)}</span>
      <span class="pill">Demand ${fmtPct(record.demand)}</span>
      <span class="pill">Comp ${fmtPct(record.competition)}</span>
      <span class="pill">Margin ${fmtPct(record.margin)}</span>
      <span class="pill">Conf ${fmtPct(record.confidence)}</span>
      ${m.estimatedMonthlySales != null ? `<span class="pill">Sales ~${Number(m.estimatedMonthlySales).toLocaleString()}/mo</span>` : ''}
      <span class="pill">${escapeHtml((record.verdict && record.verdict.label) || 'No verdict')}</span>
    </div>

    <div class="grid" style="grid-template-columns: repeat(4, 1fr);">
      <div><strong>Results</strong><br />${m.listingCount ?? '—'}</div>
      <div><strong>Avg price</strong><br />${fmtMoney(m.avgPrice)} <span class="muted">(${fmtMoney(m.lowPrice)}–${fmtMoney(m.highPrice)})</span></div>
      <div><strong>Avg reviews</strong><br />${fmtNum(m.avgReviewCount ?? m.avgReviews)}</div>
      <div><strong>Median BSR</strong><br />${fmtNum(m.medianRank ?? m.avgBsr)}</div>
    </div>

    <div class="action-row" style="margin: 0.8rem 0; display:flex; gap:0.5rem;">
      <button id="ai-analyze-btn" class="secondary">Analyze Niche with AI</button>
      <button id="ai-listing-btn" class="secondary outline">Generate Listing Package</button>
      <button id="close-detail-btn" class="contrast outline">Close</button>
    </div>
    <div id="detail-ai" class="ai-output muted" hidden></div>

    <h4>Top products (${products.length})</h4>
    <div class="product-grid">
      ${products.map((p) => productCard(p)).join('') || '<p class="muted">No product sample scraped. Use “Scrape Unscraped”.</p>'}
    </div>
  `;

  const closeBtn = drawer.querySelector('#close-detail-btn');
  closeBtn.onclick = () => { drawer.hidden = true; drawer.innerHTML = ''; };

  const aiBtn = drawer.querySelector('#ai-analyze-btn');
  aiBtn.onclick = async () => {
    const out = drawer.querySelector('#detail-ai');
    out.hidden = false;
    out.textContent = 'Thinking…';
    aiBtn.disabled = true;
    try {
      const res = await chrome.runtime.sendMessage({ type: 'ANALYZE_NICHE', keyword: record.keyword });
      if (!res.ok) throw new Error(res.error);
      out.textContent = formatAnalysis(res.result);
    } catch (err) {
      out.textContent = `Error: ${err.message}`;
    } finally {
      aiBtn.disabled = false;
    }
  };

  const listingBtn = drawer.querySelector('#ai-listing-btn');
  listingBtn.onclick = async () => {
    const out = drawer.querySelector('#detail-ai');
    out.hidden = false;
    out.textContent = 'Writing listing…';
    listingBtn.disabled = true;
    try {
      const res = await chrome.runtime.sendMessage({
        type: 'GENERATE_LISTING',
        keyword: record.keyword,
        niche: record.keyword
      });
      if (!res.ok) throw new Error(res.error);
      out.textContent = formatListing(res.result);
    } catch (err) {
      out.textContent = `Error: ${err.message}`;
    } finally {
      listingBtn.disabled = false;
    }
  };
}

function productCard(p) {
  const type = p.mediaType && p.mediaType !== 'unknown' ? `<span class="pill">${escapeHtml(p.mediaType)}</span>` : '';
  const sponsored = p.sponsored ? '<span class="pill">AD</span>' : '';
  return `<div class="product-card">
    <h4>${escapeHtml(p.title || 'Untitled')}</h4>
    <div>${type}${sponsored}</div>
    <p class="meta">Price: ${fmtMoney(p.price)}</p>
    <p class="meta">Reviews: ${fmtNum(p.reviewCount)} • ★ ${p.avgRating ?? '—'}</p>
    <p class="meta">ASIN: <code>${escapeHtml(p.asin || '—')}</code></p>
  </div>`;
}

function formatAnalysis(a) {
  if (!a) return 'No analysis returned.';
  const lines = [
    ['One-line Read', a.oneLineRead],
    ['Competition', a.competitionLevel],
    ['Demand', a.demandLevel],
    ['Opportunity', a.opportunityLevel],
    ['Entry Difficulty', a.entryDifficulty],
    ['Recommended Audience', a.recommendedAudience],
    ['Price Point', a.pricePoint]
  ].filter(([, v]) => v != null && v !== '').map(([k, v]) => `${k}: ${v}`);

  ['contentAngles', 'differentiation', 'risks'].forEach((key) => {
    if (Array.isArray(a[key]) && a[key].length) {
      lines.push('', `${key[0].toUpperCase() + key.slice(1)}:`);
      a[key].forEach((item) => lines.push(`  • ${item}`));
    }
  });

  return lines.join('\n');
}

function formatListing(l) {
  if (!l) return 'No listing returned.';
  const lines = [];
  if (l.title) lines.push(`Title: ${l.title}`);
  if (l.subtitle) lines.push(`Subtitle: ${l.subtitle}`);
  if (Array.isArray(l.sevenKeywords) && l.sevenKeywords.length) {
    lines.push('', 'Backend keywords (7):');
    l.sevenKeywords.forEach((k, i) => lines.push(`  ${i + 1}. ${k}`));
  }
  if (Array.isArray(l.bulletPoints) && l.bulletPoints.length) {
    lines.push('', 'Bullet points:');
    l.bulletPoints.forEach((b) => lines.push(`  • ${b}`));
  }
  if (l.description) lines.push('', `Description:\n${l.description}`);
  return lines.join('\n');
}

function fmt(v) {
  return v == null ? '—' : Number(v).toFixed(0);
}

function fmtPct(v) {
  return v == null ? '—' : `${(Number(v) * 100).toFixed(0)}%`;
}

function fmtMoney(v) {
  return v == null ? '—' : `$${Number(v).toFixed(2)}`;
}

function fmtNum(v) {
  return v == null || Number.isNaN(v) ? '—' : Number(v).toLocaleString();
}

function escapeHtml(s) {
  return String(s).replace(/[&<>"']/g, (c) => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
  }[c]));
}