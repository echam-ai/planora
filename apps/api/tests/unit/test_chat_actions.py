"""Unit tests for `domain.chat_actions` (issue #41, spec §10.1-§10.4).

Pure — no fixtures beyond plain values, no database, no LLM.
"""

from __future__ import annotations

from datetime import UTC, datetime

from planora_api.domain import chat_actions

TZ = "Asia/Singapore"  # UTC+8, no DST


# --- format_deadline / format_links ------------------------------------------


def test_format_deadline_renders_dd_mon_yyyy_hh_mm_24h_in_the_zone() -> None:
    deadline_at = datetime(2026, 10, 9, 9, 0, tzinfo=UTC)  # 17:00 Singapore
    assert chat_actions.format_deadline(deadline_at, TZ) == "09 Oct 2026, 17:00"


def test_format_deadline_none_is_no_deadline() -> None:
    assert chat_actions.format_deadline(None, TZ) == "No deadline"


def test_format_links_joins_urls_with_comma_space() -> None:
    urls = [{"url": "https://a.example", "label": None}, {"url": "https://b.example", "label": "B"}]
    assert chat_actions.format_links(urls) == "https://a.example, https://b.example"


def test_format_links_empty_is_empty_string() -> None:
    assert chat_actions.format_links([]) == ""


# --- create_fields ------------------------------------------------------------


def test_create_fields_order_and_from_is_always_none() -> None:
    fields = chat_actions.create_fields(
        title="Book dentist",
        content="Call ahead",
        category="personal",
        priority="high",
        deadline_at=datetime(2026, 10, 9, 9, 0, tzinfo=UTC),
        urls=[],
        timezone_name=TZ,
    )
    assert [f.label for f in fields] == ["Title", "Content", "Category", "Priority", "Deadline"]
    assert all(f.from_value is None for f in fields)
    assert fields[0].to_value == "Book dentist"
    assert fields[2].to_value == "Personal"
    assert fields[3].to_value == "High"
    assert fields[4].to_value == "09 Oct 2026, 17:00"


def test_create_fields_appends_links_only_when_urls_present() -> None:
    without_urls = chat_actions.create_fields(
        title="T", content="C", category="work", priority="low",
        deadline_at=None, urls=[], timezone_name=TZ,
    )
    assert [f.label for f in without_urls] == ["Title", "Content", "Category", "Priority", "Deadline"]

    with_urls = chat_actions.create_fields(
        title="T", content="C", category="work", priority="low",
        deadline_at=None, urls=[{"url": "https://example.com", "label": None}], timezone_name=TZ,
    )
    assert [f.label for f in with_urls][-1] == "Links"
    assert with_urls[-1].to_value == "https://example.com"


# --- changed_update_keys / update_fields --------------------------------------

_CURRENT = {"title": "Old", "content": "Old content", "category": "work", "priority": "low"}


def test_changed_update_keys_only_includes_present_and_differing_keys() -> None:
    proposed = {"priority": "high", "category": "work"}  # category unchanged
    assert chat_actions.changed_update_keys(current=_CURRENT, proposed=proposed) == ["priority"]


def test_changed_update_keys_empty_when_no_field_differs() -> None:
    proposed = {"title": "Old", "category": "work"}
    assert chat_actions.changed_update_keys(current=_CURRENT, proposed=proposed) == []


def test_changed_update_keys_empty_when_nothing_proposed() -> None:
    assert chat_actions.changed_update_keys(current=_CURRENT, proposed={}) == []


def test_changed_update_keys_preserves_fixed_field_order() -> None:
    proposed = {"priority": "high", "title": "New", "content": "New content"}
    assert chat_actions.changed_update_keys(current=_CURRENT, proposed=proposed) == [
        "title", "content", "priority",
    ]


def test_update_fields_formats_category_and_priority_labels() -> None:
    proposed = {"category": "personal", "priority": "high"}
    fields = chat_actions.update_fields(current=_CURRENT, proposed=proposed, timezone_name=TZ)
    by_label = {f.label: f for f in fields}
    assert by_label["Category"].from_value == "Work"
    assert by_label["Category"].to_value == "Personal"
    assert by_label["Priority"].from_value == "Low"
    assert by_label["Priority"].to_value == "High"


def test_update_fields_empty_when_no_change() -> None:
    assert chat_actions.update_fields(current=_CURRENT, proposed={}, timezone_name=TZ) == []


# --- move_field / schedule_field -----------------------------------------------


def test_move_field_none_when_status_unchanged() -> None:
    assert chat_actions.move_field(current_status="todo", new_status="todo") is None


def test_move_field_renders_status_labels() -> None:
    field = chat_actions.move_field(current_status="todo", new_status="done")
    assert field is not None
    assert field.label == "Status"
    assert field.from_value == "Todo"
    assert field.to_value == "Done"


def test_schedule_field_none_when_deadline_unchanged() -> None:
    deadline_at = datetime(2026, 10, 9, 9, 0, tzinfo=UTC)
    assert chat_actions.schedule_field(
        current_deadline_at=deadline_at, new_deadline_at=deadline_at, timezone_name=TZ
    ) is None


def test_schedule_field_none_when_both_null() -> None:
    assert chat_actions.schedule_field(
        current_deadline_at=None, new_deadline_at=None, timezone_name=TZ
    ) is None


def test_schedule_field_renders_deadline_values_including_removal() -> None:
    deadline_at = datetime(2026, 10, 9, 9, 0, tzinfo=UTC)
    field = chat_actions.schedule_field(
        current_deadline_at=deadline_at, new_deadline_at=None, timezone_name=TZ
    )
    assert field is not None
    assert field.from_value == "09 Oct 2026, 17:00"
    assert field.to_value == "No deadline"


# --- is_stale -------------------------------------------------------------------


def test_is_stale_false_when_every_snapshot_value_matches() -> None:
    current = {"status": "todo", "priority": "low"}
    assert chat_actions.is_stale(current=current, snapshot={"status": "todo"}) is False


def test_is_stale_true_when_a_snapshot_value_no_longer_matches() -> None:
    current = {"priority": "medium"}
    assert chat_actions.is_stale(current=current, snapshot={"priority": "low"}) is True


def test_is_stale_false_for_an_empty_snapshot() -> None:
    assert chat_actions.is_stale(current={"anything": "value"}, snapshot={}) is False


def test_is_stale_true_when_current_is_missing_the_key_entirely() -> None:
    # A deleted/archived task's caller passes no matching key for it —
    # covered separately by the caller, but this function alone still
    # reports a mismatch rather than silently ignoring a missing key.
    assert chat_actions.is_stale(current={}, snapshot={"status": "todo"}) is True


# --- confirm_outcome / reject_outcome --------------------------------------------


def test_confirm_outcome_pending_applies() -> None:
    assert chat_actions.confirm_outcome("pending") == "apply"


def test_confirm_outcome_applied_is_noop() -> None:
    assert chat_actions.confirm_outcome("applied") == "noop"


def test_confirm_outcome_rejected_is_already_rejected() -> None:
    assert chat_actions.confirm_outcome("rejected") == "already_rejected"


def test_reject_outcome_pending_rejects() -> None:
    assert chat_actions.reject_outcome("pending") == "reject"


def test_reject_outcome_rejected_is_noop() -> None:
    assert chat_actions.reject_outcome("rejected") == "noop"


def test_reject_outcome_applied_is_already_applied() -> None:
    assert chat_actions.reject_outcome("applied") == "already_applied"
