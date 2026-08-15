// popup.js — ENGRAM Chrome Extension popup controller
// Requirements:
//   6.1  Pause/resume control visible at all times
//   6.3  Resume resumes all passive capture activities
//   6.4  Visual indicator when paused (badge text OFF/ON)
//   NEW  Show last 5 captured items with type badge + title + time

(async function () {
  'use strict';

  const toggleBtn     = document.getElementById('toggle-btn');
  const statusText    = document.getElementById('status-text');
  const statusDot     = document.getElementById('status-dot');
  const queueCount    = document.getElementById('queue-count');
  const thresholdVal  = document.getElementById('threshold-value');
  const captureLog    = document.getElementById('capture-log');

  // ─── Helpers ──────────────────────────────────────────────────────────────

  function timeAgo(ts) {
    const diff = Math.floor((Date.now() - ts) / 1000);
    if (diff < 60)   return `${diff}s ago`;
    if (diff < 3600) return `${Math.floor(diff / 60)}m ago`;
    return `${Math.floor(diff / 3600)}h ago`;
  }

  function badgeHtml(type) {
    const map = {
      url:     ['URL',   'type-url'],
      youtube: ['YT',    'type-yt'],
      desktop: ['DESK',  'type-desk'],
    };
    const [label, cls] = map[type] || ['?', 'type-url'];
    return `<span class="type-badge ${cls}">${label}</span>`;
  }

  // ─── Render capture log ───────────────────────────────────────────────────

  function renderLog(queue) {
    if (!queue || queue.length === 0) {
      captureLog.innerHTML = '<div class="log-empty">No captures yet — browse to start.</div>';
      return;
    }
    // Show last 5, most recent first
    const items = [...queue].reverse().slice(0, 5);
    captureLog.innerHTML = items.map(item => {
      const title = item.title || item.url || item.app || '(unknown)';
      const shortTitle = title.length > 38 ? title.slice(0, 38) + '…' : title;
      const type = item.type || 'url';
      const ts   = item.queued_at || item.timestamp || Date.now();
      return `
        <div class="log-item">
          ${badgeHtml(type)}
          <span class="log-text" title="${title}">${shortTitle}</span>
          <span class="log-time">${timeAgo(ts)}</span>
        </div>`;
    }).join('');
  }

  // ─── Load and render state ────────────────────────────────────────────────

  async function loadState() {
    const {
      tracking_paused   = false,
      capture_queue     = [],
      reading_threshold = 60,
    } = await chrome.storage.local.get([
      'tracking_paused', 'capture_queue', 'reading_threshold',
    ]);

    updateUI(tracking_paused, capture_queue.length, reading_threshold);
    renderLog(capture_queue);
  }

  function updateUI(isPaused, queueLen, threshold) {
    if (isPaused) {
      statusText.textContent = 'Paused';
      statusText.className   = 'status-value paused';
      statusDot.className    = 'dot paused';
      toggleBtn.textContent  = 'Resume';
      toggleBtn.classList.add('paused');
    } else {
      statusText.textContent = 'Active';
      statusText.className   = 'status-value active';
      statusDot.className    = 'dot';
      toggleBtn.textContent  = 'Pause';
      toggleBtn.classList.remove('paused');
    }
    queueCount.textContent  = String(queueLen);
    thresholdVal.textContent = `${threshold}s`;
  }

  // ─── Toggle pause/resume ──────────────────────────────────────────────────

  toggleBtn.addEventListener('click', async () => {
    const { tracking_paused = false } = await chrome.storage.local.get('tracking_paused');
    const newPaused = !tracking_paused;

    await chrome.storage.local.set({ tracking_paused: newPaused });

    try {
      await chrome.action.setBadgeText({ text: newPaused ? 'OFF' : '' });
      await chrome.action.setBadgeBackgroundColor({
        color: newPaused ? '#ef4444' : '#22c55e',
      });
    } catch { /* non-critical */ }

    try {
      chrome.runtime.sendMessage({ type: 'PAUSE_STATE_CHANGED', paused: newPaused });
    } catch { /* background may not be ready */ }

    await loadState();
  });

  // ─── Settings panel ───────────────────────────────────────────────────────

  const settingsToggle = document.getElementById('settings-toggle');
  const settingsPanel  = document.getElementById('settings-panel');
  const apiUrlInput    = document.getElementById('api-url');
  const apiKeyInput    = document.getElementById('api-key');
  const saveSettings   = document.getElementById('save-settings');
  const settingsStatus = document.getElementById('settings-status');

  const { PSB_API_URL = '', PSB_API_KEY = '' } =
    await chrome.storage.local.get(['PSB_API_URL', 'PSB_API_KEY']);
  apiUrlInput.value = PSB_API_URL;
  apiKeyInput.value = PSB_API_KEY;

  settingsToggle.addEventListener('click', () => {
    settingsPanel.classList.toggle('open');
    settingsToggle.textContent = settingsPanel.classList.contains('open')
      ? '▲ Connection settings'
      : '⚙ Connection settings';
  });

  saveSettings.addEventListener('click', async () => {
    const url = apiUrlInput.value.trim();
    const key = apiKeyInput.value.trim();
    if (!url) { settingsStatus.textContent = 'URL is required.'; return; }
    await chrome.storage.local.set({ PSB_API_URL: url, PSB_API_KEY: key });
    settingsStatus.textContent = 'Saved ✓';
    setTimeout(() => { settingsStatus.textContent = ''; }, 2000);
  });

  // ─── Init ─────────────────────────────────────────────────────────────────

  await loadState();

  // Re-render log every 10s in case background added new captures
  setInterval(loadState, 10_000);
})();
