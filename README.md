# SliqDesk – Multi-Tenant Customer Support Ticket Management

SliqDesk is a Dockerized, multi-tenant SaaS help desk. Each customer company is an **organization** that owns its own members, tickets, comments, notifications, and SLA policy. One organization's data is never visible to another. Tickets update in real time over Socket.IO, and a separate background worker enforces response-time SLAs using a persistent PostgreSQL job queue.

```
docker compose up -d --build
```

| What | URL |
|---|---|
| Web app | http://localhost:3000 |
| API health (through Nginx) | http://localhost:3000/api/health |
| API health (direct) | http://localhost:5000/api/health |
| PostgreSQL | localhost:5432 (database `sliqdesk_db`) |

---

## Table of contents

1. [Business requirements overview](#1-business-requirements-overview)
2. [Architecture](#2-architecture)
3. [Folder structure](#3-folder-structure)
4. [Technology stack](#4-technology-stack)
5. [Multi-tenancy](#5-multi-tenancy)
6. [Database schema](#6-database-schema)
7. [Layered backend architecture](#7-layered-backend-architecture)
8. [Authentication flow](#8-authentication-flow)
9. [Roles and permissions](#9-roles-and-permissions)
10. [Ticket lifecycle](#10-ticket-lifecycle)
11. [SLA background processing](#11-sla-background-processing)
12. [Socket.IO architecture](#12-socketio-architecture)
13. [API reference](#13-api-reference)
14. [Environment configuration](#14-environment-configuration)
15. [Docker architecture](#15-docker-architecture)
16. [Installing Docker on Windows](#16-installing-docker-on-windows)
17. [Build, start, stop, logs, shell](#17-build-start-stop-logs-shell)
18. [PostgreSQL with DBeaver](#18-postgresql-with-dbeaver)
19. [Volumes and resetting the database](#19-volumes-and-resetting-the-database)
20. [Local development without Docker](#20-local-development-without-docker)
21. [Troubleshooting](#21-troubleshooting)
22. [Security considerations](#22-security-considerations)
23. [Business assumptions and implementation decisions](#23-business-assumptions-and-implementation-decisions)

---

## 1. Business requirements overview

- **Signup creates an organization**, and the person who signs up becomes its first **admin**.
- Admins **invite** members (admin / agent / viewer). An invitee sets a password through a one-time link, and their account exists only once they accept.
- **Admins and agents** create tickets and comment on them. **Viewers** have read-only access.
- An agent may update only tickets **assigned to them** or **unassigned** tickets. An admin may update any ticket.
- Tickets move through a fixed **status workflow**. A **closed** ticket is immutable.
- **High and urgent** tickets must receive a staff (admin/agent) reply within the organization's SLA time (default 5 minutes). If none arrives, a worker flags the ticket **overdue** and notifies every member.
- Ticket, comment, overdue, and notification events appear live in every browser of the same organization.

## 2. Architecture

```
                        Browser (React SPA)
                 REST (cookie + CSRF)   WebSocket (cookie)
                               │             │
                 ┌─────────────▼─────────────▼──────────────┐
  :3000 ───────► │ frontend  (Nginx)                         │
                 │  /            → React build (SPA fallback)│
                 │  /api/*       → backend:5000              │
                 │  /socket.io/* → backend:5000 (Upgrade)    │
                 └─────────────┬─────────────────────────────┘
                               │  docker network "sliqdesk"
                 ┌─────────────▼─────────────┐        ┌────────────────────────┐
  :5000 ───────► │ backend (Express+Socket.IO)│        │ worker (same image)     │
                 │ Route→MW→Controller→       │        │ npm run worker          │
                 │ Service→Repository         │        │ polls sla_jobs every 30s│
                 │ LISTEN sliqdesk_events ◄───┼────────┤ FOR UPDATE SKIP LOCKED  │
                 └─────────────┬──────────────┘ NOTIFY └───────────┬────────────┘
                               │ pg pool                           │ pg pool
                         ┌─────▼───────────────────────────────────▼──┐
  :5432 ───────────────► │ postgres 17  (volume pgdata, init.sql)      │
                         └─────────────────────────────────────────────┘
```

The worker never talks to browsers directly. It publishes events with `pg_notify` **inside its transaction**, so an event is delivered only if the transaction commits. The API process `LISTEN`s on that channel and re-emits each event to the correct Socket.IO room.

## 3. Folder structure

```
sliqdesk/
├── backend/
│   ├── src/
│   │   ├── config/        env.js, database.js (pool + withTransaction), socket.js
│   │   ├── constants/     roles, ticketStatus (transition table), ticketPriority, events
│   │   ├── controllers/   HTTP ⇄ service translation only
│   │   ├── middlewares/   auth, role, tenant, csrf, rateLimit, error
│   │   ├── repositories/  ALL SQL (parameterised, org-scoped)
│   │   ├── routes/        endpoint + middleware wiring
│   │   ├── services/      business rules, permissions, transactions, slaJobProcessor (worker logic)
│   │   ├── utils/         jwt (RS256), password (bcrypt), cookies, validation, response, logger
│   │   ├── workers/       slaWorker.js (thin entry point of the separate worker process)
│   │   ├── testUtils/     shared test helpers (not shipped in the image)
│   │   ├── app.js         Express app
│   │   └── server.js      HTTP + Socket.IO bootstrap
│   ├── jest.setup.js      test environment (no real DB / .env)
│   ├── Dockerfile
│   └── package.json       npm test / npm run test:coverage
│   (unit tests are colocated next to the code: *.test.js)
├── frontend/
│   ├── src/
│   │   ├── api/api.js     Axios instance (credentials, CSRF, error normalisation)
│   │   ├── components/    common/ layout/ tickets/ members/
│   │   ├── context/       AuthContext.jsx
│   │   ├── hooks/         useSocketEvents, useDebouncedCallback
│   │   ├── pages/         Login, Signup, AcceptInvite, Dashboard, TicketList, TicketDetails,
│   │   │                  CreateTicket, Members, Settings
│   │   ├── routes/        ProtectedRoute.jsx
│   │   ├── services/      auth / ticket / comment / member / notification / settings
│   │   ├── socket/        socket.js (single shared client)
│   │   ├── utils/         permissions.js (UI rules), format.js
│   │   └── testUtils/     fakeSocket, renderWithRouter (tests only)
│   ├── jest.config.js / jest.setup.js / babel.config.js   (Jest + React Testing Library)
│   ├── vite.config.mjs
│   ├── nginx.conf
│   └── Dockerfile         multi-stage (Vite build → Nginx)
│   (component tests are colocated: *.test.jsx)
├── database/init.sql      schema, constraints, indexes, triggers
├── docker-compose.yml
├── .env / .env.example
└── README.md
```

## 4. Technology stack

| Layer | Technology |
|---|---|
| Frontend | React 19, Vite 7, JavaScript, React Router 7, Axios, Socket.IO client, plain CSS |
| Backend | Node.js 24 LTS, Express 5 (CommonJS), `pg` (raw SQL, no ORM), Socket.IO 4, jsonwebtoken (RS256), bcrypt, helmet, cors, express-rate-limit, cookie-parser, dotenv |
| Database | PostgreSQL 17 |
| Background | Separate Node.js worker process using a PostgreSQL job table |
| DevOps | Docker, Docker Compose, Nginx |

## 5. Multi-tenancy

**Model:** a shared database and shared schema. Every business table has an `organization_id` column.

Isolation is enforced at four independent levels:

1. **Identity.** `organization_id` comes only from the authenticated user, which the auth middleware loads from the database on every request. `tenantMiddleware` builds a frozen `req.ctx` and deletes any `organizationId` / `organization_id` / `orgId` the client puts in the body.
2. **Repositories.** Every business query includes `WHERE organization_id = $1`. Lookups by id are always `(organization_id, id)`.
3. **Database constraints.** `UNIQUE (organization_id, id)` on users, tickets, and notifications lets the schema use **composite foreign keys**, so the database itself rejects cross-tenant references:
   - `tickets (organization_id, assignee_id)` → `users (organization_id, id)`
   - `tickets (organization_id, created_by)` → `users (organization_id, id)`
   - `comments (organization_id, ticket_id)` → `tickets (organization_id, id)`
   - `comments (organization_id, user_id)` → `users (organization_id, id)`
   - `notifications`, `notification_recipients`, `sla_jobs`, and `invitations` follow the same pattern.
4. **Responses.** A resource that belongs to another organization returns **404** (not 403), so ids cannot be probed. Assigning a user from another organization returns 400 with the same message as "not an active agent".

Real-time events go only to the `organization:<id>` and `user:<id>` rooms. The server assigns rooms during the handshake, and clients have no way to join a room themselves.

## 6. Database schema

```
organizations 1─┬─< users >─┐ (composite FKs on (organization_id, id))
                ├─< invitations (token_hash only)
                ├─< tickets ──< comments
                │      │  └──< notifications ──< notification_recipients >── users
                │      └──1 sla_jobs (one row per ticket, re-armed per cycle)
                ├──1 sla_settings
                └─< audit_logs (append-only)
```

| Table | Purpose / notable columns |
|---|---|
| `organizations` | Tenants |
| `users` | `role CHECK IN (admin, agent, viewer)`, `UNIQUE(organization_id, email)`, `UNIQUE(organization_id, id)`. Soft delete via `is_active` and `deactivated_at`. `token_version` invalidates all JWTs |
| `invitations` | Member onboarding. Stores the SHA-256 `token_hash`, `expires_at`, `accepted_at`, and `revoked_at`. A partial unique index allows only one open invitation per email per organization |
| `tickets` | Status and priority CHECKs, `overdue`, `sla_due_at`, and `version` (optimistic concurrency) |
| `comments` | `is_staff_response` (author was admin/agent when posting; used for SLA) |
| `sla_settings` | One row per organization: `response_time_minutes` (1–43200, default 5) |
| `sla_jobs` | `UNIQUE(organization_id, ticket_id)`, `cycle`, `started_at`, `scheduled_at` (deadline), and `status` (pending, completed, cancelled, overdue) |
| `notifications` | `dedupe_key` with `UNIQUE(organization_id, dedupe_key)` makes overdue alerts idempotent |
| `notification_recipients` | Per-user `read_at`, so each member reads notifications independently |
| `audit_logs` | event_type, entity_type, entity_id, performed_by, performed_at (UTC), old_value / new_value (JSONB), ip_address. A trigger blocks UPDATE and DELETE |

Required indexes are present: `users(organization_id,email)`, `tickets(organization_id,status|priority|assignee_id|created_at)`, `comments(organization_id,ticket_id,created_at)`, `sla_jobs(status,scheduled_at)`, and `notifications(organization_id,created_at)`. All time columns are `TIMESTAMPTZ`. An `updated_at` trigger maintains timestamps.

## 7. Layered backend architecture

```
Route  →  Middleware  →  Controller  →  Service  →  Repository  →  PostgreSQL
```

| Layer | Does | Never does |
|---|---|---|
| Routes | Declare endpoints and attach `authenticate`, `tenantContext`, `authorizeRoles(...)` | Business logic |
| Middleware | Authenticate the cookie, set tenant context, check the coarse role, CSRF, rate limiting, central error handling | SQL |
| Controllers | Read params and body, call one service, return the envelope with the status code | SQL, rules |
| Services | Validation, permission rules (ticket ownership, last admin), status transitions, SLA rules, transactions, audit, realtime emit **after commit** | HTTP |
| Repositories | Parameterized SQL scoped by `organization_id` | HTTP, rules |

Every response uses the same envelope:

```json
{ "success": true,  "message": "Ticket created", "data": { }, "error": null, "errorCode": null, "timestamp": "2026-…Z" }
{ "success": false, "message": "Validation failed", "data": null, "error": { "fields": { "title": "title is required" } }, "errorCode": "VALIDATION_ERROR", "timestamp": "…" }
```

## 8. Authentication flow

1. The SPA calls `GET /api/v1/auth/csrf`. The server sets the `sliqdesk_csrf` cookie (readable by JS, `SameSite=Strict`).
2. `POST /auth/signup` or `POST /auth/login`, with header `X-CSRF-Token: <csrf cookie>`.
   - Signup runs in **one transaction**: create organization → hash password with bcrypt (cost 12) → create admin user → create default SLA settings → write audit row → commit.
3. The server sets `sliqdesk_token`, an **RS256 JWT** in a cookie that is **HttpOnly**, `SameSite=Lax`, and `Secure` in production. It expires after 60 minutes. The payload holds only `sub`, `org`, and `tv` (token version).
4. On every request (and on every socket handshake), `authService.resolveSession` verifies the signature, expiry, issuer, and audience. It then **re-loads the user from the database** and rejects inactive users or a `token_version` mismatch. Role changes and removals therefore take effect immediately.
5. **Sliding session:** once more than half the token's lifetime has passed, the next authenticated request receives a fresh cookie.
6. `POST /auth/logout` clears the cookie. Removing a member bumps `token_version`, which invalidates every token that member holds, and disconnects their sockets.

**Same email in several organizations.** Email is unique only *per organization*. If one email and password unlock accounts in more than one organization, login returns `409 ORGANIZATION_SELECTION_REQUIRED` with the matching organizations (only those the password actually unlocked). The login page then lets the user pick one.

**JWT keys.** On first start the API generates an RSA-2048 key pair into the `jwt_keys` volume. Alternatively, inject `JWT_PRIVATE_KEY_B64` and `JWT_PUBLIC_KEY_B64` from a secret store such as Azure Key Vault. No signing secret lives in `.env`.

## 9. Roles and permissions

| Action | Admin | Agent | Viewer |
|---|:-:|:-:|:-:|
| View tickets and comments | ✅ | ✅ | ✅ |
| Create tickets | ✅ | ✅ | ❌ |
| Add comments | ✅ | ✅ | ❌ |
| Update any ticket | ✅ | ❌ | ❌ |
| Update tickets assigned to self | ✅ | ✅ | ❌ |
| Update unassigned tickets | ✅ | ✅ | ❌ |
| Manage members and SLA settings | ✅ | ❌ | ❌ |

- `authorizeRoles('admin','agent')` is the coarse gate in routes.
- `ticketService.assertCanModify` enforces the ownership rule against the row **locked `FOR UPDATE`**.
- The frontend mirrors these rules in `src/utils/permissions.js` to hide controls, but the backend is authoritative.
- Members:
  - The last admin cannot be demoted or removed. This check runs while all admin rows are locked, so it is race-safe.
  - Duplicate emails in an organization return 409.
  - Demoting a member to viewer unassigns their tickets.

## 10. Ticket lifecycle

```
          ┌──────────────┐
          ▼              │
  open ──────► in_progress
   │  ▲            │
   │  └────────────┘ (in_progress → open)
   ▼               ▼
  resolved ◄───────┘
   │   └──► open   (reopen)
   ▼
  closed   (terminal, immutable, no comments)
```

Enforced in `ticketService` using `constants/ticketStatus.js`:
- Invalid transitions return `400 INVALID_STATUS_TRANSITION`.
- Changes to a closed ticket return `409 TICKET_CLOSED`.

Every update:
- runs in a transaction that locks the ticket row (`SELECT … FOR UPDATE`), then validates the transition and permissions against the **current database state**;
- may send `version`. If someone else changed the ticket first, the API returns `409 STALE_TICKET`, and the UI reloads the ticket.

## 11. SLA background processing

**Monitored ticket:** priority ∈ {high, urgent} **and** status ∈ {open, in_progress}.
**SLA cycle:** time until the first qualifying reply. A qualifying reply is a comment from an admin or agent, posted at or before the cycle's deadline.

| Situation | Rule |
|---|---|
| Created as high/urgent | New cycle; deadline = now + organization minutes |
| Staff comment before the deadline | Job → `completed` ("met"). The ticket is never flagged |
| Viewer comment | Does not count (viewers cannot comment anyway) |
| Deadline reached with no reply | The worker sets the ticket to `overdue = true` and the job to `overdue`, notifies **all active members**, and emits `ticket:overdue` and `notification:created` |
| Resolved or closed before the deadline | Pending job → `cancelled` |
| Priority medium/low → high/urgent | **New cycle from the escalation time** |
| Priority high ↔ urgent | No change; the same cycle continues |
| Priority urgent/high → low/medium | Pending job → `cancelled`. An existing overdue flag is kept as history |
| Reopened (resolved → open) and monitored | **New cycle** (`cycle + 1`), `overdue` reset to false, new deadline |
| SLA setting changed | Applies to cycles started **after** the change. Pending deadlines are not moved, which keeps behavior predictable and auditable |
| Worker down or restarted | Jobs are rows in PostgreSQL. On start, the worker immediately processes everything already due |
| Several workers | `SELECT … FOR UPDATE SKIP LOCKED` (one job per transaction): each job is claimed by exactly one worker |
| Duplicate protection | Job status transitions only from `pending`, and the notification `dedupe_key = sla_overdue:<ticket>:<cycle>` is unique, so a breach produces exactly one notification per cycle |
| Reply landing "just before" the deadline | The comment transaction locks the SLA job **before** inserting the comment, so it uses the DB clock (`clock_timestamp()`) and the worker cannot decide concurrently. The worker also re-checks for staff comments inside `[started_at, deadline]` |

**Deadlock avoidance.** API transactions lock ticket → job. The worker locks job → ticket, but takes the ticket lock with `SKIP LOCKED`. If the ticket is busy, the worker skips the job and retries on the next poll.

**Polling**, not timers: every `SLA_POLL_INTERVAL_MS` (30 s) the worker drains up to `SLA_BATCH_SIZE` due jobs. An overdue flag can therefore appear up to about 30 s after the deadline. A failing job records `attempts` and `last_error` and does not block other jobs.

## 12. Socket.IO architecture

- **Handshake auth:** the server reads the same HttpOnly cookie, runs the same `resolveSession` as REST (database re-validation), and checks the `Origin` header against `CORS_ORIGINS`. Invalid connections receive `connect_error: unauthorized`.
- **Rooms** are assigned by the server: `organization:<orgId>` and `user:<userId>`. There is **no** subscribe handler.
- **Expiry:** a socket is disconnected when its JWT expires. On reconnect, the client presents the (sliding-renewed) cookie, or AuthContext sends the user to login.
- **Member removal:** `disconnectSockets()` on the member's `user:<id>` room.
- **Worker events:** `pg_notify('sliqdesk_events', {room, event, payload})`. The API `LISTEN`s, validates the room pattern, and emits. The listener reconnects automatically with backoff.

| Event | Room | Payload |
|---|---|---|
| `ticket:created` | organization | ticket DTO |
| `ticket:updated` | organization | ticket DTO (or `{id}` for bulk unassignments) |
| `comment:created` | organization | `{ ticketId, comment }` |
| `ticket:overdue` | organization | `{ id, title, priority, status, overdue, slaDueAt }` |
| `notification:created` | organization (overdue) or user (assignment) | notification DTO |
| `members:changed` | organization | `{ reason, userId }` |

**Frontend:** a single shared client (`src/socket/socket.js`) with automatic reconnection. `useSocketEvents(handlers, onReconnect)` subscribes per page. **After a reconnect every page refetches** its data to recover events missed while offline. Bursts of events are debounced into a single refetch. The navbar dot shows the connection state.

## 13. API reference

All endpoints are available under **`/api/v1/...`** (versioned). `/api/...` is an alias for the current version. Every state-changing request needs the `X-CSRF-Token` header.

| Method | Path | Roles | Notes |
|---|---|---|---|
| GET | `/health` | public | Checks the DB; 503 if it is down |
| GET | `/auth/csrf` | public | Issues the CSRF cookie |
| POST | `/auth/signup` | public, rate-limited | `{organizationName, name, email, password}` → 201 + cookie |
| POST | `/auth/login` | public, rate-limited | `{email, password, organizationId?}` |
| POST | `/auth/logout` | any | Clears the cookie |
| GET | `/auth/me` | any | Current user and organization |
| POST | `/auth/invitations/preview` | public, rate-limited | `{token}` → name, email, role, organizationName |
| POST | `/auth/invitations/accept` | public, rate-limited | `{token, password}` → 201 + cookie |
| GET | `/members` | admin | `{members, invitations}` |
| GET | `/members/directory` | any | `[{id,name,role}]` for pickers and filters |
| POST | `/members` | admin | `{name,email,role}` → invitation (+ `invitationUrl` when not in production) |
| PUT | `/members/:id/role` | admin | `{role}` |
| DELETE | `/members/:id` | admin | Soft remove, kills sessions, unassigns tickets |
| DELETE | `/members/invitations/:id` | admin | Revoke an invitation |
| GET | `/tickets` | any | `page, limit(≤100), status, priority, assigneeId (id or unassigned), overdue` → `{items, pagination{page,limit,total,totalPages}}` |
| GET | `/tickets/stats` | any | total, open, in_progress, resolved, closed, overdue |
| POST | `/tickets` | admin, agent | `{title, description, priority?, assigneeId?}` |
| GET | `/tickets/:id` | any | Ticket + creator + assignee + comments + `sla` |
| PUT | `/tickets/:id` | admin, agent (ownership rule) | Any subset of `{title, description, status, priority, assigneeId, version?}` |
| GET | `/tickets/:id/comments` | any | Chronological, with author |
| POST | `/tickets/:id/comments` | admin, agent | `{message}` (1–5000 chars) |
| GET | `/notifications` | any | `page, limit, unreadOnly` → `{items, unreadCount, pagination}` |
| PATCH | `/notifications/:id/read` | any (own only) | |
| PATCH | `/notifications/read-all` | any | |
| GET | `/settings/sla` | any | |
| PUT | `/settings/sla` | admin | `{responseTimeMinutes}` 1–43200 |

**Status codes:**

| Code | Meaning |
|---|---|
| 200 / 201 | Success |
| 400 | Validation error or invalid transition |
| 401 | Not authenticated or session invalid |
| 403 | Role, ownership, or CSRF failure |
| 404 | Not found, or belongs to another organization |
| 409 | Duplicate, last admin, closed ticket, or stale version |
| 429 | Rate limited |
| 500 | Generic message; details are logged server-side only |

**curl example** (CSRF + cookie jar):

```bash
curl -s -c jar -b jar http://localhost:3000/api/v1/auth/csrf >/dev/null
CSRF=$(grep sliqdesk_csrf jar | awk '{print $7}')
curl -s -c jar -b jar -H "X-CSRF-Token: $CSRF" -H "Content-Type: application/json" \
  -d '{"organizationName":"ABC Technologies","name":"John","email":"john@example.com","password":"Password123"}' \
  http://localhost:3000/api/v1/auth/signup
curl -s -b jar "http://localhost:3000/api/v1/tickets?status=open&priority=high&page=1&limit=10"
```

## 14. Environment configuration

Copy `.env.example` to `.env` and change the passwords. `.env` is git-ignored. The frontend build receives **no** environment variables, so database credentials and keys can never end up in the bundle.

| Variable | Default | Purpose |
|---|---|---|
| `POSTGRES_DB / POSTGRES_USER / POSTGRES_PASSWORD` | sliqdesk_db / postgres / – | Postgres container initialization |
| `DB_HOST / DB_PORT / DB_NAME / DB_USER / DB_PASSWORD` | – | API and worker connection (compose forces `DB_HOST=postgres`) |
| `DB_SSL` | false | Set to `true` for managed or remote PostgreSQL (TLS) |
| `BACKEND_PORT` | 5000 | API port inside the container |
| `JWT_EXPIRES_IN` | 60m | Token lifetime (sliding renewal) |
| `JWT_PRIVATE_KEY_B64 / JWT_PUBLIC_KEY_B64` | – | Optional injected RS256 keys |
| `COOKIE_NAME / CSRF_COOKIE_NAME` | sliqdesk_token / sliqdesk_csrf | |
| `COOKIE_SECURE` | true when production | Requires HTTPS |
| `SLA_POLL_INTERVAL_MS` | 30000 | Worker poll interval |
| `DEFAULT_SLA_MINUTES` | 5 | Used for new organizations |
| `INVITATION_EXPIRES_HOURS` | 72 | |
| `AUTH_RATE_LIMIT_MAX` | 20 | Attempts per 15 minutes per IP on auth endpoints |
| `FRONTEND_URL` | http://localhost:3000 | Used to build invitation links |
| `CORS_ORIGINS` | :3000, :5173 | Allowed browser origins (CORS, CSRF Origin check, Socket.IO) |
| `NODE_ENV` | development | `production` hides invitation URLs and enables Secure cookies |
| `FRONTEND_HOST_PORT / BACKEND_HOST_PORT / POSTGRES_HOST_PORT` | 3000 / 5000 / 5432 | Host port mappings |

## 15. Docker architecture

| Service | Image | Ports | Notes |
|---|---|---|---|
| `postgres` | postgres:17-alpine | 5432 | Volume `pgdata`; `init.sql` mounted into `/docker-entrypoint-initdb.d`; `pg_isready` health check |
| `backend` | `sliqdesk-backend` (node:24-alpine, production deps, non-root) | 5000 | `npm start`; waits for a healthy postgres; health check on `/api/health`; volume `jwt_keys` |
| `worker` | **same** `sliqdesk-backend` image | none | `npm run worker`; `restart: always`; waits for a healthy postgres |
| `frontend` | multi-stage: Vite build → nginx:stable-alpine | 3000→80 | SPA fallback, `/api` and `/socket.io` proxy with WebSocket upgrade headers, security headers (CSP); starts after the backend is healthy |

All services share the `sliqdesk` bridge network and address each other by service name. The compose **project name is `sliqdesk-app`**, so containers and volumes never collide with another project in a folder named `sliqdesk`.

> **init.sql runs only once.** The postgres image executes `/docker-entrypoint-initdb.d/*.sql` **only when the data directory is empty**, which is the first start with a fresh `pgdata` volume. Editing `init.sql` later has no effect until you reset the volume (section 19) or apply the change as a migration.

## 16. Installing Docker on Windows

1. Enable virtualization in the BIOS. On Windows 10/11, run `wsl --install` in an elevated PowerShell, then reboot.
2. Install **Docker Desktop for Windows** from docker.com and select **Use WSL 2 based engine**.
3. Start Docker Desktop and wait for "Engine running".
4. Verify: `docker version` and `docker compose version`.
5. If `docker` is "not recognized", add `C:\Program Files\Docker\Docker\resources\bin` (or `%LOCALAPPDATA%\Programs\DockerDesktop\resources\bin` for per-user installs) to PATH and reopen the terminal.

## 17. Build, start, stop, logs, shell

```bash
# build + start everything (first run initialises the DB)
docker compose up -d --build

# status / health
docker compose ps

# rebuild one service after code changes
docker compose up -d --build backend worker
docker compose up -d --build frontend

# logs
docker compose logs -f                 # all
docker compose logs -f backend worker  # API + SLA worker
docker compose logs --tail 100 postgres

# stop (keeps containers + data)       / start again
docker compose stop                     ; docker compose start
# remove containers + network (KEEPS volumes/data)
docker compose down

# shells
docker compose exec backend sh
docker compose exec worker sh
docker compose exec frontend sh
docker compose exec postgres psql -U postgres -d sliqdesk_db

# run several workers to see SKIP LOCKED in action
docker compose up -d --scale worker=3
```

## 18. PostgreSQL with DBeaver

1. Click **New Database Connection** and choose **PostgreSQL**.
2. Host `localhost`, Port `5432` (or your `POSTGRES_HOST_PORT`), Database `sliqdesk_db`.
3. Username `postgres`, password = `POSTGRES_PASSWORD` from `.env`.
4. Click **Test Connection** (let DBeaver download the driver), then **Finish**.

Useful queries:

```sql
SELECT id, title, priority, status, overdue, sla_due_at FROM tickets WHERE organization_id = 1;
SELECT * FROM sla_jobs ORDER BY scheduled_at DESC;
SELECT event_type, entity_type, entity_id, performed_by, performed_at FROM audit_logs ORDER BY id DESC LIMIT 50;
```

## 19. Volumes and resetting the database

```bash
docker volume ls --filter name=sliqdesk-app
docker volume inspect sliqdesk-app_pgdata

# FULL RESET - deletes all data AND the JWT keys (everyone is logged out)
docker compose down -v
docker compose up -d --build        # init.sql runs again on the empty volume

# reset only the database, keep JWT keys
docker compose down
docker volume rm sliqdesk-app_pgdata
docker compose up -d
```

## 20. Local development without Docker

```bash
# 1. a PostgreSQL (e.g. only the compose db):  docker compose up -d postgres
# 2. backend (reads ../.env, DB_HOST=localhost)
cd backend && npm install && npm run dev          # API on :5000
npm run dev:worker                                 # worker in a second terminal
# 3. frontend (Vite proxies /api and /socket.io to :5000)
cd frontend && npm install && npm run dev         # http://localhost:5173
```

### Unit tests

Backend uses Jest; frontend uses Jest + React Testing Library. Tests are colocated with the code (`*.test.js` / `*.test.jsx`), follow Arrange-Act-Assert, and need **no database or Docker**: repositories, services, and sockets are mocked.

```bash
cd backend  && npm test            # or: npm run test:coverage
cd frontend && npm test            # or: npm run test:coverage
```

Coverage gates (the run fails below them): **80% global**, and **95%** for security-critical files: auth service and middlewares, JWT, password, cookies, CSRF, member management, ticket and SLA services, the SLA job processor, the frontend API client, AuthContext, ProtectedRoute, and permissions. Test files and helpers are excluded from the Docker images via `.dockerignore`.

## 21. Troubleshooting

| Symptom | Fix |
|---|---|
| `Bind for 0.0.0.0:5432 failed: port is already allocated` | Another PostgreSQL is running. Stop it, or set `POSTGRES_HOST_PORT=5433` in `.env` (likewise `FRONTEND_HOST_PORT` / `BACKEND_HOST_PORT`) |
| Schema changes in `init.sql` are not applied | init scripts run only on an empty volume; see section 19 |
| `password authentication failed` after changing `.env` | The password is fixed at first initialization. Reset the volume or `ALTER USER` inside psql |
| Every POST returns `403 Invalid or missing CSRF token` | Call `GET /api/v1/auth/csrf` first and send its cookie value as `X-CSRF-Token` |
| `403 Request origin not allowed` | Add your origin to `CORS_ORIGINS` |
| Login works but the user is logged out immediately over plain HTTP | `NODE_ENV=production` makes cookies `Secure`. Use HTTPS, or set `COOKIE_SECURE=false` locally |
| Live dot is orange / no real-time updates | Check `docker compose logs frontend backend`; the Nginx `/socket.io/` location must keep the Upgrade headers |
| Overdue appears up to ~30 s after the deadline | Expected: worker poll interval (`SLA_POLL_INTERVAL_MS`) |
| `429 Too many attempts` | Auth rate limit; wait 15 minutes or restart the backend in development |
| `frontend` stays in `Created` state | It waits for a healthy backend: `docker compose logs backend` |

## 22. Security considerations

- **Tenant isolation:** derived identity, org-scoped SQL, composite foreign keys, 404 for foreign ids, and server-assigned socket rooms.
- **Passwords:** bcrypt (cost 12). Hashes are never selected except for login. Inputs over 72 bytes are rejected. A dummy hash equalizes timing for unknown emails.
- **Tokens:** RS256 JWTs in HttpOnly cookies, 60-minute sliding expiry, `token_version` revocation, and per-request database re-validation.
- **Invitation tokens:** 256-bit random values. Only the SHA-256 hash is stored. They expire, are single-use, and are revocable. The link puts the token in the URL **fragment** so it never reaches server or proxy logs.
- **CSRF:** a double-submit cookie plus an Origin allow-list check, on top of `SameSite` cookies.
- **Headers:** helmet on the API. Nginx adds CSP, X-Frame-Options DENY, nosniff, and Referrer-Policy.
- **Input:** a central validator, parameterized SQL everywhere, whitelisted dynamic filter columns, and a 100 KB JSON body limit.
- **Errors:** the central handler maps PostgreSQL codes to safe messages. Stack traces and SQL stay in server logs.
- **Rate limiting** on signup, login, and invitation endpoints. `trust proxy` is set to 1 so limits use the real client IP behind Nginx.
- **Audit trail:** `audit_logs` is append-only (enforced by a trigger). It never stores passwords, hashes, or tokens.
- **Containers:** the API and worker run as the non-root `node` user with production dependencies only.
- **Production checklist:**
  - Terminate TLS (HTTPS) in front of Nginx and set `NODE_ENV=production`.
  - Use strong DB credentials from a secret store.
  - Inject the JWT keys.
  - Set `DB_SSL=true` for remote databases.
  - Do not publish ports 5000 and 5432 publicly.
  - Add an email service for invitations.

## 23. Business assumptions and implementation decisions

| Topic | Decision |
|---|---|
| Login with the same email in several organizations | The password must match. If several accounts match, the user picks the organization (the `organizationId` only selects among accounts the credentials already unlock) |
| Removing a member | **Soft delete** (`is_active=false`) so authorship and history stay intact. Their tickets are unassigned (never deleted), their sessions are revoked, and their sockets are disconnected. Re-inviting the same email reactivates the account with the new password and role |
| Re-inviting a pending email | The previous open invitation is revoked and a new link is issued |
| Assignees | Must be **active admins or agents** of the same organization (viewers cannot work tickets). Demoting someone to viewer unassigns their tickets |
| Agents re-assigning | An agent who may edit a ticket (theirs or unassigned) may hand it to another staff member or unassign it |
| Agents and comments | Agents may comment on any open ticket in their organization (commenting is not restricted by assignment) |
| SLA "response" | The first admin/agent comment after the cycle starts. Status changes alone do not count |
| SLA overdue flag | Kept as history after resolution or de-escalation; reset only when a new cycle starts (reopen or escalation) |
| SLA setting changes | Apply to newly started cycles only (documented on the Settings page) |
| SLA settings visibility | All roles can read the SLA policy; only admins can change it |
| Notifications | Overdue: every active member at breach time. Assignment: the assignee only. `notifications.read_at` is kept for schema compatibility; per-user state lives in `notification_recipients.read_at` |
| Invitations without email | In non-production mode the API returns the invitation URL so the admin can share it. In production it is not returned (plug in an email sender) |
| Logout | Clears the cookie on this device. Removing a member revokes **all** of that member's sessions via `token_version` |
| API versioning | `/api/v1` is canonical, and `/api/*` aliases the current version as required by the brief |
| Organization data | Organizations are never deleted by the application |
| Time | Stored as `TIMESTAMPTZ` (UTC). SLA deadlines are computed with the database clock to avoid app/DB clock skew |
