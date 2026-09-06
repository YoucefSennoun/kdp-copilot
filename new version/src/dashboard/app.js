import { send } from './helpers.js';
import * as explorer from './views/explorer.js';
import * as niches from './views/niches.js';
import * as suggestions from './views/suggestions.js';
import * as settingsView from './views/settings.js';

const VIEWS = ['explorer', 'niches', 'suggestions', 'settings'];
const viewModules = { explorer, niches, suggestions, settings: settingsView };

const navLinks = document.querySelectorAll('nav a[data-view]');
const sections = document.querySelectorAll('.tab-content');

function switchView(name) {
  if (!VIEWS.includes(name)) name = 'explorer';
  navLinks.forEach((a) => a.classList.toggle('active', a.dataset.view === name));
  sections.forEach((s) => s.classList.toggle('active', s.id === `view-${name}`));
  viewModules[name].onShow?.();
}

navLinks.forEach((a) =>
  a.addEventListener('click', () => switchView(a.dataset.view))
);

switchView('explorer');

let settingsCache = null;
export async function settings() {
  if (settingsCache) return settingsCache;
  settingsCache = await send('GET_SETTINGS');
  return settingsCache;
}
export function invalidateSettings() {
  settingsCache = null;
}
export function switchTo(view) {
  switchView(view);
}

chrome.runtime.onMessage.addListener((message) => {
  if (message.type === 'QUEUE_PROGRESS') {
    if (document.querySelector('.tab-content.active')?.id === 'view-explorer') {
      explorer.onQueueProgress(message.payload);
    }
  }
});