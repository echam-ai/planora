"""Dynamic counterpart to `tests/unit/test_jobs_isolation.py`'s static AST
scan (issue #32): actually building the real app starts no background
thread for archiving, and `planora_api.jobs*` is not among the modules
Python imports as a side effect of `create_app()` itself — matching the
static/dynamic split issue #80 already uses for its `get_db` scope guard.
"""

from __future__ import annotations

import sys
import threading

import pytest

from planora_api.main import create_app


def test_create_app_starts_no_thread_and_imports_no_jobs_module(
    valid_env: pytest.MonkeyPatch,
) -> None:
    """`sys.modules` may already contain `planora_api.jobs*` from other
    test modules imported earlier in this same test session, so this
    asserts about what `create_app()` itself newly imports (a before/after
    diff), not about `sys.modules`' absolute contents."""
    before_threads = {t.ident for t in threading.enumerate()}
    before_modules = set(sys.modules)

    app = create_app()
    try:
        after_threads = {t.ident for t in threading.enumerate()}
        after_modules = set(sys.modules)

        assert after_threads == before_threads
        newly_imported = after_modules - before_modules
        jobs_modules = {
            name for name in newly_imported if name.split(".")[:2] == ["planora_api", "jobs"]
        }
        assert not jobs_modules, f"create_app() imported: {jobs_modules!r}"
    finally:
        app.state.session_factory.kw["bind"].dispose()
