// domain-filter.js — Blocked domain checker for PSB Chrome Extension
// Requirements: 5.3 (blocked domain list), 2.3 (filter non-educational YT)

const HARDCODED_BLOCKED = new Set([
  'instagram.com', 'twitter.com', 'x.com', 'reddit.com',
  'facebook.com', 'netflix.com', 'tiktok.com', 'snapchat.com',
  'pinterest.com', 'tumblr.com', 'twitch.tv', 'discord.com',
]);

const BLOCKED_PATH_KEYWORDS = [
  'signin', 'login', 'password', 'billing', 'checkout', 'bank', 'paypal',
];

function normaliseHostname(hostname) {
  const h = hostname.toLowerCase();
  return h.startsWith('www.') ? h.slice(4) : h;
}

/**
 * Returns true if the URL should be blocked from capture.
 * @param {string} url
 * @returns {Promise<boolean>}
 */
export async function isBlocked(url) {
  try {
    const parsed = new URL(url);
    const hostname = normaliseHostname(parsed.hostname);
    if (HARDCODED_BLOCKED.has(hostname)) return true;
    const { userBlockedDomains = [] } = await chrome.storage.local.get('userBlockedDomains');
    const normUserBlocked = userBlockedDomains.map(d => normaliseHostname(d));
    if (normUserBlocked.includes(hostname)) return true;
    const path = parsed.pathname.toLowerCase();
    if (BLOCKED_PATH_KEYWORDS.some(kw => path.includes(kw))) return true;
    return false;
  } catch {
    return false;
  }
}
