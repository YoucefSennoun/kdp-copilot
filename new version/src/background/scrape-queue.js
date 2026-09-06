const DEFAULT_INTERVAL_MS = 3500;
const DEFAULT_ENRICHMENT_INTERVAL_MS = 6000;
const DEFAULT_DISCOVERY_INTERVAL_MS = 3500;
const DEFAULT_TIMEOUT_MS = 30000;
const MAX_QUEUE_SIZE = 200;

const STATUS = {
  IDLE: 'idle',
  RUNNING: 'running',
  PAUSED: 'paused'
};

const STAGE = {
  IDLE: 'idle',
  SERP: 'serp',
  ENRICHMENT: 'enrichment',
  DISCOVERY: 'discovery'
};

/**
 * Serialized scrape orchestrator. Opens one Amazon tab at a time for a task,
 * waits for the content script to report SERP_PARSED / PRODUCT_PARSED
 * (background closes the tab), and only then moves to the next item. A timeout
 * guard closes orphaned tabs so long research batches never leak tabs.
 *
 * Task model (Phase 2):
 *   { type: 'serp',    keyword, market, scrapedPages }
 *   { type: 'product', asin, parentKeyword, market }
 * Product (BSR enrichment) tasks run at a slower interval (stealth decision).
 */
class ScrapeQueue {
  constructor({
    intervalMs = DEFAULT_INTERVAL_MS,
    enrichmentIntervalMs = DEFAULT_ENRICHMENT_INTERVAL_MS,
    discoveryIntervalMs = DEFAULT_DISCOVERY_INTERVAL_MS,
    timeoutMs = DEFAULT_TIMEOUT_MS,
    maxSize = MAX_QUEUE_SIZE
  } = {}) {
    this.queue = [];
    this.intervalMs = intervalMs;
    this.enrichmentIntervalMs = enrichmentIntervalMs;
    this.discoveryIntervalMs = discoveryIntervalMs;
    this.timeoutMs = timeoutMs;
    this.maxSize = maxSize;
    this.running = false;
    this.status = STATUS.IDLE;
    this.stage = STAGE.IDLE;
    this.onScrape = null;
    this.pendingTabs = new Map(); // tabId -> { task, resolve, timer }
    this.listeners = new Set();
    this.completed = 0;
    this.failed = 0;
  }

  setHandler(fn) {
    this.onScrape = fn;
  }

  onProgress(fn) {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  }

  get size() {
    return this.queue.length;
  }

  get idle() {
    return this.status === STATUS.IDLE && this.pendingTabs.size === 0;
  }

  enqueue(task) {
    if (this.queue.length >= this.maxSize) this.queue.shift();
    this.queue.push(task);
    this._emit();
    this._start();
  }

  enqueueMany(tasks) {
    const room = this.maxSize - this.queue.length;
    this.queue.push(...tasks.slice(0, Math.max(0, room)));
    this._emit();
    this._start();
  }

  setInterval(ms) {
    this.intervalMs = ms;
  }

  setEnrichmentInterval(ms) {
    this.enrichmentIntervalMs = ms;
  }

  clear() {
    this.queue.length = 0;
    this._emit();
  }

  stop() {
    this.status = STATUS.PAUSED;
    this.running = false;
    this._emit();
  }

  /**
   * Hard reset: drop queued tasks, close every in-flight scrape tab,
   * and return to the idle state. Used by "Start over".
   */
  abort() {
    this.queue.length = 0;
    this.pendingTabs.forEach((pending, tabId) => {
      clearTimeout(pending.timer);
      this._safeClose(tabId);
      pending.resolve({ ok: false, error: 'aborted' });
    });
    this.pendingTabs.clear();
    this.running = false;
    this.status = STATUS.IDLE;
    this.stage = STAGE.IDLE;
    this._emit();
  }

  resume() {
    if (this.status !== STATUS.PAUSED) return;
    this.running = false;
    this.status = STATUS.IDLE;
    this._start();
  }

  /**
   * Called by the background message router when SERP_PARSED / PRODUCT_PARSED
   * arrives. Resolves the pending task tied to the sender tab and closes it.
   */
  resolveTab(tabId, result) {
    const pending = this.pendingTabs.get(tabId);
    if (!pending) return false;
    clearTimeout(pending.timer);
    this.pendingTabs.delete(tabId);
    this.completed++;
    pending.resolve({ ok: true, result });
    this._safeClose(tabId);
    this._emit();
    return true;
  }

  failTabPermanently(tabId) {
    const pending = this.pendingTabs.get(tabId);
    if (!pending) return false;
    clearTimeout(pending.timer);
    this.pendingTabs.delete(tabId);
    this.failed++;
    pending.resolve({ ok: false, error: 'tab-result-lost' });
    this._emit();
    return true;
  }

  /**
   * Resolve a task as failed (e.g. CAPTCHA-blocked page) while still closing
   * its tab promptly — avoids waiting out the whole timeout per blocked page.
   */
  resolveTabFailed(tabId, result) {
    const pending = this.pendingTabs.get(tabId);
    if (!pending) return false;
    clearTimeout(pending.timer);
    this.pendingTabs.delete(tabId);
    this.failed++;
    pending.resolve({ ok: true, result });
    this._safeClose(tabId);
    this._emit();
    return true;
  }

  taskForTab(tabId) {
    const pending = this.pendingTabs.get(tabId);
    return pending ? pending.task : null;
  }

  _start() {
    if (this.status === STATUS.PAUSED || this.running) return;
    this.running = true;
    this.status = STATUS.RUNNING;
    this._loop();
  }

  async _loop() {
    while (this.queue.length > 0 && this.status !== STATUS.PAUSED) {
      const task = this.queue.shift();
      this.stage = task && task.type === 'product'
        ? STAGE.ENRICHMENT
        : task && task.type === 'discovery'
          ? STAGE.DISCOVERY
          : STAGE.SERP;
      this._emit();

      try {
        if (this.onScrape) {
          await this._runTask(task);
        }
      } catch (err) {
        console.warn('[KDP Copilot] scrape failed', task, err);
        this.failed++;
      }

      this._emit();

      if (this.queue.length > 0 && this.status !== STATUS.PAUSED) {
        const next = this.queue[0];
        const delay = (next && next.type === 'product')
          ? this.enrichmentIntervalMs
          : (next && next.type === 'discovery')
            ? this.discoveryIntervalMs || DEFAULT_DISCOVERY_INTERVAL_MS
            : this.intervalMs;
        await this._sleep(delay);
      }
    }

    // Wait for any in-flight parse to finish before declaring idle.
    while (this.pendingTabs.size > 0 && this.status !== STATUS.PAUSED) {
      await this._sleep(500);
    }

    this.running = false;
    this.status = STATUS.IDLE;
    this.stage = STAGE.IDLE;
    this._emit();
  }

  async _runTask(task) {
    return new Promise((resolve) => {
      let called = false;
      const done = (result) => {
        if (called) return;
        called = true;
        resolve(result);
      };

      let tabId = null;

      try {
        this.onScrape(task).then(
          (tab) => {
            if (!tab || tab.id == null) return done({ ok: false, error: 'no-tab' });
            tabId = tab.id;
            this._registerPending(tabId, task, done);
          },
          (err) => done({ ok: false, error: err.message })
        );
      } catch (err) {
        return done({ ok: false, error: err.message });
      }

      // Safety net: if the handler never returns a tab and never fails,
      // avoid hanging the loop forever.
      setTimeout(() => {
        if (!called) done({ ok: false, error: 'handler-timeout' });
      }, 15000);
    });
  }

  _registerPending(tabId, task, resolve) {
    const timer = setTimeout(() => {
      if (!this.pendingTabs.has(tabId)) return;
      this.pendingTabs.delete(tabId);
      this.failed++;
      this._safeClose(tabId);
      resolve({ ok: false, error: 'scrape-timeout' });
      this._emit();
    }, this.timeoutMs);

    this.pendingTabs.set(tabId, { task, resolve, timer });
  }

  _safeClose(tabId) {
    chrome.tabs.get(tabId, (tab) => {
      if (chrome.runtime.lastError) return;
      chrome.tabs.remove(tabId);
    });
  }

  _sleep(ms) {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }

  _emit() {
    const snapshot = {
      size: this.queue.length,
      running: this.status === STATUS.RUNNING,
      paused: this.status === STATUS.PAUSED,
      pending: this.pendingTabs.size,
      completed: this.completed,
      failed: this.failed,
      idle: this.idle,
      stage: this.stage
    };
    this.listeners.forEach((fn) => fn(snapshot));
  }
}

export const scrapeQueue = new ScrapeQueue();

export { STATUS, STAGE };