"""In-memory login rate limiting, keyed by client IP (issue #124).

5 failed logins from one IP within a sliding 15-minute window block further
attempts from that IP; a successful login resets its count. State lives in
this process only: the API is a single uvicorn process (spec §15), and
`--proxy-headers --forwarded-allow-ips` makes `request.client.host` the real
client address. A restart clears all counters, an accepted trade-off.

Not keyed by anything a client controls: the router passes the ASGI client
host, never a raw `X-Forwarded-For`. Every method takes `now` explicitly, so
the limiter reads no clock and a test can drive time.
"""

from __future__ import annotations

import math
from collections import deque
from datetime import datetime, timedelta

FAILURE_LIMIT = 5
FAILURE_WINDOW = timedelta(minutes=15)


class LoginRateLimiter:
    def __init__(
        self, limit: int = FAILURE_LIMIT, window: timedelta = FAILURE_WINDOW
    ) -> None:
        self.limit = limit
        self.window = window
        self._failures: dict[str, deque[datetime]] = {}

    def _live(self, client: str, now: datetime) -> deque[datetime] | None:
        """The client's failures still inside the window, dropping the rest.

        A failure counts while `now < failed_at + window`; at exactly the
        window's end it has left.
        """
        failures = self._failures.get(client)
        if failures is None:
            return None
        cutoff = now - self.window
        while failures and failures[0] <= cutoff:
            failures.popleft()
        if not failures:
            del self._failures[client]
            return None
        return failures

    def retry_after(self, client: str, now: datetime) -> int | None:
        """Whole seconds until `client` may try again, or None if not blocked:
        the time until the oldest counted failure leaves the window."""
        failures = self._live(client, now)
        if failures is None or len(failures) < self.limit:
            return None
        remaining = (failures[0] + self.window - now).total_seconds()
        return max(1, math.ceil(remaining))

    def record_failure(self, client: str, now: datetime) -> None:
        # Sweep every client, not only this one, so an address that never
        # returns cannot keep its entry forever.
        for other in list(self._failures):
            self._live(other, now)
        self._failures.setdefault(client, deque()).append(now)

    def reset(self, client: str) -> None:
        self._failures.pop(client, None)

    def tracked_clients(self) -> int:
        return len(self._failures)
