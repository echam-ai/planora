# Site password and profile selection

Per-user passwords, password change and the administrative reset command were
retired by #120. One shared site password (`APP_PASSWORD`, #124) now sits in
front of the app: open the app, enter it on `/login`, then choose **Hamster
Knight** or **Ech Princess**. **Switch account** returns to the chooser and
**Lock** signs out of that browser.

**Changing the password, or signing everyone out.** Edit `APP_PASSWORD` (at
least 12 characters) and/or `SESSION_SECRET` (at least 32, for example
`openssl rand -base64 32`) in the deployment env file, then recreate the `api`
and `scheduler` services. Either change invalidates every issued access cookie,
so every browser returns to `/login`. The cookie is stateless, so **Lock** cannot
revoke a copy someone kept: rotate `SESSION_SECRET` to do that. A blank or too
short value stops the services from starting.

Selection separates saved tasks, archive, chat and settings; anyone who has
unlocked the app can choose either profile. It is not an access-control boundary.
See [local setup](../../README.md#run-locally-on-macos) and
[deployment setup](compose-stack.md). Apply migrations before launching; existing
data belongs to Hamster Knight and Ech Princess starts empty/default.
