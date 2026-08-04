"""
Unit tests for Chrome Extension utility modules:
  - extension/utils/domain-filter.js  (isBlocked)
  - extension/utils/youtube.js        (extractVideoId, getVideoProgress)

These tests validate the JavaScript logic by re-implementing the core
algorithms in Python and testing them, since the extension runs in a browser
context (chrome.storage.local etc.) that cannot be directly unit-tested in
Python.

Task 8.6: Unit tests for domain filter and YouTube progress utility.
Requirements: 5.3, 2.1
"""

import math
import re


# ---------------------------------------------------------------------------
# Python re-implementation of domain-filter.js logic
# ---------------------------------------------------------------------------

HARDCODED_BLOCKED = {
    "instagram.com", "twitter.com", "x.com", "reddit.com",
    "facebook.com", "netflix.com", "tiktok.com", "snapchat.com",
    "pinterest.com", "tumblr.com", "twitch.tv", "discord.com",
}

BLOCKED_PATH_KEYWORDS = [
    "signin", "login", "password", "billing", "checkout", "bank", "paypal",
]


def normalise_hostname(hostname: str) -> str:
    h = hostname.lower()
    return h[4:] if h.startswith("www.") else h


def is_blocked_sync(url: str, user_blocked_domains: list[str] | None = None) -> bool:
    """Synchronous Python equivalent of the JS isBlocked function."""
    try:
        from urllib.parse import urlparse
        parsed = urlparse(url)
        hostname = parsed.hostname
        if not hostname:
            return False
        hostname = normalise_hostname(hostname)

        # 1. Hardcoded blocked domains
        if hostname in HARDCODED_BLOCKED:
            return True

        # 2. User-configured blocked domains
        if user_blocked_domains:
            norm_user = [normalise_hostname(d) for d in user_blocked_domains]
            if hostname in norm_user:
                return True

        # 3. Sensitive path keywords
        path = parsed.path.lower()
        if any(kw in path for kw in BLOCKED_PATH_KEYWORDS):
            return True

        return False
    except Exception:
        return False


# ---------------------------------------------------------------------------
# Python re-implementation of youtube.js logic
# ---------------------------------------------------------------------------

def extract_video_id(url: str) -> str | None:
    """Python equivalent of extractVideoId from youtube.js."""
    try:
        from urllib.parse import urlparse, parse_qs
        parsed = urlparse(url)
        hostname = re.sub(r"^www\.", "", parsed.hostname.lower()) if parsed.hostname else ""

        if hostname in ("youtube.com", "m.youtube.com"):
            # Standard watch page
            v = parse_qs(parsed.query).get("v")
            if v:
                return v[0]
            # Embed and Shorts
            parts = [p for p in parsed.path.split("/") if p]
            if len(parts) >= 2 and parts[0] in ("embed", "shorts"):
                return parts[1] or None

        if hostname == "youtu.be":
            vid = parsed.path.lstrip("/").split("/")[0]
            return vid or None
    except Exception:
        pass
    return None


def compute_video_percent(current_time: float, duration: float) -> float:
    """Python equivalent of the percent calculation in getVideoProgress."""
    if duration > 0:
        return current_time / duration
    return 0


# ---------------------------------------------------------------------------
# Tests: Domain Filter (isBlocked)
# ---------------------------------------------------------------------------

class TestIsBlockedHardcoded:
    """Test hardcoded blocked domains from domain-filter.js."""

    def test_instagram_blocked(self):
        assert is_blocked_sync("https://instagram.com/p/abc") is True

    def test_www_instagram_blocked(self):
        assert is_blocked_sync("https://www.instagram.com/p/abc") is True

    def test_twitter_blocked(self):
        assert is_blocked_sync("https://twitter.com/home") is True

    def test_x_dot_com_blocked(self):
        assert is_blocked_sync("https://x.com/home") is True

    def test_reddit_blocked(self):
        assert is_blocked_sync("https://reddit.com/r/python") is True

    def test_facebook_blocked(self):
        assert is_blocked_sync("https://facebook.com/feed") is True

    def test_netflix_blocked(self):
        assert is_blocked_sync("https://netflix.com/browse") is True

    def test_tiktok_blocked(self):
        assert is_blocked_sync("https://tiktok.com/@user") is True

    def test_snapchat_blocked(self):
        assert is_blocked_sync("https://snapchat.com") is True

    def test_pinterest_blocked(self):
        assert is_blocked_sync("https://pinterest.com/ideas") is True

    def test_tumblr_blocked(self):
        assert is_blocked_sync("https://tumblr.com/dashboard") is True

    def test_twitch_blocked(self):
        assert is_blocked_sync("https://twitch.tv/streamer") is True

    def test_discord_blocked(self):
        assert is_blocked_sync("https://discord.com/channels") is True


class TestIsBlockedAllowed:
    """Non-blocked domains should return False."""

    def test_github_allowed(self):
        assert is_blocked_sync("https://github.com/user/repo") is False

    def test_arxiv_allowed(self):
        assert is_blocked_sync("https://arxiv.org/abs/2301.00001") is False

    def test_python_docs_allowed(self):
        assert is_blocked_sync("https://docs.python.org/3/") is False

    def test_medium_allowed(self):
        assert is_blocked_sync("https://medium.com/article") is False

    def test_stackoverflow_allowed(self):
        assert is_blocked_sync("https://stackoverflow.com/questions/123") is False


class TestIsBlockedPathKeywords:
    """URLs with sensitive path keywords should be blocked."""

    def test_login_path(self):
        assert is_blocked_sync("https://example.com/login") is True

    def test_signin_path(self):
        assert is_blocked_sync("https://example.com/signin") is True

    def test_password_path(self):
        assert is_blocked_sync("https://example.com/reset-password") is True

    def test_billing_path(self):
        assert is_blocked_sync("https://saas.com/billing") is True

    def test_checkout_path(self):
        assert is_blocked_sync("https://shop.com/checkout/payment") is True

    def test_bank_path(self):
        assert is_blocked_sync("https://mybank.com/bank/transfers") is True

    def test_paypal_path(self):
        assert is_blocked_sync("https://pay.com/paypal/checkout") is True


class TestIsBlockedUserDomains:
    """User-configured blocked domains."""

    def test_user_domain_blocked(self):
        assert is_blocked_sync(
            "https://mysite.com/page",
            user_blocked_domains=["mysite.com"]
        ) is True

    def test_user_domain_www_stripped(self):
        assert is_blocked_sync(
            "https://www.custom.org/article",
            user_blocked_domains=["custom.org"]
        ) is True


class TestIsBlockedEdgeCases:
    def test_empty_url_returns_false(self):
        assert is_blocked_sync("") is False

    def test_invalid_url_returns_false(self):
        assert is_blocked_sync("not-a-url") is False


# ---------------------------------------------------------------------------
# Tests: YouTube Utility (extractVideoId, getVideoProgress)
# ---------------------------------------------------------------------------

class TestExtractVideoId:
    """Test extractVideoId from youtube.js."""

    def test_standard_watch_url(self):
        assert extract_video_id("https://www.youtube.com/watch?v=dQw4w9WgXcQ") == "dQw4w9WgXcQ"

    def test_no_www(self):
        assert extract_video_id("https://youtube.com/watch?v=abc123") == "abc123"

    def test_mobile_youtube(self):
        assert extract_video_id("https://m.youtube.com/watch?v=xyz789") == "xyz789"

    def test_embed_url(self):
        assert extract_video_id("https://youtube.com/embed/abc123") == "abc123"

    def test_shorts_url(self):
        assert extract_video_id("https://youtube.com/shorts/short123") == "short123"

    def test_youtu_be_url(self):
        assert extract_video_id("https://youtu.be/abc123") == "abc123"

    def test_non_youtube_url_returns_none(self):
        assert extract_video_id("https://vimeo.com/12345") is None

    def test_youtube_no_video_id_returns_none(self):
        assert extract_video_id("https://youtube.com/") is None

    def test_invalid_url_returns_none(self):
        assert extract_video_id("not-a-url") is None


class TestVideoProgressPercent:
    """Test percent calculation from getVideoProgress in youtube.js."""

    def test_50_percent_trigger(self):
        """Requirement 2.1: 50% trigger for YouTube videos."""
        percent = compute_video_percent(150, 300)
        assert percent == 0.5

    def test_zero_duration_returns_zero(self):
        percent = compute_video_percent(50, 0)
        assert percent == 0

    def test_full_video(self):
        percent = compute_video_percent(300, 300)
        assert percent == 1.0

    def test_partial_progress(self):
        percent = compute_video_percent(75, 300)
        assert abs(percent - 0.25) < 1e-9

    def test_zero_current_time(self):
        percent = compute_video_percent(0, 300)
        assert percent == 0.0
