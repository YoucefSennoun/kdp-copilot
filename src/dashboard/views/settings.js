import { MODEL_CHOICES } from '../../background/ai.js';
import { MARKETS } from '../../lib/markets.js';

export function loadSettingsView() {
  const modelSelect = document.getElementById('model-select');
  if (!modelSelect.dataset.filled) {
    modelSelect.innerHTML = MODEL_CHOICES
      .map((m) => `<option value="${m.id}">${m.label}</option>`)
      .join('');
    modelSelect.dataset.filled = 'true';
  }

  const marketDefault = document.getElementById('market-default');
  if (!marketDefault.dataset.filled) {
    marketDefault.innerHTML = Object.values(MARKETS)
      .map((m) => `<option value="${m.code}">${m.label}</option>`)
      .join('');
    marketDefault.dataset.filled = 'true';
  }

  const loadBtn = document.getElementById('save-settings-btn');
  const statusEl = document.getElementById('settings-status');

  async function load() {
    const res = await chrome.runtime.sendMessage({ type: 'GET_SETTINGS' });
    if (!res.ok) return;
    const s = res.result;
    document.getElementById('api-key').value = s.apiKey || '';
    modelSelect.value = s.model || 'gemini-3.6-flash';
    marketDefault.value = s.market || 'us';
    document.getElementById('scraped-pages').value = String(s.scrapedPages || 1);
    document.getElementById('opt-autocomplete').checked = s.autocompleteEnabled !== false;
    document.getElementById('opt-google').checked = s.googleSuggestEnabled !== false;
    document.getElementById('opt-panel').checked = s.panelVisible !== false;
  }

  loadBtn.onclick = async () => {
    statusEl.textContent = 'Saving…';
    const settings = {
      apiKey: document.getElementById('api-key').value.trim(),
      model: modelSelect.value,
      market: marketDefault.value,
      scrapedPages: parseInt(document.getElementById('scraped-pages').value || '1', 10),
      autocompleteEnabled: document.getElementById('opt-autocomplete').checked,
      googleSuggestEnabled: document.getElementById('opt-google').checked,
      panelVisible: document.getElementById('opt-panel').checked
    };
    const res = await chrome.runtime.sendMessage({ type: 'SAVE_SETTINGS', settings });
    statusEl.textContent = res.ok ? 'Saved.' : `Error: ${res.error}`;
  };

  load();
}