// youtube.js — YouTube video progress tracker for PSB Chrome Extension
// Requirements: 2.1 (50% trigger), 2.3 (filter non-educational)

/**
 * Extract the YouTube video ID from a URL.
 * Handles:
 *   - youtube.com/watch?v=VIDEO_ID
 *   - youtu.be/VIDEO_ID
 *   - youtube.com/embed/VIDEO_ID
 *   - youtube.com/shorts/VIDEO_ID
 *
 * @param {string} url - The page URL.
 * @returns {string|null} The video ID string, or null if not a YouTube video URL.
 */
function extractVideoId(url) {
  try {
    const parsed = new URL(url);
    const hostname = parsed.hostname.toLowerCase().replace(/^www\./, '');

    if (hostname === 'youtube.com' || hostname === 'm.youtube.com') {
      // Standard watch page: youtube.com/watch?v=ID
      const v = parsed.searchParams.get('v');
      if (v) return v;

      // Embed and Shorts: /embed/ID or /shorts/ID
      const pathParts = parsed.pathname.split('/').filter(Boolean);
      if (pathParts.length >= 2 && (pathParts[0] === 'embed' || pathParts[0] === 'shorts')) {
        return pathParts[1] || null;
      }
    }

    if (hostname === 'youtu.be') {
      // Short URL: youtu.be/ID
      const id = parsed.pathname.slice(1).split('/')[0];
      return id || null;
    }
  } catch {
    // Invalid URL
  }
  return null;
}

/**
 * Read the current playback progress from the YouTube player DOM.
 * Looks for the HTML5 <video> element that YouTube renders on the page.
 *
 * @returns {{videoId: string, percent: number, duration: number, currentTime: number}|null}
 *   Returns null if this is not a YouTube video page or the player is not ready.
 */
function getVideoProgress() {
  const video = document.querySelector('video');
  if (!video) return null;

  const videoId = extractVideoId(window.location.href);
  if (!videoId) return null;

  const duration = video.duration || 0;
  const currentTime = video.currentTime || 0;
  // Avoid division by zero; percent is 0 if duration is unknown
  const percent = duration > 0 ? currentTime / duration : 0;

  return { videoId, percent, duration, currentTime };
}
