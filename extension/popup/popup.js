// popup.js — Passive Second Brain Chrome Extension popup controller
// Requirements:
//   6.1  Pause/resume control visible at all times
//   6.3  Resume resumes all passive capture activities
//   6.4  Visual indicator when paused (badge text OFF/ON)

(async function () {
  'use strict';

  const toggleBtn     = document.getElementById('toggle-btn');
  const statusText    = document.getElementById('status-text');
  const queueCount    = document.getElementById('queue-count');
  const thresholdVal  = document.getElementById('threshold-value');

  // ─── Load current state from storage ──────────────────────────────────────

  async function loadState() {
    const {
      tracking_paused    = false,
      capture_queue      = [],
      reading_threshold  = 60,
    } = await chrome.storage.local.get([
      'tracking_paused',
      'capture_queue',
      'reading_threshold',
    ]);

    updateUI(tracking_paused, capture_queue.length, reading_threshold);
  }

  // ─── Update UI ────────────────────────────────────────────────────────────

  function updateUI(isPaused, queueLen, threshold) {
    if (isPaused) {
      statusText.textContent  = 'Paused';
      statusText.style.color  = '#ef4444';
      toggleBtn.textContent   = 'Resume';
      toggleBtn.classList.add('paused');
    } else {
      statusText.textContent  = 'Active';
      statusText.style.color  = '#22c55e';
      toggleBtn.textContent   = 'Pause';
      toggleBtn.classList.remove('paused');
    }

    queueCount.textContent   = String(queueLen);
    thresholdVal.textContent = `${threshold}s`;
  }

  // ─── Toggle pause/resume ──────────────────────────────────────────────────

  toggleBtn.addEventListener('click', async () => {
    const { tracking_paused = false } = await chrome.storage.local.get('tracking_paused');
    const newPaused = !tracking_paused;

    // Persist the new state
    await chrome.storage.local.set({ tracking_paused: newPaused });

    // Update the toolbar badge text so the icon communicates status at a glance
    // (Requirement 6.4 — visual indicator in browser toolbar)
    try {
      await chrome.action.setBadgeText({ text: newPaused ? 'OFF' : '' });
      await chrome.action.setBadgeBackgroundColor({
        color: newPaused ? '#ef4444' : '#22c55e',
      });
    } catch {
      // setBadgeText may fail in some contexts; non-critical
    }

    // Notify background service worker of the state change so it can stop
    // enqueuing items immediately (Requirement 6.2 — stops within 2 seconds)
    try {
      chrome.runtime.sendMessage({ type: 'PAUSE_STATE_CHANGED', paused: newPaused });
    } catch {
      // Background may not be listening — state is read from storage anyway
    }

    // Refresh the queue count in case items were added since popup opened
    const { capture_queue = [], reading_threshold = 60 } =
      await chrome.storage.local.get(['capture_queue', 'reading_threshold']);

    updateUI(newPaused, capture_queue.length, reading_threshold);
  });

  // ─── Initialise ───────────────────────────────────────────────────────────

  await loadState();
})();
