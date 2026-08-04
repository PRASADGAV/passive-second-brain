// content.js — Passive Second Brain Chrome Extension content script
// Injected into every page at document_idle (after DOMContentLoaded + load).
// Requirements:
//   1.1  Extract page text on reading-time threshold
//   1.2  Default 60-second threshold
//   1.3  Respect custom configured threshold
//   1.6  Skip capture when tracking is paused
//   1.8  Log failures without crashing
//   2.1  Trigger YouTube transcript at 50% playback
//   2.4  Skip YouTube capture when paused
//   23.3 Do not block the main thread
//   23.4 Defer extraction until after page load

(function () {
  'use strict';

  // ─── Constants ────────────────────────────────────────────────────────────────
  const DEFAULT_THRESHOLD_MS = 60_000;        // 60 seconds in milliseconds
  const MAX_TEXT_LENGTH       = 100_000;       // character cap on extracted text
  const YT_POLL_INTERVAL_MS   = 5_000;         // poll YouTube player every 5 s
  const YT_TRIGGER_PERCENT    = 0.5;           // fire when playback passes 50 %

  // ─── State ────────────────────────────────────────────────────────────────────
  let readingTimer    = null;   // setTimeout handle for reading threshold
  let ytPollTimer     = null;   // setInterval handle for YT polling
  let ytTriggered     = false;  // has the 50 % trigger fired for the current video?
  let lastTriggeredId = null;   // video ID for which the trigger already fired
  let capturedThisPage = false; // prevent double capture per navigation

  // ─── Helpers ──────────────────────────────────────────────────────────────────

  /**
   * Read the configured reading threshold from storage (in seconds).
   * Falls back to DEFAULT_THRESHOLD_MS if not set.
   * @returns {Promise<number>} Threshold in milliseconds.
   */
  async function getThresholdMs() {
    try {
      const { reading_threshold } = await chrome.storage.local.get('reading_threshold');
      if (typeof reading_threshold === 'number' && reading_threshold > 0) {
        return reading_threshold * 1000;
      }
    } catch { /* ignore */ }
    return DEFAULT_THRESHOLD_MS;
  }

  /**
   * Check whether the user has paused tracking.
   * @returns {Promise<boolean>}
   */
  async function isPaused() {
    try {
      const { tracking_paused } = await chrome.storage.local.get('tracking_paused');
      return tracking_paused === true;
    } catch {
      return false;
    }
  }

  /**
   * Check whether the current page is on the user's private-page list.
   * @returns {Promise<boolean>}
   */
  async function isPrivatePage() {
    try {
      const { privatePages = [] } = await chrome.storage.local.get('privatePages');
      const url = window.location.href;
      return privatePages.some(p => url.startsWith(p));
    } catch {
      return false;
    }
  }

  /**
   * Send a failure notice to the background service worker.
   * @param {string} errorMsg
   */
  function reportFailure(errorMsg) {
    try {
      chrome.runtime.sendMessage({
        type: 'CAPTURE_FAILED',
        url:  window.location.href,
        error: String(errorMsg),
        timestamp: Date.now(),
      });
    } catch { /* background may not be available during extension unload */ }
  }

  // ─── Webpage text capture ─────────────────────────────────────────────────────

  /**
   * Called when the reading timer fires.
   * Extracts visible text and forwards it to the background script.
   */
  async function handleReadingThreshold() {
    if (capturedThisPage) return;   // already sent for this navigation

    try {
      // Guard: paused or private
      if (await isPaused())      return;
      if (await isPrivatePage()) return;

      const rawText = document.body ? document.body.innerText : '';
      if (!rawText || !rawText.trim()) return;

      const text = rawText.slice(0, MAX_TEXT_LENGTH);
      capturedThisPage = true;

      chrome.runtime.sendMessage({
        type:  'CAPTURE_URL',
        url:   window.location.href,
        title: document.title || '',
        text,
        timestamp: Date.now(),
      });
    } catch (err) {
      reportFailure(err.message || err);
    }
  }

  /**
   * Start (or restart) the reading timer.
   */
  async function startReadingTimer() {
    clearTimeout(readingTimer);
    const thresholdMs = await getThresholdMs();
    // Use setTimeout so the timer callback runs asynchronously and does not
    // block the main thread (Requirements 23.3).
    readingTimer = setTimeout(handleReadingThreshold, thresholdMs);
  }

  // ─── YouTube progress tracking ────────────────────────────────────────────────

  /**
   * Returns true if the current page is a YouTube watch/shorts page.
   */
  function isYouTubePage() {
    const h = window.location.hostname.replace(/^www\./, '');
    return (
      (h === 'youtube.com' || h === 'm.youtube.com') &&
      (window.location.pathname.startsWith('/watch') ||
       window.location.pathname.startsWith('/shorts'))
    ) || h === 'youtu.be';
  }

  /**
   * Extract the YouTube video ID from the current page URL.
   * @returns {string|null}
   */
  function extractVideoId() {
    try {
      const parsed = new URL(window.location.href);
      const hostname = parsed.hostname.replace(/^www\./, '');
      if (hostname === 'youtube.com' || hostname === 'm.youtube.com') {
        const v = parsed.searchParams.get('v');
        if (v) return v;
        const parts = parsed.pathname.split('/').filter(Boolean);
        if (parts[0] === 'shorts' || parts[0] === 'embed') return parts[1] || null;
      }
      if (hostname === 'youtu.be') {
        return parsed.pathname.slice(1).split('/')[0] || null;
      }
    } catch { /* invalid URL */ }
    return null;
  }

  /**
   * Poll the YouTube player DOM every YT_POLL_INTERVAL_MS milliseconds.
   * Sends a CAPTURE_YOUTUBE message once per video when playback crosses 50 %.
   */
  async function pollYouTubeProgress() {
    try {
      if (await isPaused()) return;

      const video = document.querySelector('video');
      if (!video) return;

      const duration    = video.duration    || 0;
      const currentTime = video.currentTime || 0;
      const percent     = duration > 0 ? currentTime / duration : 0;
      const videoId     = extractVideoId();

      if (!videoId) return;

      // Fire exactly once per video
      if (percent > YT_TRIGGER_PERCENT && lastTriggeredId !== videoId) {
        lastTriggeredId = videoId;
        ytTriggered     = true;

        chrome.runtime.sendMessage({
          type:      'CAPTURE_YOUTUBE',
          videoId,
          url:       window.location.href,
          percent:   Math.round(percent * 100),
          duration,
          timestamp: Date.now(),
        });
      }
    } catch (err) {
      reportFailure(err.message || err);
    }
  }

  /**
   * Start polling for YouTube progress if on a YouTube page.
   */
  function startYouTubePoll() {
    if (!isYouTubePage()) return;
    clearInterval(ytPollTimer);
    ytPollTimer = setInterval(pollYouTubeProgress, YT_POLL_INTERVAL_MS);
  }

  // ─── Initialisation ───────────────────────────────────────────────────────────

  /**
   * Entry point. Called once the DOM is fully ready (document_idle fires after
   * load, satisfying Requirement 23.4).
   */
  async function init() {
    try {
      // Skip entirely if paused — do not even start timers
      if (await isPaused()) return;

      startReadingTimer();
      startYouTubePoll();
    } catch (err) {
      reportFailure(err.message || err);
    }
  }

  // ─── Navigation reset ─────────────────────────────────────────────────────────

  // Reset state and timers when the user navigates away.
  // This also handles YouTube's SPA navigation (pushState).
  window.addEventListener('beforeunload', () => {
    clearTimeout(readingTimer);
    clearInterval(ytPollTimer);
    capturedThisPage = false;
    ytTriggered      = false;
    // Do not reset lastTriggeredId — persists only in this content script instance.
  });

  // For YouTube's SPA navigation (yt-navigate-finish custom event):
  window.addEventListener('yt-navigate-finish', () => {
    clearTimeout(readingTimer);
    clearInterval(ytPollTimer);
    capturedThisPage = false;
    ytTriggered      = false;
    lastTriggeredId  = null;
    init();
  });

  // ─── Start ────────────────────────────────────────────────────────────────────
  // document_idle guarantees the DOM and load event are already complete.
  init();
})();
