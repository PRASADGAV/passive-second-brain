"""
Property test for services/domain_filter.py — Domain Tag Membership.

Property 8: Domain Tag Membership
    Use st.lists(st.text(min_size=1), min_size=1) for domain list; assert
    classify_domain result is in list or None.

# Feature: passive-second-brain, Property 8: domain tag membership

Requirements: 5.2
"""

from hypothesis import given, settings
from hypothesis import strategies as st

from services.domain_filter import classify_domain


# Strategy for generating printable, non-empty domain name strings
_domain_name = st.text(
    alphabet=st.characters(whitelist_categories=("L", "N", "Z")),
    min_size=1,
    max_size=50,
).filter(lambda s: s.strip())

# Strategy for generating a list of at least one user domain
_domain_list = st.lists(_domain_name, min_size=1, max_size=10)


# ---------------------------------------------------------------------------
# Property 8: Domain Tag Membership
# ---------------------------------------------------------------------------

class TestProperty8DomainTagMembership:
    """
    # Feature: passive-second-brain, Property 8: domain tag membership
    # Validates: Requirements 5.2
    """

    @given(
        user_domains=_domain_list,
        text=st.text(min_size=1, max_size=2000),
    )
    @settings(max_examples=100)
    def test_classify_domain_returns_member_or_none(
        self, user_domains: list, text: str
    ):
        """
        For any user_domains list and any text, classify_domain must return
        either a member of the user_domains list or None.
        """
        result = classify_domain("https://example.com", text, user_domains)
        assert result is None or result in user_domains, (
            f"classify_domain returned {result!r} which is not in "
            f"user_domains={user_domains!r} and is not None"
        )

    @given(user_domains=_domain_list)
    @settings(max_examples=100)
    def test_empty_text_returns_none(self, user_domains: list):
        """Empty text should always return None regardless of domain list."""
        result = classify_domain("https://example.com", "", user_domains)
        assert result is None

    @given(text=st.text(min_size=1, max_size=2000))
    @settings(max_examples=100)
    def test_empty_domain_list_returns_none(self, text: str):
        """An empty domain list must always return None."""
        result = classify_domain("https://example.com", text, [])
        assert result is None

    @given(
        user_domains=_domain_list,
        text=st.text(min_size=1, max_size=2000),
    )
    @settings(max_examples=100)
    def test_result_is_not_from_outside_list(self, user_domains: list, text: str):
        """
        Stronger assertion: if a domain is returned, it must be the exact
        object (by value) from the user_domains list — not a substring or
        derived value.
        """
        result = classify_domain("https://example.com", text, user_domains)
        if result is not None:
            # Must be an exact match to one of the provided domains
            assert any(result == d for d in user_domains), (
                f"Result {result!r} does not exactly match any domain in the list"
            )
