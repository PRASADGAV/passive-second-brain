"""
Unit tests for backend/services/domain_filter.py

Covers:
- is_blocked: hardcoded social/entertainment domains, path keywords,
  user-configured BLOCKED_DOMAINS env var, www. stripping, edge cases.
- classify_domain: built-in keyword-map matching, fallback substring matching,
  order-first semantics, empty inputs, None return.
"""

import os
import unittest
from unittest.mock import patch

from backend.services.domain_filter import classify_domain, is_blocked


class TestIsBlockedHardcodedDomains(unittest.TestCase):
    """Hardcoded social-media and entertainment domains must always be blocked."""

    BLOCKED = [
        "https://www.instagram.com/p/abc",
        "https://instagram.com/p/abc",
        "https://twitter.com/home",
        "https://x.com/home",
        "https://reddit.com/r/python",
        "https://www.reddit.com/r/python",
        "https://facebook.com/feed",
        "https://netflix.com/browse",
        "https://tiktok.com/@user",
        "https://snapchat.com",
        "https://pinterest.com/ideas",
        "https://tumblr.com/dashboard",
    ]

    def test_all_hardcoded_blocked(self):
        for url in self.BLOCKED:
            with self.subTest(url=url):
                self.assertTrue(is_blocked(url), f"Expected '{url}' to be blocked")

    def test_www_prefix_stripped(self):
        self.assertTrue(is_blocked("https://www.instagram.com/p/123"))

    def test_allowed_domain_not_blocked(self):
        self.assertFalse(is_blocked("https://arxiv.org/abs/2301.00001"))
        self.assertFalse(is_blocked("https://github.com/user/repo"))
        self.assertFalse(is_blocked("https://docs.python.org/3/"))


class TestIsBlockedPathKeywords(unittest.TestCase):
    """URLs whose path contains a sensitive keyword should be blocked."""

    def test_login_page_blocked(self):
        self.assertTrue(is_blocked("https://example.com/login"))
        self.assertTrue(is_blocked("https://example.com/user/login/redirect"))

    def test_signin_page_blocked(self):
        self.assertTrue(is_blocked("https://app.example.com/signin"))

    def test_password_page_blocked(self):
        self.assertTrue(is_blocked("https://example.com/reset-password"))

    def test_bank_page_blocked(self):
        self.assertTrue(is_blocked("https://mybank.example.com/bank/transfers"))

    def test_paypal_path_blocked(self):
        self.assertTrue(is_blocked("https://pay.example.com/paypal/checkout"))

    def test_account_page_blocked(self):
        self.assertTrue(is_blocked("https://store.example.com/account/settings"))

    def test_billing_page_blocked(self):
        self.assertTrue(is_blocked("https://saas.example.com/billing"))

    def test_checkout_page_blocked(self):
        self.assertTrue(is_blocked("https://shop.example.com/checkout/payment"))

    def test_clean_path_not_blocked(self):
        self.assertFalse(is_blocked("https://example.com/articles/python-tips"))


class TestIsBlockedEnvVar(unittest.TestCase):
    """User-configurable BLOCKED_DOMAINS env var adds extra blocked hostnames."""

    def test_env_var_domain_blocked(self):
        with patch.dict(os.environ, {"BLOCKED_DOMAINS": "mysite.com,othersite.org"}):
            self.assertTrue(is_blocked("https://mysite.com/page"))
            self.assertTrue(is_blocked("https://othersite.org/article"))

    def test_env_var_domain_case_insensitive(self):
        with patch.dict(os.environ, {"BLOCKED_DOMAINS": "MYSITE.COM"}):
            self.assertTrue(is_blocked("https://mysite.com/page"))

    def test_env_var_with_spaces(self):
        with patch.dict(os.environ, {"BLOCKED_DOMAINS": " spaced.com , other.net "}):
            self.assertTrue(is_blocked("https://spaced.com/"))
            self.assertTrue(is_blocked("https://other.net/"))

    def test_env_var_domain_does_not_block_other_sites(self):
        with patch.dict(os.environ, {"BLOCKED_DOMAINS": "blocked.com"}):
            self.assertFalse(is_blocked("https://allowed.com/article"))

    def test_empty_env_var_does_not_block(self):
        with patch.dict(os.environ, {"BLOCKED_DOMAINS": ""}):
            self.assertFalse(is_blocked("https://arxiv.org/abs/1234"))


class TestIsBlockedEdgeCases(unittest.TestCase):
    def test_empty_string_returns_false(self):
        self.assertFalse(is_blocked(""))

    def test_malformed_url_returns_false(self):
        self.assertFalse(is_blocked("not-a-url"))

    def test_none_equivalent_missing_host(self):
        # urlparse of relative path produces empty hostname
        self.assertFalse(is_blocked("/relative/path"))


# ---------------------------------------------------------------------------
# classify_domain tests
# ---------------------------------------------------------------------------

class TestClassifyDomainKeywordMap(unittest.TestCase):
    """Domains present in the built-in keyword map should match on keywords."""

    def test_machine_learning_domain_pytorch(self):
        text = "We train a model using PyTorch with gradient descent."
        result = classify_domain("https://example.com", text, ["Machine Learning"])
        self.assertEqual(result, "Machine Learning")

    def test_machine_learning_domain_transformer(self):
        text = "The transformer architecture revolutionised NLP with deep learning."
        result = classify_domain("https://example.com", text, ["Machine Learning"])
        self.assertEqual(result, "Machine Learning")

    def test_web_development_domain_react(self):
        text = "Building a React frontend with a REST API backend in Node.js."
        result = classify_domain("https://example.com", text, ["Web Development"])
        self.assertEqual(result, "Web Development")

    def test_data_science_domain_pandas(self):
        text = "Use pandas and numpy to process the dataset and visualize results."
        result = classify_domain("https://example.com", text, ["Data Science"])
        self.assertEqual(result, "Data Science")

    def test_system_design_domain_microservices(self):
        text = "Microservices and distributed architecture improve scalability."
        result = classify_domain("https://example.com", text, ["System Design"])
        self.assertEqual(result, "System Design")

    def test_dsa_domain_algorithm(self):
        text = "This sorting algorithm achieves O(n log n) time complexity."
        result = classify_domain("https://example.com", text, ["DSA"])
        self.assertEqual(result, "DSA")

    def test_devops_domain_docker(self):
        text = "Docker and Kubernetes power our CI/CD deployment pipeline."
        result = classify_domain("https://example.com", text, ["DevOps"])
        self.assertEqual(result, "DevOps")

    def test_keyword_matching_is_case_insensitive(self):
        # Keywords are lowercase in map; text has mixed case
        text = "Training a NEURAL NETWORK requires careful gradient tuning."
        result = classify_domain("https://example.com", text, ["Machine Learning"])
        self.assertEqual(result, "Machine Learning")


class TestClassifyDomainFallback(unittest.TestCase):
    """Domains not in the keyword map fall back to substring match."""

    def test_custom_domain_substring_match(self):
        text = "This article covers advanced astrophysics concepts."
        result = classify_domain("https://example.com", text, ["Astrophysics"])
        self.assertEqual(result, "Astrophysics")

    def test_custom_domain_case_insensitive_fallback(self):
        text = "Topics covered: ASTROPHYSICS and cosmology."
        result = classify_domain("https://example.com", text, ["Astrophysics"])
        self.assertEqual(result, "Astrophysics")

    def test_custom_domain_no_match_returns_none(self):
        text = "This is a cooking recipe for pasta."
        result = classify_domain("https://example.com", text, ["Astrophysics"])
        self.assertIsNone(result)


class TestClassifyDomainOrdering(unittest.TestCase):
    """The first matching domain in the user list should be returned."""

    def test_returns_first_match(self):
        # Text matches both ML and Data Science keywords
        text = "PyTorch model training with pandas datasets and numpy arrays."
        result = classify_domain(
            "https://example.com",
            text,
            ["Machine Learning", "Data Science"],
        )
        self.assertEqual(result, "Machine Learning")

    def test_second_domain_returned_when_first_does_not_match(self):
        text = "Pandas and numpy statistics for jupyter notebooks."
        result = classify_domain(
            "https://example.com",
            text,
            ["Machine Learning", "Data Science"],
        )
        self.assertEqual(result, "Data Science")


class TestClassifyDomainEdgeCases(unittest.TestCase):
    def test_empty_user_domains_returns_none(self):
        self.assertIsNone(classify_domain("https://example.com", "Some text.", []))

    def test_empty_text_returns_none(self):
        self.assertIsNone(classify_domain("https://example.com", "", ["Machine Learning"]))

    def test_whitespace_only_text_returns_none(self):
        self.assertIsNone(classify_domain("https://example.com", "   ", ["Machine Learning"]))

    def test_no_match_returns_none(self):
        text = "A travel blog about hiking in the Alps."
        result = classify_domain("https://example.com", text, ["Machine Learning", "DevOps"])
        self.assertIsNone(result)

    def test_url_parameter_accepted_without_error(self):
        # url is reserved for future use; passing any string should not raise
        text = "Deep learning gradient descent."
        result = classify_domain("https://some-url.com/path", text, ["Machine Learning"])
        self.assertEqual(result, "Machine Learning")


if __name__ == "__main__":
    unittest.main()
