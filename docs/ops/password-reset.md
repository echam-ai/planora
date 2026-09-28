# Resetting the password

Planora has exactly one account (spec §3.1). If its password is forgotten,
it is reset with an administrative command run directly on the host —
never through the web UI or the HTTP API (spec §3.2). The same command
also creates the account on a brand-new deployment: nothing else in v1
creates it, so the first sign-in after a fresh install starts here too.

## Run it

**Production**, on the VPS, once the `deploy/compose.yml` stack from #43
is up:

```sh
docker compose -f deploy/compose.yml exec api python -m planora_api.admin.reset_password
```

`api` is the FastAPI service name from spec §14.3. If #43's Compose file
ever renames that service, update the command above to match.

**Local development**, from `apps/api`, against a migrated local database:

```sh
uv run python -m planora_api.admin.reset_password
```

Both forms need the same environment `docker compose` would normally give
the `api` service — `SESSION_SECRET`, `LLM_API_KEY` and `APP_ORIGIN` in
particular, even though this command never uses the LLM key or checks the
origin itself; `load_settings()` still requires them. The database must
already have its migrations applied (`alembic upgrade head`) — this
command never runs migrations itself.

### Do not pass `-T`

`docker compose exec` allocates a pseudo-TTY by default; `-T` disables
that. This command refuses to run at all without one (exit code `2`) — it
reads the new password with `getpass`, which needs a real terminal to
suppress echo, and a non-interactive stdin would otherwise be an easy way
for a password to end up in shell history or a script. Passing `-T` (or
piping input, e.g. `echo mypassword | …`) will not work here; leave `-T`
off.

## What it does

- With no account yet, it prompts for a username first (`Username`),
  trimmed and kept exactly as typed — case is never changed. With an
  account already present, it never prompts for or changes the username;
  only the password changes.
- The new password is typed twice (`New password`, `Confirm new
  password`), neither echoed to the terminal. A mismatch or a password
  outside the 6-to-1024-character rule reprints the problem and prompts
  again, up to three attempts in total (username and password attempts
  share that budget); the third failure aborts with nothing changed.
- On success, **every session is signed out** — there is no session to
  preserve, unlike a user-initiated password change from Settings, which
  keeps the browser tab that made the change signed in.
- On success, **every login lockout is cleared** — an owner locked out by
  the 5-failed-attempts-in-15-minutes limit can sign in immediately with
  the new password.
- The hash update, the session sign-out and the lockout clear all happen
  in one transaction: a failure partway through leaves the old password,
  the old sessions and the old lockout state exactly as they were.
- Neither the password nor its hash is ever printed or logged, at any log
  level.

## Exit codes

| Code | Meaning |
| --- | --- |
| `0` | Success — the password was reset, or the account was created. |
| `1` | The run failed: the database has not been migrated, some other database error occurred, or three attempts were exhausted. Nothing was changed. |
| `2` | Invalid configuration (the missing/invalid variable is named on stderr), an unrecognized command-line argument, or stdin is not a TTY (see "Do not pass `-T`" above). |
| `130` | Ctrl-C or EOF at any prompt. Nothing was changed. |

The command takes no password, username or hash as a command-line
argument or environment variable — its only argument is `--help`.
