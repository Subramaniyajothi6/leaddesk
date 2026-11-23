# LeadDesk backend (API)

Node 22 + TypeScript + Express 5 + Prisma 6 + PostgreSQL 16. Built from `docs/SYSTEM-DESIGN.md`; section numbers (§) below point there.
Every rule runs on the server: permissions on every request, allocation, statuses, attendance, metrics and finance maths.

## Run it

```bash
cp .env.example .env          # fill DATABASE_URL, TEST_DATABASE_URL, JWT secrets
npm install
npm run db:deploy             # apply migrations
npm run db:seed               # statuses, outcomes, sources, first Admin (password printed once)
npm run db:seed -- --demo     # optional: 3 teams, 3 Team Leads, 10 BDEs, 300 leads (password Demo@1234)
npm run dev                   # http://localhost:4000/api
npm test                      # unit + API tests against the TEST database only
```

- Background jobs run inside the API process. For bigger installs set `RUN_JOBS=0` on the API and run `npm run worker` separately.
- Web Push is optional: `npx web-push generate-vapid-keys` and put the keys in `.env`.
- Database: Neon free tier (project `leaddesk`, Singapore), branches `main` (dev) and `test` (tests). Use the direct, non-pooled host: row locks and migrations need it.
- If `P1001 Can't reach database` appears while the internet works, the network's DNS can't resolve `*.neon.tech`. Set Windows DNS to 1.1.1.1 / 8.8.8.8.

## Layout

```
prisma/schema.prisma           data model (§4); migration SQL adds partial unique indexes + append-only triggers
src/app.ts                     routes, auth, error handling          src/server.ts / worker.ts   entry points
src/lib/                       settings (every *(setting)* with its default), access/scoping, audit, money, phone, time, workdays
src/modules/auth               login, lockout, refresh cookie, forced first password change
src/modules/users, teams       people and teams, Inactive / Exited / transfer handling (§6)
src/modules/config             settings, statuses + transitions, outcomes, sources, custom fields, templates, scoring, limits, holidays, targets, audit log
src/modules/leads              list / views / detail + timeline / edit with version check / masking / trash
src/modules/imports            Excel/CSV upload, mapping, validation, duplicates (skip or merge), error file (§5.2)
src/modules/allocation         engine.ts (pure maths) + service.ts (eligibility, locking) + routes (stage 1, stage 2, manual, take back, history, undo)
src/modules/work               status changes (§7.3), calls (§8.1), attempts and recycling, WhatsApp, next-to-call queue
src/modules/followups          tabs, calendar range, quick picks that skip holidays, reschedule / cancel
src/modules/attendance         rules.ts (pure day status) + punch, month views, today board, corrections, time off
src/modules/metrics            THE metrics module (§9.5) + admin / team / BDE dashboards + leaderboard
src/modules/reports            performance, allocation, status + funnel, follow-ups, attendance, sources, lead history, finance → JSON / CSV / Excel / PDF
src/modules/finance            calc.ts (pure calculators) + calculations history, transactions, confirm / cancel, dashboard
src/modules/notifications      in-app bell, live updates (Server-Sent Events), Web Push
src/jobs                       reminders, absent check, punch-out close, nightly day status, low-lead sweep, recycling (§10.4)
```

## API at a glance (all under `/api`)

| Area | Endpoints |
|---|---|
| Auth | `POST auth/login` · `auth/refresh` · `auth/logout` · `auth/change-password` · `GET auth/me` |
| People | `GET/POST users` · `PATCH users/:id` · `POST users/:id/state` · `users/:id/transfer` · `users/:id/reset-password` · `PUT users/:id/match-values` |
| Teams | `GET/POST teams` · `PATCH teams/:id` · `POST teams/:id/lead` · `teams/:id/members` · `teams/:id/deactivate` |
| Settings | `GET settings` · `PATCH settings/:group` · `statuses` (+ `PUT statuses/:id/next`) · `call-outcomes` · `sources` · `templates` · `scoring-rules` · `PUT custom-fields/:key` · `limits` · `holidays/:date` · `targets` · `GET audit` |
| Leads | `GET leads` (views, filters, search by last digits) · `GET leads/views` · `GET/PATCH/DELETE leads/:id` · `POST leads/:id/restore` · `POST leads/:id/reveal-phone` · `GET leads/trash` |
| Upload | `POST imports/preview` · `POST imports` · `GET imports` · `GET imports/:id/rejects.csv` |
| Allocation | `POST allocation/teams(/preview)` · `allocation/distribute(/preview)` · `allocation/assign` · `allocation/assign-counts` · `allocation/take-back` · `allocation/move-pool` · `GET allocation/eligibility` · `allocation/runs(/:id)` · `allocation/bulk` · `POST allocation/bulk/:id/undo` |
| Work | `POST leads/:id/status` · `leads/:id/calls` · `leads/:id/remarks` · `leads/:id/whatsapp` · `GET me/queue` |
| Follow-ups | `GET follow-ups?tab=` · `GET follow-ups/quick-picks` · `POST follow-ups/lead/:leadId` · `PATCH follow-ups/:id` |
| Attendance | `POST attendance/punch-in` · `punch-out` · `GET attendance/me` · `GET attendance` · `attendance/today` · `attendance/corrections` (+ `/:id/decide`) · `PUT attendance/:userId/:date` · `attendance/time-off` |
| Dashboards | `GET dashboard/admin` · `dashboard/team` · `dashboard/bde` · `leaderboard` |
| Reports | `GET reports` · `GET reports/:kind?format=json|csv|xlsx|pdf` |
| Finance | `POST finance/calc/:type` · `GET finance/calculations` · `POST finance/transactions` (+ `/:id/confirm`, `/:id/cancel`) · `GET finance/transactions` · `finance/unpaid` · `finance/dashboard` |
| Live | `GET notifications` · `POST notifications/:id/read` · `notifications/read-all` · `GET events` (SSE) · `push/public-key` · `push/subscribe` |

Errors are always `{ "error": { "code", "message", "details" } }` with 400 (input), 401, 403, 404, 409 (conflict / stale version), 422 (business rule, readable message).

## Decisions while building (differences from the design)

| Design said | Built | Why |
|---|---|---|
| pg-boss for jobs | Small built-in scheduler (`src/jobs`), each job slot claimed with a unique row so it runs once even with several servers | The jobs are a few fixed schedules; one less dependency. |
| SQL views for metrics | One metrics module with parameterised SQL | Same "one source of truth" rule; views can't take the period and scope as parameters. |
| `automation_rules` table | The three fixed rules are settings (`automation` group) | The design allows only on/off + delay for three fixed rules. |
| "Converted needs course and amount" | `required_fields` per status, empty by default; Admin picks them | No business rule hard-coded (project rules). |
| Follow-up done | Any call or status change completes the lead's follow-ups due within the next 2 hours | §8 rule 4 ("done only by logging what happened"), with a small grace window. |

## Tests

`npm test` = 36 unit tests (allocation maths, attendance rules, finance calculators, money rounding) + 47 API tests against the `test` database:
auth and lockout, every role's permissions, a 1,000-row upload with exact counts, 300 → 100/100/100 → 34/33/33, two simultaneous distributions (no lead twice),
max limits and over-max with reason, undo, status rules, calls, recycling, follow-ups, low leads and auto-refill, attendance and corrections,
dashboards vs a hand-calculated scenario, finance confirm / snapshot / cancel, exports in all formats.
