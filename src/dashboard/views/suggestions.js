import { populateMarketSelects } from './../app.js';

let suggestions = [];

export function loadSuggestionsView() {
  populateMarketSelects();

  const goBtn = document.getElementById('suggest-go');
  const seedInput = document.getElementById('suggest-seed');

  if (!goBtn.dataset.bound) {
    goBtn.onclick = () => fetchForSeed(seedInput.value);
    document.getElementById('suggest-expand').onclick = expandFromSuggestions;
    document.getElementById('suggest-clear').onclick = clearAll;
    seedInput.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') fetchForSeed(seedInput.value);
    });
    goBtn.dataset.bound = 'true';
  }

  refresh();
}

async function fetchForSeed(seed) {
  const market = document.getElementById('market-select').value || 'us';
  if (!seed || !seed.trim()) return showStatus('Enter a keyword to fetch suggestions for.');
  showStatus(`Fetching suggestions for "${seed}"…`);
  try {
    const res = await chrome.runtime.sendMessage({ type: 'FETCH_SUGGESTIONS', seed: seed.trim(), market });
    if (!res.ok) throw new Error(res.error);
    const { amazon, google } = res.result;
    const all = [];
    amazon.forEach((k) => all.push({ id: `amazon-autocomplete:${k}:${market}`, keyword: k, source: 'amazon-autocomplete', market, score: 0, expandedFrom: seed }));
    google.forEach((k) => all.push({ id: `google-suggest:${k}:${market}`, keyword: k, source: 'google-suggest', market, score: 0, expandedFrom: seed }));
    const grouped = Object.values(
      all.reduce((acc, s) => {
        if (acc[s.keyword]) acc[s.keyword].source = 'both';
        else acc[s.keyword] = s;
        return acc;
      }, {})
    );
    await chrome.runtime.sendMessage({ type: 'SAVE_SUGGESTIONS', suggestions: grouped }).catch(() => {
      // SAVE_SUGGESTIONS is added by the background router for storage only.
    });
    showStatus(`Collected ${grouped.length} unique suggestions (${amazon.length} Amazon, ${google.length} Google).`);
    refresh();
  } catch (err) {
    showStatus(`Error: ${err.message}`);
  }
}

async function expandFromSuggestions() {
  const market = document.getElementById('market-select').value || 'us';
  showStatus('Expanding all suggestions into scored keywords…');
  try {
    const res = await chrome.runtime.sendMessage({
      type: 'EXPAND_FROM_SUGGESTIONS',
      market
    });
    if (!res.ok) throw new Error(res.error);
    showStatus(`Added ${res.result.count} keywords from suggestions. Auto-scraping started.`);
  } catch (err) {
    showStatus(`Error: ${err.message}`);
  }
}

async function clearAll() {
  await chrome.runtime.sendMessage({ type: 'CLEAR_SUGGESTIONS' }).catch(() => {});
  showStatus('Suggestions cleared.');
  refresh();
}

async function refresh() {
  try {
    const res = await chrome.runtime.sendMessage({ type: 'GET_SUGGESTIONS' });
    if (!res.ok) throw new Error(res.error);
    suggestions = res.result || [];
    render();
  } catch (err) {
    showStatus(`Error: ${err.message}`);
  }
}

function render() {
  const body = document.getElementById('suggest-body');
  const sorted = [...suggestions].sort((a, b) => (b.createdAt || 0) - (a.createdAt || 0));

  if (!sorted.length) {
    body.innerHTML = '<tr><td colspan="6" class="muted">No suggestions yet.</td></tr>';
    return;
  }

  body.innerHTML = sorted
    .map(
      (s) => `<tr>
        <td>${escapeHtml(s.keyword)}</td>
        <td><span class="source-tag">${escapeHtml(s.source)}</span></td>
        <td class="muted">${escapeHtml((s.market || 'us').toUpperCase())}</td>
        <td>${s.score ? Number(s.score).toFixed(2) : '—'}</td>
        <td class="muted">${s.createdAt ? new Date(s.createdAt).toLocaleDateString() : '—'}</td>
        <td>
          <button data-action="scrape" data-keyword="${escapeAttr(s.keyword)}" class="secondary outline">Scrape</button>
        </td>
      </tr>`
    )
    .join('');

  body.querySelectorAll('[data-action="scrape"]').forEach((btn) => {
    btn.onclick = async () => {
      const market = document.getElementById('market-select').value || 'us';
      await chrome.runtime.sendMessage({ type: 'SCRAPE_KEYWORD', payload: { keyword: btn.dataset.keyword, market } });
      showStatus(`Queued "${btn.dataset.keyword}".`);
    };
  });
}

function showStatus(text) {
  document.getElementById('suggest-status').textContent = text;
}

function escapeHtml(s) {
  return String(s).replace(/[&<>"']/g, (c) => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
  }[c]));
}

function escapeAttr(s) {
  return escapeHtml(s);
}