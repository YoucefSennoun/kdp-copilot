(() => {
  if (!/^\/(s|gp\/search)/.test(location.pathname)) return;

  let panel = null;
  let lastKeyword = null;

  function parseCurrency(text) {
    const match = (text || '').match(/[\d,]+(\.\d+)?/);
    return match ? parseFloat(match[0].replace(/,/g, '')) : null;
  }

  function parseNumber(text) {
    const match = (text || '').match(/[\d,.]+/);
    return match ? parseFloat(match[0].replace(/,/g, '')) : null;
  }

  function detectMediaType(cardText) {
    const t = cardText || '';
    if (/\bKindle\b|\bAudible\b/i.test(t)) return 'kindle';
    if (/Paperback/i.test(t)) return 'paperback';
    if (/Hardcover/i.test(t)) return 'hardcover';
    return 'unknown';
  }

  function getListings() {
    const cards = document.querySelectorAll('div[data-component-type="s-search-result"]');
    const listings = [];

    cards.forEach((card) => {
      if (card.querySelector('.AdHolder')) return;
      const asin = card.getAttribute('data-asin');
      if (!asin) return;

      const titleEl = card.querySelector('h2 span, h2');
      const title = titleEl ? titleEl.textContent.trim() : '';

      const priceEl = card.querySelector(
        '.a-price .a-offscreen, .a-price .a-price-whole'
      );
      const revCountEl = card.querySelector(
        'span.a-size-base.s-underline-text, .s-card-container .s-underline-text'
      );
      const ratingEl = card.querySelector(
        'span.a-icon-alt, [aria-label*="out of 5 stars"]'
      );
      const sponsored =
        !!card.querySelector('[data-component-type="s-sponsored-info"]') ||
        !!card.querySelector('.puis-sponsored-label-text') ||
        !!(card.textContent || '').match(/Sponsored/);

      const cardText = card.textContent || '';

      listings.push({
        asin,
        title,
        price: parseCurrency(priceEl ? priceEl.textContent : null),
        reviewCount: revCountEl ? parseNumber(revCountEl.textContent) || 0 : 0,
        avgRating: ratingEl
          ? (() => {
              const label = ratingEl.getAttribute('aria-label') || ratingEl.textContent || '';
              const m = label.match(/(\d(\.\d)?)/);
              return m ? parseFloat(m[1]) : null;
            })()
          : null,
        mediaType: detectMediaType(cardText),
        sponsored
      });
    });

    return listings;
  }

  function getKeyword() {
    const fromUrl = new URLSearchParams(location.search).get('k');
    if (fromUrl) return fromUrl;
    const m = document.title.match(/Amazon\.com:\s*([^:]+)/i);
    return m ? m[1].trim() : '';
  }

  // ------------------------------------------------------------------
  // Research panel (Productor-style floating status bar)
  // ------------------------------------------------------------------

  function ensurePanel() {
    if (panel) return panel;
    const host = document.createElement('div');
    host.id = 'kdp-copilot-panel';
    host.innerHTML = `
      <div class="kdp-head">
        <span class="kdp-logo">KDP Copilot</span>
        <button class="kdp-min" title="Minimize">–</button>
      </div>
      <div class="kdp-body">
        <div class="kdp-keyword" title="Keyword"></div>
        <div class="kdp-row kdp-top">
          <div class="kdp-score">
            <div class="kdp-score-ring"><span class="kdp-score-num">–</span></div>
            <div class="kdp-verdict"></div>
          </div>
          <div class="kdp-bars">
            <div class="kdp-bar"><span>Demand</span><div class="kdp-track"><i data-bar="demand"></i></div></div>
            <div class="kdp-bar"><span>Comp.</span><div class="kdp-track"><i data-bar="competition"></i></div></div>
            <div class="kdp-bar"><span>Margin</span><div class="kdp-track"><i data-bar="margin"></i></div></div>
            <div class="kdp-bar"><span>Conf.</span><div class="kdp-track"><i data-bar="confidence"></i></div></div>
          </div>
        </div>
        <div class="kdp-facts">
          <span class="kdp-fact" data-fact="listings">–</span>
          <span class="kdp-fact" data-fact="sales">–</span>
          <span class="kdp-fact" data-fact="kindle">–</span>
          <span class="kdp-fact" data-fact="sponsored">–</span>
        </div>
        <ul class="kdp-products"></ul>
        <div class="kdp-actions">
          <button class="kdp-btn kdp-ai" title="Run Gemini niche analysis">Analyze with AI</button>
          <button class="kdp-btn kdp-open" title="Open dashboard">Open dashboard</button>
        </div>
        <div class="kdp-status"></div>
      </div>`;
    document.documentElement.appendChild(host);

    host.querySelector('.kdp-min').addEventListener('click', () => {
      host.classList.toggle('kdp-collapsed');
    });
    host.querySelector('.kdp-ai').addEventListener('click', runAiAnalysis);
    host.querySelector('.kdp-open').addEventListener('click', () => {
      chrome.runtime.sendMessage({ type: 'OPEN_DASHBOARD' }).catch(() => {});
    });

    panel = host;
    return panel;
  }

  function setBar(name, pct) {
    const bar = panel.querySelector(`[data-bar="${name}"]`);
    if (bar) {
      bar.style.width = `${Math.round((pct == null ? 0 : pct) * 100)}%`;
      bar.style.backgroundColor = barColor(pct);
    }
  }

  function barColor(v) {
    if (v == null) return '#9aa0a6';
    if (v >= 0.7) return '#2e7d32';
    if (v >= 0.45) return '#f9a825';
    return '#c62828';
  }

  function fmtMoney(v) {
    return v == null ? '–' : `$${Number(v).toFixed(2)}`;
  }

  function fmtSales(v) {
    return v == null ? '–' : `~${Number(v).toLocaleString()} sales/mo`;
  }

  function render(record) {
    const r = record || {};
    const m = r.metrics || {};
    const verdict = r.verdict || { label: 'No data', tone: 'muted' };

    const keywordEl = panel.querySelector('.kdp-keyword');
    keywordEl.textContent = `${r.keyword || 'Unknown keyword'}${r.market ? ` • ${r.market.toUpperCase()}` : ''}`;

    const numEl = panel.querySelector('.kdp-score-num');
    numEl.textContent = r.score == null ? '–' : Math.round(r.score);

    const verdictEl = panel.querySelector('.kdp-verdict');
    verdictEl.textContent = verdict.label || '';
    verdictEl.className = `kdp-verdict kdp-tone-${verdict.tone || 'muted'}`;

    setBar('demand', r.demand);
    setBar('competition', r.competition);
    setBar('margin', r.margin);
    setBar('confidence', r.confidence);

    const facts = {
      listings: `${m.listingCount ?? 0} results`,
      sales: fmtSales(r.estimatedMonthlySales),
      kindle: m.kindleShare != null ? `Kindle ${Math.round(m.kindleShare * 100)}%` : 'Kindle –',
      sponsored: m.sponsoredCount ? `Ad ${m.sponsoredCount}` : 'No ads'
    };
    Object.keys(facts).forEach((k) => {
      const el = panel.querySelector(`[data-fact="${k}"]`);
      if (el) el.textContent = facts[k];
    });

    const list = panel.querySelector('.kdp-products');
    const products = (m.sample || []).slice(0, 5);
    list.innerHTML = products
      .map((p) => {
        const type = p.mediaType && p.mediaType !== 'unknown' ? `<span class="kdp-type">${p.mediaType}</span>` : '';
        const sponsored = p.sponsored ? '<span class="kdp-sp">AD</span>' : '';
        return `<li>
          <span class="kdp-p-title" title="${escapeAttr(p.title || '')}">${escapeHtml(p.title || '–')}</span>
          ${type}${sponsored}
          <span class="kdp-p-meta">${fmtMoney(p.price)} • ${(p.reviewCount || 0).toLocaleString()} ★ ${p.avgRating ?? '–'}</span>
        </li>`;
      })
      .join('');
    if (!products.length) {
      list.innerHTML = '<li class="kdp-muted">No products parsed.</li>';
    }

    panel.querySelector('.kdp-status').textContent = r.confidence != null
      ? `Confidence ${Math.round(r.confidence * 100)}%`
      : 'Waiting for data…';

    panel.classList.add('kdp-visible');
  }

  async function runAiAnalysis() {
    const keyword = currentKeyword();
    if (!keyword) return;
    const aiBtn = panel.querySelector('.kdp-ai');
    aiBtn.disabled = true;
    const status = panel.querySelector('.kdp-status');
    status.textContent = 'Analyzing niche with Gemini…';

    try {
      const res = await chrome.runtime.sendMessage({ type: 'ANALYZE_NICHE', keyword });
      if (!res.ok) throw new Error(res.error);
      showAnalysis(res.result);
      status.textContent = 'AI analysis ready.';
    } catch (err) {
      status.textContent = `AI: ${err.message}`;
    } finally {
      aiBtn.disabled = false;
    }
  }

  function showAnalysis(a) {
    const aEl = panel.querySelector('.kdp-analysis');
    if (aEl) aEl.remove();

    const box = document.createElement('div');
    box.className = 'kdp-analysis';
    box.innerHTML = `
      <h4>AI Niche Read</h4>
      <p class="kdp-one-line">${escapeHtml(a.oneLineRead || '')}</p>
      <div class="kdp-ai-tags">
        <span class="kdp-ai-tag">Comp: ${escapeHtml(a.competitionLevel || '–')}</span>
        <span class="kdp-ai-tag">Demand: ${escapeHtml(a.demandLevel || '–')}</span>
        <span class="kdp-ai-tag">Opp: ${escapeHtml(a.opportunityLevel || '–')}</span>
      </div>
      <p class="kdp-ai-label">Angles</p>
      <ul>${(a.contentAngles || []).map((x) => `<li>${escapeHtml(x)}</li>`).join('')}</ul>`;

    panel.querySelector('.kdp-actions').insertAdjacentElement('beforebegin', box);
  }

  function currentKeyword() {
    return lastKeyword;
  }

  function escapeHtml(s) {
    return String(s).replace(/[&<>"']/g, (c) => ({
      '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
    }[c]));
  }

  function escapeAttr(s) {
    return escapeHtml(s);
  }

  // ------------------------------------------------------------------
  // Flow
  // ------------------------------------------------------------------

  async function scrape() {
    const listings = getListings();
    const keyword = getKeyword();
    if (!keyword) return;

    if (keyword !== lastKeyword) {
      lastKeyword = keyword;
      const host = ensurePanel();
      host.classList.remove('kdp-visible');
    }

    chrome.runtime.sendMessage({
      type: 'SERP_PARSED',
      payload: {
        url: location.href,
        keyword,
        listings
      }
    })
      .then((res) => {
        if (!res.ok) {
          if (panel) panel.querySelector('.kdp-status').textContent = `Error: ${res.error}`;
          return;
        }
        render(res.result && res.result.record);
      })
      .catch(() => {});
  }

  // Re-run when Amazon replaces contents (pagination, category changes).
  const observerTarget = document.getElementById('search');
  if (observerTarget && window.MutationObserver) {
    const observer = new MutationObserver(debounce(() => {
      if (document.readyState === 'complete' || document.readyState === 'interactive') scrape();
    }, 600));
    observer.observe(observerTarget, { childList: true, subtree: true });
    setTimeout(() => observer.disconnect(), 25000);
  }

  function debounce(fn, ms) {
    let t;
    return (...args) => {
      clearTimeout(t);
      t = setTimeout(() => fn(...args), ms);
    };
  }

  window.addEventListener('load', scrape);
  scrape();
})();