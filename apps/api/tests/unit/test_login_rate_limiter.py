"""In-memory sliding-window login limiter (issue #124, AC5/AC6)."""

from __future__ import annotations

from datetime import UTC, datetime, timedelta

from planora_api.security.rate_limit import LoginRateLimiter

T = datetime(2026, 3, 1, 12, 0, 0, tzinfo=UTC)
WINDOW = timedelta(minutes=15)


def _fail(limiter: LoginRateLimiter, ip: str, times: int, start: datetime = T, gap: float = 0) -> None:
    for i in range(times):
        limiter.record_failure(ip, start + timedelta(seconds=gap * i))


def test_constants() -> None:
    limiter = LoginRateLimiter()
    assert (limiter.limit, limiter.window) == (5, WINDOW)


def test_four_failures_do_not_block_five_do() -> None:
    limiter = LoginRateLimiter()
    _fail(limiter, "1.1.1.1", 4)
    assert limiter.retry_after("1.1.1.1", T) is None
    limiter.record_failure("1.1.1.1", T)
    assert limiter.retry_after("1.1.1.1", T) == 15 * 60


def test_retry_after_counts_down_from_oldest_failure_and_rounds_up() -> None:
    limiter = LoginRateLimiter()
    _fail(limiter, "1.1.1.1", 5, gap=10)  # failures at T, T+10 ... T+40
    now = T + timedelta(seconds=100, milliseconds=500)
    # oldest leaves at T+900s -> 799.5s remain -> 800
    assert limiter.retry_after("1.1.1.1", now) == 800


def test_retry_after_never_below_one() -> None:
    limiter = LoginRateLimiter()
    _fail(limiter, "1.1.1.1", 5)
    now = T + WINDOW - timedelta(milliseconds=1)
    assert limiter.retry_after("1.1.1.1", now) == 1


def test_allowed_again_when_window_has_passed() -> None:
    limiter = LoginRateLimiter()
    _fail(limiter, "1.1.1.1", 5)
    assert limiter.retry_after("1.1.1.1", T + WINDOW - timedelta(seconds=1)) is not None
    assert limiter.retry_after("1.1.1.1", T + WINDOW) is None


def test_sliding_window_drops_only_expired_failures() -> None:
    limiter = LoginRateLimiter()
    _fail(limiter, "1.1.1.1", 5, gap=60)  # T .. T+240s
    # At T+15min the first failure has expired: 4 remain, so not blocked.
    assert limiter.retry_after("1.1.1.1", T + WINDOW) is None


def test_other_ip_unaffected() -> None:
    limiter = LoginRateLimiter()
    _fail(limiter, "1.1.1.1", 5)
    assert limiter.retry_after("2.2.2.2", T) is None


def test_reset_clears_one_ip_only() -> None:
    limiter = LoginRateLimiter()
    _fail(limiter, "1.1.1.1", 4)
    _fail(limiter, "2.2.2.2", 5)
    limiter.reset("1.1.1.1")
    limiter.record_failure("1.1.1.1", T)
    assert limiter.retry_after("1.1.1.1", T) is None
    assert limiter.retry_after("2.2.2.2", T) is not None


def test_stale_entries_are_pruned_so_the_store_does_not_grow() -> None:
    limiter = LoginRateLimiter()
    for n in range(50):
        limiter.record_failure(f"10.0.0.{n}", T)
    assert limiter.tracked_clients() == 50
    limiter.record_failure("9.9.9.9", T + WINDOW)
    assert limiter.tracked_clients() == 1


def test_reading_prunes_an_expired_clients_entry() -> None:
    limiter = LoginRateLimiter()
    limiter.record_failure("1.1.1.1", T)
    assert limiter.retry_after("1.1.1.1", T + WINDOW) is None
    assert limiter.tracked_clients() == 0
