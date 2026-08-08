// background.js — Passive Second Brain Chrome Extension service worker
// Requirements:
//   1.4  Skip blocked domains
//   1.5  Skip private pages
//   1.6  Skip when paused
//   1.8  Log failures to error_log
//   2.4  Skip YouTube when paused
//   6.2  Pause stops all capture
//   6.5  Paused state not enqueued for pipeline
//   Exponential backoff retry: 3 attempts, 1s / 2s / 4s

import { isBlocked } from './utils/domain-filter.js';

// ─── Constants ────────────────────────────────────────────────────────────────
const MAX_RETRY_ATTEMPTS = 3;
const RETRY_BASE_DELAY_MS = 1_000; // 1s → 2s → 4s
const MAX_ERROR_LOG_ENTRIES = 200;  // cap error_log to avoid unbounded growth

// ─── Helpers ─────────────────────────────────────────────────────────────────

/**
 * Retrieve the backend API base URL and API key from chrome.storage.local.
 * @returns {Promise<{apiUrl: string, apiKey: string}>}
 */
async function getApiConfig() {
  const { PSB_API_URL = 'http://localhost:8090', PSB_API_KEY = '' } =
    await chrome.storage.local.get(['PSB_API_URL', 'PSB_API_KEY']);
  return { apiUrl: PSB_API_URL, apiKey: PSB_API_KEY };
}

/**
 * Return true if tracking is currently paused.
 * @returns {Promise<boolean>}
 */
async function isPaused() {
  const { tracking_paused } = await chrome.storage.local.get('tracking_paused');
  return tracking_paused === true;
}

/**
 * Return true if the URL has been marked as a private page by the user.
 * @param {string} url
 * @returns {Promise<boolean>}
 */
async function isPrivatePage(url) {
  const { privatePages = [] } = await chrome.storage.local.get('privatePages');
  return privatePages.some(p => url.startsWith(p));
}

/**
 * Append an entry to the persistent error log stored in chrome.storage.local.
 * Caps the log at MAX_ERROR_LOG_ENTRIES to avoid runaway storage growth.
 * @param {object} entry
 */
async function logError(entry) {
  try {
    const { error_log = [] } = await chrome.storage.local.get('error_log');
    error_log.push({ ...entry, logged_at: Date.now() });
    if (error_log.length > MAX_ERROR_LOG_ENTRIES) {
      error_log.splice(0, error_log.length - MAX_ERROR_LOG_ENTRIES);
    }
    await chrome.storage.local.set({ error_log });
  } catch {
    // Storage failure — nothing we can do without causing an infinite loop.
  }
}

/**
 * Add a capture item to the local capture queue.
 * @param {object} item
 */
async function enqueue(item) {
  const { capture_queue = [] } = await chrome.storage.local.get('capture_queue');
  capture_queue.push({ ...item, queued_at: Date.now() });
  await chrome.storage.local.set({ capture_queue });
}

/**
 * Sleep for `ms` milliseconds.
 * @param {number} ms
 * @returns {Promise<void>}
 */
function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

/**
 * POST data to the backend with exponential backoff retry.
 * Attempts: 1 (immediate) → wait 1s → 2 → wait 2s → 3 → give up.
 *
 * @param {string} endpoint - Path after the API base URL (e.g. '/ingest/url').
 * @param {object} payload
 * @param {string} apiUrl
 * @param {string} apiKey
 * @returns {Promise<boolean>} true on success, false after all retries fail.
 */
async function postWithRetry(endpoint, payload, apiUrl, apiKey) {
  for (let attempt = 1; attempt <= MAX_RETRY_ATTEMPTS; attempt++) {
    try {
      const response = await fetch(`${apiUrl}${endpoint}`, {
        method:  'POST',
        headers: {
          'Content-Type':  'application/json',
          'X-API-Key':     apiKey,
        },
        body: JSON.stringify(payload),
      });
      if (response.ok) return true;
      // Non-2xx — treat as transient and retry
      console.warn(`[PSB] POST ${endpoint} returned ${response.status} (attempt ${attempt})`);
    } catch (err) {
      console.warn(`[PSB] POST ${endpoint} failed (attempt ${attempt}):`, err.message);
    }

    if (attempt < MAX_RETRY_ATTEMPTS) {
      // Exponential backoff: 1s, 2s, 4s …
      await sleep(RETRY_BASE_DELAY_MS * Math.pow(2, attempt - 1));
    }
  }
  return false;
}

// ─── Message handlers ─────────────────────────────────────────────────────────

/**
 * Handle a CAPTURE_URL message sent by content.js when the reading threshold
 * is reached on a regular web page.
 *
 * @param {object} msg - { type, url, title, text, timestamp }
 */
async function handleCaptureUrl(msg) {
  // Gate 1: paused
  if (await isPaused()) return;

  // Gate 2: blocked domain
  if (await isBlocked(msg.url)) return;

  // Gate 3: private page
  if (await isPrivatePage(msg.url)) return;

  // Enqueue locally first so the item is not lost if the POST fails
  const item = {
    type:      'url',
    url:       msg.url,
    title:     msg.title || '',
    text:      msg.text  || '',
    timestamp: msg.timestamp,
  };
  await enqueue(item);

  // Attempt to send to backend
  const { apiUrl, apiKey } = await getApiConfig();
  const success = await postWithRetry(
    '/ingest/url',
    { url: msg.url, title: msg.title, text: msg.text },
    apiUrl,
    apiKey,
  );

  if (!success) {
    await logError({
      type:      'POST_FAILED',
      endpoint:  '/ingest/url',
      url:       msg.url,
      timestamp: msg.timestamp,
    });
  }
}

/**
 * Handle a CAPTURE_YOUTUBE message sent by content.js when playback crosses 50 %.
 *
 * @param {object} msg - { type, videoId, url, percent, duration, timestamp }
 */
async function handleCaptureYoutube(msg) {
  // Gate 1: paused
  if (await isPaused()) return;

  // Gate 2: blocked domain (youtube.com itself is never in the hardcoded list,
  // but the user might have added it, or the URL might match a path keyword)
  if (await isBlocked(msg.url)) return;

  // Gate 3: private page
  if (await isPrivatePage(msg.url)) return;

  const item = {
    type:      'youtube',
    videoId:   msg.videoId,
    url:       msg.url,
    percent:   msg.percent,
    duration:  msg.duration,
    timestamp: msg.timestamp,
  };
  await enqueue(item);

  const { apiUrl, apiKey } = await getApiConfig();
  const success = await postWithRetry(
    '/ingest/youtube',
    { video_id: msg.videoId, url: msg.url },
    apiUrl,
    apiKey,
  );

  if (!success) {
    await logError({
      type:      'POST_FAILED',
      endpoint:  '/ingest/youtube',
      videoId:   msg.videoId,
      url:       msg.url,
      timestamp: msg.timestamp,
    });
  }
}

/**
 * Handle a CAPTURE_FAILED message sent by content.js when text extraction
 * throws an unhandled error.
 *
 * @param {object} msg - { type, url, error, timestamp }
 */
async function handleCaptureFailed(msg) {
  await logError({
    type:      'CAPTURE_FAILED',
    url:       msg.url,
    error:     msg.error || 'Unknown error',
    timestamp: msg.timestamp,
  });
}

// ─── Message listener ─────────────────────────────────────────────────────────

chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
  // Return true to keep the message channel open for async work
  (async () => {
    try {
      switch (msg.type) {
        case 'CAPTURE_URL':
          await handleCaptureUrl(msg);
          sendResponse({ ok: true });
          break;

        case 'CAPTURE_YOUTUBE':
          await handleCaptureYoutube(msg);
          sendResponse({ ok: true });
          break;

        case 'CAPTURE_FAILED':
          await handleCaptureFailed(msg);
          sendResponse({ ok: true });
          break;

        case 'PAUSE_STATE_CHANGED':
          // Sent by popup.js when the user toggles pause/resume.
          // Nothing special to do here — content.js reads the state from storage.
          sendResponse({ ok: true });
          break;

        default:
          sendResponse({ ok: false, error: `Unknown message type: ${msg.type}` });
      }
    } catch (err) {
      console.error('[PSB background] Unhandled error:', err);
      await logError({
        type:      'BACKGROUND_ERROR',
        error:     err.message || String(err),
        msgType:   msg.type,
        timestamp: Date.now(),
      });
      sendResponse({ ok: false, error: err.message });
    }
  })();

  return true; // keep channel open for async sendResponse
});
