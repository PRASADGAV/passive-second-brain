"""
domain_filter.py — Domain classifier and blocked-domain filter for Passive Second Brain.

Provides two public functions:

    is_blocked(url: str) -> bool
        Returns True if the URL should be unconditionally excluded from capture
        (social media, entertainment, banking/personal pages).

    classify_domain(url: str, text: str, user_domains: List[str]) -> Optional[str]
        Returns the first user-defined learning domain that matches the page
        content, or None if no match is found (item stored as unclassified).

Requirements: FR-05, 5.2 (tag with domain), 5.3 (blocked domain list), 5.4 (immediate filter update)
"""

import logging
import os
from typing import List, Optional
from urllib.parse import urlparse

logger = logging.getLogger(__name__)

# ---------------------------------------------------------------------------
# Blocked domain list (FR-05 §5.3)
# ---------------------------------------------------------------------------

_HARDCODED_BLOCKED_DOMAINS: frozenset[str] = frozenset(
    [
        "instagram.com",
        "twitter.com",
        "x.com",
        "reddit.com",
        "facebook.com",
        "netflix.com",
        "tiktok.com",
        "snapchat.com",
        "pinterest.com",
        "tumblr.com",
    ]
)

# Path keywords that indicate banking, login, or personal-data pages
_BLOCKED_PATH_KEYWORDS: tuple[str, ...] = (
    "bank",
    "paypal",
    "signin",
    "login",
    "password",
    "account",
    "billing",
    "checkout",
)


def _get_env_blocked_domains() -> frozenset[str]:
    """
    Read user-configurable extra blocked domains from the BLOCKED_DOMAINS
    environment variable (comma-separated hostnames).

    Supports FR-05 §5.4: the filter is re-read on every call so changes to
    the env var take effect immediately for all subsequent captures.
    """
    raw = os.environ.get("BLOCKED_DOMAINS", "").strip()
    if not raw:
        return frozenset()
    return frozenset(d.strip().lower() for d in raw.split(",") if d.strip())


def is_blocked(url: str) -> bool:
    """
    Return True if *url* should be unconditionally excluded from capture.

    Blocking rules (applied in order):
    1. The hostname (www.-stripped) is in the hardcoded blocked-domain list.
    2. The hostname is in the user-configurable BLOCKED_DOMAINS env var.
    3. Any blocked path keyword appears in the URL path.

    Args:
        url: An absolute URL string (HTTP or HTTPS).

    Returns:
        True if the URL matches any blocking rule, False otherwise.
        Returns False (safe default) when *url* is malformed or empty.
    """
    if not url:
        return False

    try:
        parsed = urlparse(url)
    except Exception:
        logger.warning("domain_filter.is_blocked: failed to parse URL '%s'", url)
        return False

    # Normalise hostname: lowercase, strip leading "www."
    hostname: str = (parsed.hostname or "").lower()
    if hostname.startswith("www."):
        hostname = hostname[4:]

    # Rule 1 + 2: hostname in combined blocked-domain set
    all_blocked = _HARDCODED_BLOCKED_DOMAINS | _get_env_blocked_domains()
    if hostname in all_blocked:
        logger.debug("domain_filter: blocked domain '%s' matched for URL '%s'", hostname, url)
        return True

    # Rule 3: path contains a sensitive keyword
    path: str = (parsed.path or "").lower()
    for keyword in _BLOCKED_PATH_KEYWORDS:
        if keyword in path:
            logger.debug(
                "domain_filter: blocked path keyword '%s' matched in URL '%s'", keyword, url
            )
            return True

    return False


# ---------------------------------------------------------------------------
# Domain keyword map (FR-05 §5.2)
# ---------------------------------------------------------------------------

DOMAIN_KEYWORDS: dict[str, list[str]] = {
    "Machine Learning": [
        "neural network",
        "deep learning",
        "gradient",
        "training",
        "model",
        "pytorch",
        "tensorflow",
        "llm",
        "transformer",
    ],
    "Web Development": [
        "javascript",
        "react",
        "css",
        "html",
        "frontend",
        "backend",
        "api",
        "rest",
        "node",
    ],
    "Data Science": [
        "pandas",
        "numpy",
        "visualization",
        "dataset",
        "statistics",
        "jupyter",
        "matplotlib",
    ],
    "System Design": [
        "scalability",
        "microservices",
        "distributed",
        "architecture",
        "load balancer",
        "cache",
        "database",
    ],
    "DSA": [
        "algorithm",
        "data structure",
        "sorting",
        "binary tree",
        "graph",
        "dynamic programming",
        "complexity",
    ],
    "DevOps": [
        "docker",
        "kubernetes",
        "ci/cd",
        "deployment",
        "pipeline",
        "terraform",
        "ansible",
    ],
}

# Pre-build a lowercase lookup so matching is case-insensitive
_DOMAIN_KEYWORDS_LOWER: dict[str, list[str]] = {
    k.lower(): v for k, v in DOMAIN_KEYWORDS.items()
}


def classify_domain(url: str, text: str, user_domains: List[str]) -> Optional[str]:
    """
    Return the first user-defined learning domain that matches *text*, or None.

    Matching strategy (per-domain, in the order the caller supplies them):
    1. If the user domain name (case-insensitive) exists as a key in the
       built-in DOMAIN_KEYWORDS map, check whether any of its keywords appear
       anywhere in *text* (case-insensitive substring match).
    2. If the domain name is NOT in the built-in map, fall back to a simple
       substring match of the domain name itself within *text*.

    Returns the first matching domain name exactly as supplied in *user_domains*,
    or None if no domain matches.

    Args:
        url:          The source URL (reserved for future URL-based heuristics).
        text:         The cleaned extracted text to classify.
        user_domains: Ordered list of user-defined domain names to try.

    Returns:
        The first matching domain string from *user_domains*, or None.
    """
    if not user_domains or not text:
        return None

    text_lower = text.lower()

    for domain in user_domains:
        domain_key = domain.lower()

        if domain_key in _DOMAIN_KEYWORDS_LOWER:
            # Keyword-based matching against built-in map
            keywords = _DOMAIN_KEYWORDS_LOWER[domain_key]
            if any(kw in text_lower for kw in keywords):
                logger.debug(
                    "domain_filter.classify_domain: domain '%s' matched via keyword map", domain
                )
                return domain
        else:
            # Fallback: simple substring match of domain name in text
            if domain_key in text_lower:
                logger.debug(
                    "domain_filter.classify_domain: domain '%s' matched via substring fallback",
                    domain,
                )
                return domain

    logger.debug(
        "domain_filter.classify_domain: no domain matched for URL '%s'", url
    )
    return None
