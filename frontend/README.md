# LeadDesk frontend

React 18 + TypeScript + Vite + Tailwind CSS 4 + TanStack Query + Recharts. Talks only to the API in `../backend`.

Look (chosen in the design review): **Theme 11 "Hot Horizon"** (light, pink-red accent `#e11d48`, deep wine sidebar `#1f0a14`) + **Font 3 "Magazine"**
(Playfair Display for headlines and big numbers, DM Sans for everything else). Tokens live in `src/index.css` (`@theme`). The `demo/` folder is the design reference only; no code is shared.

## Run

```bash
# 1. backend (another terminal):  cd ../backend && npm run dev     → http://localhost:4000/api
# 2. frontend:
npm install
npm run dev        # http://localhost:5173  (the dev server forwards /api to :4000)
npm run build      # type-check + production build into dist/
```

In development the sign-in page offers buttons that fill the demo accounts (Admin `DEMO-ADM`, Team Lead `DEMO-TL1`, BDE `DEMO-B01`, password `Demo@1234`).
They are not in production builds.

## How it works

- **Sign-in:** the access token is kept in memory only. The refresh token is an httpOnly cookie, renewed silently. A temporary password forces the change-password screen first.
- **Permissions:** the menu differs per role, but every rule is enforced by the API. The screens never decide who may see what.
- **Live:** the notification bell listens to Server-Sent Events (`/api/events`) and refreshes the dashboards when something happens.
- **Pages** (every menu item of every role is built):

| Role | Screens |
|---|---|
| Everyone | Sign-in, Change password (forced on first sign-in), notification bell (live), Leads list and lead page (call flow, status, follow-ups, notes, WhatsApp, history), Follow-ups (tabs + week calendar), Attendance, Reports (+ Excel / CSV / PDF), Leaderboard |
| Admin | Dashboard, Upload (3 steps + error file), Allocation (preview, history, undo, move pools), Team pools, Teams & people (add, edit, reset password, deactivate / left, move team), Finance (overview, payments to confirm, transactions, calculators + history), Settings (every rule group, statuses + allowed changes, outcomes, sources, custom fields, scoring, templates, holidays, targets), Audit log, add a lead by hand, trash and restore, edit and delete a lead |
| Team Lead | Dashboard (Give 20), Team pool (Smart / Equal / Workload with preview, manual counts, Edit max, auto-refill, history), Payments (record for converted leads), attendance board, corrections and time off |
| BDE | Today (punch, next to call), My performance, own attendance with correction requests |

## Layout

```
src/lib/api.ts        fetch wrapper: token in memory, one silent refresh on 401, readable errors
src/lib/auth.tsx      session state, login / logout / change password
src/lib/format.ts     ₹, %, minutes, times (raw numbers come from the API; formatting only here)
src/components/       Shell (sidebar per role, top bar, mobile menu), Bell, ui (Card, Kpi, Badge…), charts, nav
src/pages/            one file per screen (Login, dashboards, Leads, LeadPage, Upload, Allocation, Distribute, Teams, Attendance, FollowUps, Reports, Leaderboard, Finance, Payments, Settings, Audit, Performance)
src/lib/hooks.ts      useAction (action + toast + refresh), download (exports with the access token)
src/components/       … Modal (native dialog), StatusBadge, FollowUpPicker (server quick picks skip holidays)
```
