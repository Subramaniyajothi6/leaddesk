# Open Questions for the Company

Until the company answers, the app follows **common industry practice** (what CRMs such as LeadSquared, TeleCRM, Kylas, Salesforce and HubSpot usually do). Each question shows what we use now, so building can continue.

When an answer arrives: fill in **Company answer**, change **Status** to `Confirmed` or `Changed`, and update [SYSTEM-DESIGN.md](SYSTEM-DESIGN.md) if the answer is different.

**Priority:** 🔴 changes the database or formulas, so it's best answered before that module is built. 🟢 is only a setting, so Admin can change it any time.

| Status | Meaning |
|---|---|
| `Assumed` | Using industry practice, not yet asked |
| `Asked` | Sent to the company, waiting |
| `Confirmed` | Company agreed with the assumption |
| `Changed` | Company wants something different (design updated) |

---

## A. Performance and conversion %

| # | Question | Using now (industry practice) | Priority | Design § | Status | Company answer |
|---|---|---|---|---|---|---|
| 1 | A lead was worked by BDE A, then reassigned and converted by BDE B. Who gets the credit? | The owner at the time of conversion (B) gets the conversion. The lead counts in both A's and B's lead totals, unless it was taken from A before A did anything. | 🔴 | 9.1 | Assumed | |
| 2 | Should Invalid, Duplicate and Do-Not-Call leads be left out of the conversion % denominator? | Yes, left out. | 🔴 | 9.1 | Assumed | |
| 3 | Monthly conversion %: (a) of leads given in the month, how many converted (even later), or (b) conversions in the month ÷ leads given in the month? | (a) cohort, switchable by Admin. | 🔴 | 9.3 | Assumed | |
| 4 | First targets for BDEs and teams (daily / weekly / monthly calls, conversions, conversion %)? | No targets until Admin enters them. | 🟢 | 9.5, 13 | Assumed | |

## B. Lead allocation

| # | Question | Using now (industry practice) | Priority | Design § | Status | Company answer |
|---|---|---|---|---|---|---|
| 5 | Default way of splitting leads among BDEs? | "Smart": score = 60 room left + 25 match + 15 performance, capped per BDE. Equal and Workload also available. | 🟢 | 5.4, 5.7 | Assumed | |
| 6 | Maximum open leads per BDE at one time? | 50. | 🟢 | 5.4 | Assumed | |
| 7 | Only give leads to BDEs who have punched in today? | Yes. | 🟢 | 5.4 | Assumed | |
| 8 | When a BDE runs out of leads: auto-refill from the team pool, or wait for the Team Lead? | Chosen per team. Off by default, so the Team Lead gets an alert. | 🟢 | 5.5, 5.7 | Assumed | |
| 9 | How many "Not Reachable" attempts before the lead goes back to the pool for another BDE? | 3 attempts spread over at least 24 h. After 2 recycles → Lost. | 🟢 | 7.3 | Assumed | |
| 32 | Should leads be matched to BDEs by language, city or product? (Not in the brief, added as an extra.) | Built, **off by default**. When on: "prefer match" (bonus), never blocks a lead. | 🟢 | 5.8 | Assumed | |
| 33 | Daily limit on new leads per BDE? | 40 per day, changeable by Admin (company, team or per BDE). | 🟢 | 5.7 | Assumed | |
| 34 | Should past performance affect how many leads a BDE gets? | Small bonus: 15% of the score. New BDEs get a neutral score. Admin can set it to 0. | 🟢 | 5.7 | Assumed | |
| 35 | Can a Team Lead manually go over a BDE's max? | Yes, with a warning and a typed reason, recorded in the audit log. Automatic never goes over. | 🟢 | 5.4 | Assumed | |

## C. People and teams

| # | Question | Using now (industry practice) | Priority | Design § | Status | Company answer |
|---|---|---|---|---|---|---|
| 10 | Can one Team Lead manage more than one team? | Yes. A team has one Team Lead at a time. | 🔴 | 2, 4.1 | Assumed | |
| 11 | Does the Team Lead also call leads and punch in? | No calling. Punch-in optional. | 🟢 | 2 | Assumed | |
| 12 | When a BDE leaves, do their unfinished leads return to the team pool automatically? | Yes, with full history kept. | 🟢 | 6 | Assumed | |
| 13 | When a BDE moves team, do unfinished leads stay with the old team or move with them? | Stay with the old team (Admin can choose at transfer). | 🟢 | 6 | Assumed | |

## D. Attendance

| # | Question | Using now (industry practice) | Priority | Design § | Status | Company answer |
|---|---|---|---|---|---|---|
| 14 | Shift times and grace minutes for late / early? | 09:30–18:30, 10 min grace. | 🟢 | 10.2 | Assumed | |
| 15 | Hours for a full day and a half day? | 8 h full, 4 h half. | 🟢 | 10.2 | Assumed | |
| 16 | Weekly off days and this year's holiday list? | Sunday off. No holidays until entered. | 🟢 | 10.2 | Assumed | |
| 17 | Forgot to punch out: how does the day count until corrected? | Half day, flagged "missing punch-out". | 🟢 | 10.3 | Assumed | |
| 18 | Who can correct attendance? | Admin, and the Team Lead for their own team. Every change recorded. | 🟢 | 10.5 | Assumed | |
| 19 | Allow punch-in only from the office network or location? | No restriction. | 🟢 | 10.1 | Assumed | |

## E. Leads and data

| # | Question | Using now (industry practice) | Priority | Design § | Status | Company answer |
|---|---|---|---|---|---|---|
| 20 | Can you share a sample upload file (dummy data) with the real columns? | Name, phone, email, source + custom fields mapped at upload. | 🔴 | 5.2 | Assumed | |
| 21 | Is the default status list OK? (New, Contacted, Interested, Follow-up Required, Not Reachable, Converted, Not Interested, Lost, Do Not Call, Invalid Number, Duplicate) | Yes. Admin can rename or add. | 🟢 | 7.1 | Assumed | |
| 22 | Mask phone numbers for BDEs (98XXXXX210), showing the full number only when they press Call / WhatsApp? | Yes, and BDEs cannot export lead data. | 🟢 | 12.3 | Assumed | |
| 23 | Can BDEs see the leaderboard of all BDEs? | Yes. | 🟢 | 15 | Assumed | |
| 24 | Duplicate rule: same phone only, or phone or email? | Same phone or same email. | 🟢 | 5.2 | Assumed | |

## F. Finance

| # | Question | Using now (industry practice) | Priority | Design § | Status | Company answer |
|---|---|---|---|---|---|---|
| 25 | Who can record a payment for a converted lead? | Admin and Team Leads can record it. It stays *Pending* until Admin confirms. | 🟢 | 11.3 | Assumed | |
| 26 | In the profit calculation, what is "investment": per payment/deal, or company spending for a period? | Period spending (e.g. monthly), recorded as investment entries. A calculation can also be done per deal by typing the numbers. | 🔴 | 11.1, 11.3 | Assumed | |
| 27 | Is the 30:70 split the same for all payments, or could it differ by team or product? | One company-wide %, changeable by Admin, saved on each payment when confirmed. | 🔴 | 11.3 | Assumed | |
| 28 | Are amounts entered with GST/tax, or as final numbers? | Final amounts as received. No tax handling. | 🔴 | 11 | Assumed | |
| 29 | Days after conversion before "payment not recorded" alert? | 7 days. | 🟢 | 11.3 | Assumed | |

## G. Deployment

| # | Question | Using now (industry practice) | Priority | Design § | Status | Company answer |
|---|---|---|---|---|---|---|
| 30 | Where will the real version run, and is there a domain name? | Free tiers for demo (Render + Neon). Daily use needs an always-on server, to be decided. | 🟢 | 1 | Assumed | |
| 31 | Company time zone and currency? | Asia/Kolkata, ₹ INR. | 🟢 | 13 | Assumed | |
