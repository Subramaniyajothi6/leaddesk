# LeadDesk

Lead management and automatic allocation for sales teams: **Admin → Team Lead → BDE**.
Leads are uploaded, split between teams, given to BDEs, called and followed up, and every number on the
dashboards comes from one metrics module. Includes attendance and a finance module.
One copy (one database) per company, and it works for any sales or marketing domain.

| Folder | What it is |
|---|---|
| [`backend/`](backend/README.md) | API: Node 22, TypeScript, Express 5, Prisma, PostgreSQL. Permissions checked on every request. 84 automated tests. |
| [`frontend/`](frontend/README.md) | Web app: React 18, TypeScript, Vite, Tailwind CSS, Recharts. Screens for every role. |
| [`docs/`](docs/SYSTEM-DESIGN.md) | System design (source of truth), open questions for the company, CRM research, wireframes. |

The design preview used for the team review lives in a separate repository: [leaddesk-demo](https://github.com/Subramaniyajothi6/leaddesk-demo).

## Run locally

```bash
# 1. API
cd backend
cp .env.example .env        # fill in your PostgreSQL URLs and two long random JWT secrets
npm install
npm run db:deploy           # create the tables
npm run db:seed -- --demo   # defaults, first Admin, and a demo company
npm run dev                 # http://localhost:4000/api

# 2. Web app (second terminal)
cd frontend
npm install
npm run dev                 # http://localhost:5173
```

Demo accounts (only with `--demo`): `DEMO-ADM`, `DEMO-TL1`, `DEMO-B01`, password `Demo@1234`.

## Principles

- Every tool and service is free and open source.
- No business rule is hard-coded: limits, weights, statuses, attendance rules, targets and shares are settings stored in the database.
- History is never overwritten: assignments, status changes, attendance corrections and finance only add rows; the audit log can't be edited.
- Money is stored in paise, percentages in basis points.
