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
  // Custom-provider presets feed the model datalist (free-text stays allowed).
  const customs = (modelList && modelList.customModels) || [];
  $('custom-model-list').innerHTML = customs
    .map((m) => `<option value="${escapeHtml(m.id)}">${escapeHtml(m.label || m.id)}</option>`)
    .join('');
}

function toggleProviderBlock() {
  const custom = $('ai-provider').value === 'custom';
  $('custom-ai-block').style.display = custom ? '' : 'none';
  $('model-select').disabled = custom;
}

function fillForm(s) {
  $('api-key').value = s.apiKey || '';
  $('ai-provider').value = s.aiProvider === 'custom' ? 'custom' : 'gemini';
  $('custom-base-url').value = s.customBaseUrl || 'https://openrouter.ai/api/v1';
  $('custom-api-key').value = s.customApiKey || '';
  $('custom-model').value = s.customModel || 'xiaomi/mimo-v2.5';
  toggleProviderBlock();
  $('market-default').innerHTML = marketOptions();
  $('market-default').value = s.market || 'us';
  $('scraped-pages').value = String(s.scrapedPages || 1);
  $('opt-autocomplete').checked = s.autocompleteEnabled !== false;
  $('opt-google').checked = s.googleSuggestEnabled !== false;
  $('opt-panel').checked = s.panelEnabled !== false;

  // Rules v1 gates
  $('max-age-months').value = s.maxBookAgeMonths ?? 6;
  $('fresh-hits-min').value = s.freshHitsMin ?? 1;
  $('overall-bsr-max').value = s.overallBsrMax ?? 200000;
  $('us-listings-max').value = s.usListingsMax ?? 1000;
  $('other-listings-max').value = s.otherListingsMax ?? 800;
  $('volume-threshold').value = s.volumeThreshold ?? 50;
  $('opt-keyword-suggested').checked = s.keywordSuggestedRequired === true;
  $('opt-brandfilter').checked = s.brandFilterEnabled !== false;
  $('opt-subbsr').checked = s.subBsrEnabled === true;
  $('bsr-threshold').value = s.bsrThreshold ?? 200;
  $('format-filter').value = s.formatFilter || '';
  $('opt-contentfilter').checked = s.contentTypeEnabled !== false;
  $('content-scope').value = ['rule8', 'strict', 'standard'].includes(s.contentScope) ? s.contentScope : 'rule8';
  $('opt-niche-fiction').checked = s.allowNicheFiction === true;

  // Trademark markets (rule 5, v0.8: 20 storefronts)
  const ALL_TM = ['us', 'uk', 'fr', 'de', 'it', 'es', 'ca', 'jp', 'au', 'mx', 'br', 'in', 'nl', 'se', 'pl', 'tr', 'sa', 'ae', 'sg', 'eg'];
  const tmMarkets = Array.isArray(s.trademarkMarkets) && s.trademarkMarkets.length
    ? s.trademarkMarkets
    : ALL_TM;
  document.querySelectorAll('.tm-market').forEach((cb) => {
    cb.checked = tmMarkets.includes(cb.value);
  });

  $('opt-enrichment').checked = s.enrichmentEnabled !== false;
  $('enrichment-size').value = String(s.enrichmentSampleSize ?? 8);
  $('enrichment-min-score').value = String(s.enrichmentMinScore ?? 50);

  $('opt-discovery').checked = !!s.discoveryEnabled;
  $('discovery-categories').value = String(s.discoveryCategoryCount ?? 8);
  $('discovery-max-keywords').value = String(s.discoveryMaxKeywords ?? 12);
}

async function handleSave() {
  const s = await settings();
  const tmMarkets = [...document.querySelectorAll('.tm-market')]
    .filter((cb) => cb.checked)
    .map((cb) => cb.value);
  const next = {
    ...s,
    apiKey: $('api-key').value.trim() || null,
    // While the custom provider is active the Gemini dropdown holds no
    // meaningful selection — keep the stored Gemini model untouched so
    // switching back doesn't send a custom id to Google.
    model: $('ai-provider').value === 'custom'
      ? (s.model || undefined)
      : ($('model-select').value || undefined),
    aiProvider: $('ai-provider').value === 'custom' ? 'custom' : 'gemini',
    customBaseUrl: $('custom-base-url').value.trim() || 'https://openrouter.ai/api/v1',
    customApiKey: $('custom-api-key').value.trim() || null,
    customModel: $('custom-model').value.trim() || 'xiaomi/mimo-v2.5',
    market: $('market-default').value || 'us',
    scrapedPages: parseInt($('scraped-pages').value, 10) || 1,
    autocompleteEnabled: $('opt-autocomplete').checked,
    googleSuggestEnabled: $('opt-google').checked,
    panelEnabled: $('opt-panel').checked,

    // Rules v1 gates
    maxBookAgeMonths: parseInt($('max-age-months').value, 10) || 6,
    freshHitsMin: parseInt($('fresh-hits-min').value, 10) || 1,
    overallBsrMax: parseInt($('overall-bsr-max').value, 10) || 200000,
    overallBsrEnabled: true,
    usListingsMax: parseInt($('us-listings-max').value, 10) || 1000,
    otherListingsMax: parseInt($('other-listings-max').value, 10) || 800,
    volumeThreshold: parseInt($('volume-threshold').value, 10) || 50,
    keywordSuggestedRequired: $('opt-keyword-suggested').checked,
    brandFilterEnabled: $('opt-brandfilter').checked,
    subBsrEnabled: $('opt-subbsr').checked,
    bsrThreshold: parseInt($('bsr-threshold').value, 10) || 200,
    formatFilter: $('format-filter').value || null,
    contentTypeEnabled: $('opt-contentfilter').checked,
    contentScope: ['rule8', 'strict', 'standard'].includes($('content-scope').value)
      ? $('content-scope').value
      : 'rule8',
    allowNicheFiction: $('opt-niche-fiction').checked,
    trademarkMarkets: tmMarkets,

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
    showStatus($('settings-status'), 'Settings saved. Rules v1 gates updated.');
  } catch (err) {
    showStatus($('settings-status'), err.message, true);
  }
}

$('save-settings-btn').addEventListener('click', handleSave);
$('ai-provider').addEventListener('change', toggleProviderBlock);