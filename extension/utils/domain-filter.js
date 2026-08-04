// domain-filter.js — Blocked domain checker for PSB Chrome Extension
// Requirements: 5.3 (blocked domain list), 2.3 (filter non-educational YT)

const HARDCODED_BLOCKED = new Set([
  'instagram.com', 'twitter.com', 'x.com', 'reddit.com',
  'facebook.com', 'netflix.com', 'tiktok.com', 'snapchat.com',
  'pinterest.com', 'tumblr.com', 'twitch.tv', 'discord.com',
]);

// Path keywords that indicate sensitive personal pages (banking, login, etc.)
const BLOCKED_PATH_KEYWORDS = [
  'signin', 'login', 'password', 'billing', 'checkout', 'bank', 'paypal',
];

/**
 * Normalise a hostname by stripping the leading 'www.' prefix.
 * @param {string} hostname
 * @returns {string}
 */
function normaliseHostname(hostname) {
  const h = hostname.toLowerCase();
  return h.startsWith('www.') ? h.slice(4) : h;
}

/**
 * Returns true if the URL should be blocked from capture.
 * Checks:
 *   1. Hardcoded blocked domain list (social media, entertainment, etc.)
 *   2. User-configured extra blocked domains stored in chrome.storage.local
 *   3. Sensitive path keywords (banking, login, billing, etc.)
 *
 * @param {string} url - The full page URL to evaluate.
 * @returns {Promise<boolean>} Resolves to true if the URL is blocked.
 */
async function isBlocked(url) {
  try {
    const parsed = new URL(url);
    const hostname = normaliseHostname(parsed.hostname);

    // 1. Check hardcoded blocked domains
    if (HARDCODED_BLOCKED.has(hostname)) return true;

    // 2. Check user-configured blocked domains
    const { userBlockedDomains = [] } = await chrome.storage.local.get('userBlockedDomains');
    const normUserBlocked = userBlockedDomains.map(d => normaliseHostname(d));
    if (normUserBlocked.includes(hostname)) return true;

    // 3. Check for sensitive path keywords
    const path = parsed.pathname.toLowerCase();
    if (BLOCKED_PATH_KEYWORDS.some(kw => path.includes(kw))) return true;

    return false;
  } catch {
    // Invalid URL — treat as safe to avoid false blocks
    return false;
  }
}
