"""Login rate limiting, keyed by client IP (issue #25).

5 failed logins from one IP within a sliding 15-minute window block further
attempts from that IP; a successful login clears its count. Failures are
rows in `login_failure`, pruned on read, so the limit survives a process
restart and is shared across workers — there is no in-process cache here.

Not keyed by account: with exactly one account (spec §3.1), an account-level
lock would let anyone lock the owner out.

`record_failure` and `clear_failures` take a `sessionmaker`, not a live
`Session`: each opens its own short transaction and commits immediately,
independent of the caller's request-scoped session. That matters because a
recorded failure is always followed by `401 INVALID_CREDENTIALS` (or a
block by `429 RATE_LIMITED`) — an `ApiError` that rolls back the request's
own session (`api.deps.get_db`) — and the failure must survive that
rollback to actually count towards the limit next time.

`seconds_until_unblocked` is deliberately read-only (no pruning delete): on
SQLite, that write would hold a lock on the caller's own request-scoped
session for the rest of the request, which then deadlocks against
`record_failure`/`clear_failures` opening their own connection to commit
immediately afterward (`sqlite3.OperationalError: database is locked`).
Pruning stale rows happens instead inside `record_failure`'s own short
transaction, the one place this module actually needs to write.
"""

from __future__ import annotations

import math
from datetime import datetime, timedelta

from sqlalchemy import delete, select
from sqlalchemy.orm import Session, sessionmaker

from planora_api.db.models import LoginFailure

FAILURE_LIMIT = 5
FAILURE_WINDOW = timedelta(minutes=15)


def seconds_until_unblocked(db: Session, client_ip: str, now: datetime) -> int | None:
    """Return whole seconds until `client_ip` may try again, or `None` if it
    is not currently blocked.

    Read-only: counts failures within the window (see the module
    docstring for why this must not also prune/write).
    """
    cutoff = now - FAILURE_WINDOW
    failed_at_values = (
        db.execute(
            select(LoginFailure.failed_at)
            .where(LoginFailure.client_ip == client_ip, LoginFailure.failed_at >= cutoff)
            .order_by(LoginFailure.failed_at.asc())
        )
        .scalars()
        .all()
    )
    if len(failed_at_values) < FAILURE_LIMIT:
        return None
    oldest_failure_at = failed_at_values[0]
    remaining = (oldest_failure_at + FAILURE_WINDOW - now).total_seconds()
    return max(1, math.ceil(remaining))


def record_failure(
    session_factory: sessionmaker[Session], client_ip: str, now: datetime
) -> None:
    """Record one failed login attempt from `client_ip`, committed
    immediately in its own transaction — see the module docstring for why
    this can't share the request's own session.

    Also prunes this IP's failures already outside the window, in the same
    transaction — the natural place to keep `login_failure` from growing
    without bound, since this is the only place the module writes.
    """
    cutoff = now - FAILURE_WINDOW
    with session_factory() as session:
        session.execute(
            delete(LoginFailure).where(
                LoginFailure.client_ip == client_ip, LoginFailure.failed_at < cutoff
            )
        )
        session.add(LoginFailure(client_ip=client_ip, failed_at=now))
        session.commit()


def clear_failures(session_factory: sessionmaker[Session], client_ip: str) -> None:
    """Clear every recorded failure for `client_ip` (a successful login),
    committed immediately in its own transaction."""
    with session_factory() as session:
        session.execute(delete(LoginFailure).where(LoginFailure.client_ip == client_ip))
        session.commit()


def clear_all_login_failures(db: Session) -> None:
    """Clear every recorded login failure, for every client IP (issue #33:
    an administrative password reset also clears any active lockout, so a
    locked-out owner can sign in immediately with the new password).

    Unlike `clear_failures` above, this takes an already-open `Session`
    rather than a `sessionmaker` — the reset command needs this in the
    *same* transaction as the password change and session deletion (one
    all-or-nothing write), not a separate short transaction of its own.
    """
    db.execute(delete(LoginFailure))
