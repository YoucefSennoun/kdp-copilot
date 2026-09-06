import { send, escapeHtml, showStatus } from '../helpers.js';
import { settings, invalidateSettings } from '../app.js';
import { marketOptions } from './markets.js';

const $ = (id) => document.getElementById(id);

export async function onShow() {
  const s = await settings();
  await populateModelList(s);
  fillForm(s);
}

async function populateModelList(s) {
  const modelList = await send('GET_MODELS').catch(() => null);
  const models = (modelList && modelList.models) || ['gemini-3.6-flash', 'gemini-3.6-flash-lite', 'gemini-3.6-pro'];
  const sel = $('model-select');
  sel.innerHTML = models.map((m) => `<option value="${escapeHtml(m)}">${escapeHtml(m)}</option>`).join('');
  if (s.model && models.includes(s.model)) sel.value = s.model;
  $('model-select').disabled = !modelList;
}

function fillForm(s) {
  $('api-key').value = s.apiKey || '';
  $('market-default').innerHTML = marketOptions();
  $('market-default').value = s.market || 'us';
  $('scraped-pages').value = String(s.scrapedPages || 1);
  $('opt-autocomplete').checked = s.autocompleteEnabled !== false;
  $('opt-google').checked = s.googleSuggestEnabled !== false;
  $('opt-panel').checked = s.panelEnabled !== false;

  $('bsr-threshold').value = s.bsrThreshold ?? 200;
  $('listings-threshold').value = s.listingsThreshold ?? 1000;
  $('volume-threshold').value = s.volumeThreshold ?? 50;
  $('opt-contentfilter').checked = s.contentTypeEnabled !== false;
  $('opt-niche-fiction').checked = s.allowNicheFiction !== false;

  $('opt-enrichment').checked = s.enrichmentEnabled !== false;
  $('enrichment-size').value = String(s.enrichmentSampleSize ?? 8);
  $('enrichment-min-score').value = String(s.enrichmentMinScore ?? 50);

  $('opt-discovery').checked = !!s.discoveryEnabled;
  $('discovery-categories').value = String(s.discoveryCategoryCount ?? 8);
  $('discovery-max-keywords').value = String(s.discoveryMaxKeywords ?? 12);
}

async function handleSave() {
  const s = await settings();
  const next = {
    ...s,
    apiKey: $('api-key').value.trim() || null,
    model: $('model-select').value || undefined,
    market: $('market-default').value || 'us',
    scrapedPages: parseInt($('scraped-pages').value, 10) || 1,
    autocompleteEnabled: $('opt-autocomplete').checked,
    googleSuggestEnabled: $('opt-google').checked,
    panelEnabled: $('opt-panel').checked,

    bsrThreshold: parseInt($('bsr-threshold').value, 10) || 200,
    listingsThreshold: parseInt($('listings-threshold').value, 10) || 1000,
    volumeThreshold: parseInt($('volume-threshold').value, 10) || 50,
    contentTypeEnabled: $('opt-contentfilter').checked,
    allowNicheFiction: $('opt-niche-fiction').checked,

    enrichmentEnabled: $('opt-enrichment').checked,
    enrichmentSampleSize: parseInt($('enrichment-size').value, 10) || 8,
    enrichmentMinScore: parseInt($('enrichment-min-score').value, 10) || 50,

    discoveryEnabled: $('opt-discovery').checked,
    discoveryIntervalMinutes: $('opt-discovery').checked ? 1440 : 0,
    discoveryCategoryCount: parseInt($('discovery-categories').value, 10) || 8,
    discoveryMaxKeywords: parseInt($('discovery-max-keywords').value, 10) || 12
  };
  try {
    await send('SAVE_SETTINGS', { settings: next });
    invalidateSettings();
    showStatus($('settings-status'), 'Settings saved. Niche thresholds updated.');
  } catch (err) {
    showStatus($('settings-status'), err.message, true);
  }
}

$('save-settings-btn').addEventListener('click', handleSave);