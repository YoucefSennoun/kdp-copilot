import { MARKETS } from '../lib/markets.js';
import { loadExplorerView } from './views/explorer.js';
import { loadSuggestionsView } from './views/suggestions.js';
import { loadSettingsView } from './views/settings.js';

function switchView(name) {
  document.querySelectorAll('.tab-content').forEach((el) => {
    el.classList.toggle('active', el.id === `view-${name}`);
  });
  document.querySelectorAll('nav a').forEach((el) => {
    el.classList.toggle('active', el.dataset.view === name);
  });

  if (name === 'explorer') loadExplorerView();
  if (name === 'suggestions') loadSuggestionsView();
  if (name === 'settings') loadSettingsView();
}

export function populateMarketSelects() {
  const options = Object.values(MARKETS)
    .map((m) => `<option value="${m.code}">${m.label}</option>`)
    .join('');
  ['market-select', 'market-default'].forEach((id) => {
    const el = document.getElementById(id);
    if (el && !el.dataset.filled) {
      el.innerHTML = options;
      el.dataset.filled = 'true';
    }
  });
}

document.querySelectorAll('nav a').forEach((el) => {
  el.addEventListener('click', () => switchView(el.dataset.view));
});

chrome.runtime.onMessage.addListener((message) => {
  if (message.type === 'QUEUE_PROGRESS') {
    import('./views/explorer.js').then(({ updateQueueBar }) => updateQueueBar(message.payload));
  }
});

switchView('explorer');