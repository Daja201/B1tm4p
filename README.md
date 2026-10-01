# B1tm4p

A full assembly of the three B1tm4p prompt deliverables (backend core, content/reports
service, frontend) into one runnable project, per the shared contract in `0.md`.

## What was merged

- **Backend core** (`1.md`): `server.js` owns Express setup, auth, sessions, accounts,
  avatars, the tag/master-tag request-approval workflow, admin endpoints and `/admin-raw`.
- **Content & reports service** (`2.md`): mounted into the same backend process at boot —
  `backend/lib/contentDb.js` opens/migrates `content.db` and `reports.db`; `backend/lib/crossDb.js`
  resolves user/tag lookups read-only against `users.db`/`tags.db` (no `ATTACH`, no cross-file
  joins); `backend/routes/content.js` and `backend/routes/reports.js` implement posts, replies,
  likes, and reports; `backend/middleware/auth.js` is the session-cookie auth middleware those
  routers use. The core server's placeholder `501` stubs for `/api/v1/posts` and `/api/v1/reports`
  were removed and replaced with these routers.
- **Frontend** (`3.md`): the static HTML/CSS/vanilla-JS SPA, served by its own nginx container
  that reverse-proxies `/api/*` and `/uploads/*` to the backend. Its original build treated
  `/api/v1/posts` and `/api/v1/reports` as undocumented/`501` and deliberately left the feed,
  post-detail/reply-thread, like buttons, composer submission, and the reports page unwired
  rather than fabricate data (see its own notes in git history / `FRONTEND_NOTES.md` concept).
  Those have been wired up in `frontend/static/app.js` against the real, now-documented
  endpoints in `API_CONTRACT.md`: feed listing + pagination, post composer, post detail + nested
  reply thread (with inline reply forms), like toggling, report submission, and the
  manager/admin pending-reports queue with approve/dismiss actions.

The one documented frontend gap that remains genuine (not a merge omission): there is no
`GET` endpoint for a user's *own* tag-request history, only the manager/admin pending-queue
endpoint — see the `TODO(API contract gap)` comment near the account page's tag-requests
section in `app.js`.

One behavioral note carried over from the merge: `GET /api/v1/posts` and `GET /api/v1/posts/:id`
do not report whether the *current* user has already liked a post/reply (the content schema has
no such per-request field). The frontend therefore shows the like state optimistically from each
toggle response rather than on initial load.

## Project layout

```
b1tm4p/
  docker-compose.yml
  .env.example
  API_CONTRACT.md            # full, authoritative endpoint + schema reference
  backend/
    Dockerfile
    package.json
    server.js                # core: auth, accounts, avatars, tags, admin; mounts the routers below
    migrate.js                # creates/migrates users.db + tags.db on boot
    db/
      schema_users.sql
      schema_tags.sql
      schema_content.sql
      schema_reports.sql
    lib/
      contentDb.js            # opens/migrates content.db + reports.db
      crossDb.js               # read-only lookups into users.db / tags.db
      uploads.js                # multer + sharp handling for post/reply media
    middleware/
      auth.js                  # session-cookie auth used by the content/reports routers
    routes/
      content.js                # posts, replies, likes
      reports.js                 # report submission + moderation queue
  frontend/
    Dockerfile
    nginx.conf                  # proxies /api/* and /uploads/* to the backend service
    static/
      index.html
      app.js
      styles.css
```

## Google sign-in (optional)

A "Continue with Google" button on the login page performs a full OAuth2
authorization-code redirect handled entirely by the backend (`GET
/api/v1/auth/google` → Google consent screen → `GET
/api/v1/auth/google/callback`, implemented with the built-in Node `fetch`,
no extra dependency). On first login it creates (or, if the email already
has a password-based account, links) a `role='user'` account with
`email_verified=1` and an unusable random password hash.

To enable it:
1. Create an OAuth client at https://console.cloud.google.com/apis/credentials
   (type "Web application").
2. Add this Authorized redirect URI (adjust host/port if you changed
   `PUBLIC_BASE_URL`): `http://localhost:8080/api/v1/auth/google/callback`
3. Set `GOOGLE_CLIENT_ID` and `GOOGLE_CLIENT_SECRET` in `.env`.

The button is always shown; if the env vars are unset, clicking it hits
`GET /api/v1/auth/google`, which returns `503
{"error":"google_oauth_not_configured"}` as a raw JSON page rather than a
styled error (it's a plain link/redirect, not an API fetch the frontend can
intercept) — set the credentials before relying on it in production.

## Running it

```bash
cp .env.example .env
# edit .env: set ADMIN_EMAIL / ADMIN_INITIAL_PASSWORD, and real SMTP credentials
# if you want verification/login-link/password-reset emails to actually send
docker compose up --build
```

- Frontend: http://localhost
- Backend API directly: http://localhost:8080/api/v1/...
- Admin raw page (after logging in as the bootstrapped admin): http://localhost/admin-raw
  (served by the backend, proxied through the frontend nginx, linked unstyled
  from `/account` for admins — also reachable directly at
  http://localhost:8080/admin-raw)

On first boot, `migrate.js` creates `users.db`/`tags.db`; the backend process also creates
`content.db`/`reports.db` on startup. The admin account from `ADMIN_EMAIL` /
`ADMIN_INITIAL_PASSWORD` is created automatically if it doesn't already exist.

## Full endpoint reference

See `API_CONTRACT.md` at the repo root — it is the single source of truth, including the
content/reports endpoints added during this assembly.
