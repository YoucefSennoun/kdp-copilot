import { send, fmt, escapeHtml, showStatus } from '../helpers.js';
import { settings } from '../app.js';
import { getMarkets } from './markets.js';

const $ = (id) => document.getElementById(id);

export async function onShow() {
  await refresh();
}

async function refresh() {
  try {
    const list = await send('GET_SUGGESTIONS');
    renderTable(list);
    showStatus($('suggest-status'), `${list.length} suggestion(s) stored.`);
  } catch (err) {
    showStatus($('suggest-status'), err.message, true);
  }
}

function renderTable(list) {
  const body = $('suggest-body');
  if (!list.length) {
    body.innerHTML =
      '<tr><td colspan="6" class="muted">No suggestions yet. Autocomplete seeds populate this list.</td></tr>';
    return;
  }
  const sorter = (a, b) => (b.score || 0) - (a.score || 0);
  body.innerHTML = [...list]
    .sort(sorter)
    .slice(0, 500)
    .map(
      (s) => `<tr>
        <td>${escapeHtml(s.keyword)}
          <span class="source-tag">${escapeHtml(s.source || 'unknown')}</span>
        </td>
        <td class="muted">${escapeHtml(s.source || '—')}</td>
        <td class="muted">${escapeHtml(s.market || 'us').toUpperCase()}</td>
        <td class="score-badge">${fmt.score(s.score)}</td>
        <td class="muted">${fmt.datetime(s.collectedAt || s.timestamp || s.createdAt)}</td>
        <td>
          <a href="#" class="suggest-expand" data-keyword="${escapeHtml(s.keyword)}">Expand</a> ·
          <a href="#" class="suggest-scrape" data-keyword="${escapeHtml(s.keyword)}">Scrape</a>
        </td>
      </tr>`
    )
    .join('');

  body.querySelectorAll('.suggest-expand').forEach((a) =>
    a.addEventListener('click', async (e) => {
      e.preventDefault();
      await send('EXPAND_SEED', { seed: a.dataset.keyword, market: (await settings()).market });
      showStatus($('suggest-status'), `Expanded "${a.dataset.keyword}" and queued scraping.`);
      refresh();
    })
  );
  body.querySelectorAll('.suggest-scrape').forEach((a) =>
    a.addEventListener('click', async (e) => {
      e.preventDefault();
      await send('SCRAPE_KEYWORD', { keyword: a.dataset.keyword, market: (await settings()).market });
      showStatus($('suggest-status'), `Queued scrape for "${a.dataset.keyword}".`);
    })
  );
}

$('suggest-go').addEventListener('click', async () => {
  const seed = $('suggest-seed').value.trim();
  if (!seed) {
    showStatus($('suggest-status'), 'Enter a keyword first.', true);
    return;
  }
  const s = await settings();
  try {
    const r = await send('FETCH_SUGGESTIONS', { seed, market: s.market });
    showStatus($('suggest-status'), `Saved ${r.amazon.length} Amazon + ${r.google.length} Google suggestions for "${seed}".`);
    refresh();
  } catch (err) {
    showStatus($('suggest-status'), err.message, true);
  }
});

$('suggest-expand').addEventListener('click', async () => {
  const s = await settings();
  try {
    const r = await send('EXPAND_FROM_SUGGESTIONS', { market: s.market });
    showStatus($('suggest-status'), `Expanded ${r.count} unique suggestions; queued scraping.`);
    refresh();
  } catch (err) {
    showStatus($('suggest-status'), err.message, true);
  }
});

$('suggest-clear').addEventListener('click', async () => {
  if (!confirm('Clear all stored suggestions?')) return;
  try {
    await send('CLEAR_SUGGESTIONS');
    refresh();
  } catch (err) {
    showStatus($('suggest-status'), err.message, true);
  }
});