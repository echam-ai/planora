"""Unit tests for `domain.llm_models.available_models` (issue #86)."""

from __future__ import annotations

import pytest

from planora_api.domain.llm_models import available_models


@pytest.mark.parametrize("allowed", [None, "", "   ", " , ,, "])
def test_unset_or_blank_allow_list_is_exactly_the_default(allowed: str | None) -> None:
    assert available_models("kimi-k3", allowed) == ["kimi-k3"]


def test_default_first_then_allowed_in_order_without_duplicates() -> None:
    assert available_models("kimi-k3", " kimi-k3-thinking , ,kimi-k3") == [
        "kimi-k3",
        "kimi-k3-thinking",
    ]


def test_default_is_first_even_when_listed_later_and_repeats_collapse() -> None:
    assert available_models("a", "c,b,c,a,b") == ["a", "c", "b"]
