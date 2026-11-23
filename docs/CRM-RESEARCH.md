# CRM Research: What the Best Sales Platforms Do

Research date: 19 Nov 2026. Purpose: collect every feature and UX pattern from leading sales and telecalling CRMs that is relevant to our BDE Lead Management system, check it against our design, and decide what to adopt.

**How this was gathered**

| Platform | Method |
|---|---|
| Pipedrive | Walked through our own trial account (adz4needs) in Chrome: deals board, deal page, leads, activities, insights, tools menu, automatic assignment. Read-only. |
| HubSpot | **Not yet walked through in-account** (the Chrome extension disconnected). Public help docs and guides only. |
| Close, Attio, Apollo, Salesloft, Freshsales, Zoho CRM, LeadSquared, TeleCRM | Public product pages, help-centre docs and reviews. Vendor claims are marked as such. |

---

## 1. Findings by module

### 1.1 Lead allocation and routing (our §5)

| Platform | What it does | Compared with our design |
|---|---|---|
| **HubSpot** | Lead rotation in workflows with three modes: **Round robin**, **Balanced** (to whoever holds the fewest leads) and Random. Reps without a sales seat are skipped; one guide says if everyone is unavailable the lead stays **unassigned**. | Our Equal = round robin, Workload = Balanced. We are stronger: unplaceable leads stay in the pool *and* the Team Lead is alerted with the reason. |
| **Pipedrive** (seen in-account) | "Automatic assignment" rules on three triggers: **deal added, deal updated, lead added**. A separate **History** tab lists every automatic assignment. Rules are created with a 3-step wizard. | We have `allocation_runs` in the database but **no History screen** → add one. Triggers match our "upload / recycle / refill" triggers. |
| **Freshsales** | Auto-assignment inside **territories** (rules by country, industry, lifecycle stage), round robin among chosen users; works for contacts, accounts and deals. | Teams = territories. Our optional matching (§5.8) covers rule-based routing. |
| **LeadSquared** | "Distribution Engine" weighs **availability, workload, expertise and performance**; **quotas** cap leads per user; distribution can be **limited to users who are checked in**. | Same as our Smart score + max/daily limits + "punch-in required". This confirms our choices against a market leader for Indian telecalling. |
| **Zoho CRM** | Assignment rules route by criteria; **scoring decides quality, assignment decides who** (paired). | Matches our order: score orders the leads, allocation picks the BDE. |

### 1.2 BDE daily workspace and calling (our §8, BDE Today, power dialer)

| Platform | What it does | Idea for us |
|---|---|---|
| **HubSpot prospecting workspace** | One personalised daily view with tabs **Open, Target accounts, Recent activity, All**; AI-suggested next steps. | Add a **Recent activity** tab to BDE Today (leads touched in the last 48 h). |
| **HubSpot task queues** | Work tasks like a playlist: press start, the next record loads with its tool; **complete, skip or reschedule**; up to 20 queues per user. | Our power dialer has complete and skip → add **Reschedule** (pick a time, lead leaves today's queue). |
| **HubSpot call outcomes** | Up to **30 custom call outcomes**, separate from lead status; usable in workflows and reports. | Split **call outcome** (Answered, No answer, Busy, Switched off, Wrong number, Call back later) from **lead status**. Outcomes become an Admin setting. Better reports ("38% of calls not answered between 1–3 pm"). |
| **Close** | **Power dialer** through a Smart View without opening each lead; Smart View refreshes every ~5 min; prevents two reps calling the same lead; recommends excluding leads already dialed today. Predictive dialer calls several at once (paid). | We already prevent double-assignment. Add rule: power-dialer queue **excludes leads called today** unless a follow-up is due. |
| **Apollo** | Power dialing auto-moves to the next call; parallel dialing (3–5 at once) on a paid add-on. | Auto-next: done. Parallel: needs paid telephony, skip. |
| **Salesloft** | "Focus zones": a mode that shows only today's prioritised task queue, filterable by due date, task type and time zone; bulk reschedule. | Our focus mode matches. Add **bulk reschedule** for Team Leads (e.g. absent BDE's follow-ups). |
| **TeleCRM** | Auto-dialer gives agents **time to note feedback before the next call** and lets them **pause**. 1-click dialer, WhatsApp templates. | Add a **wrap-up timer** setting (e.g. 15 s before the next call) and a **Pause** button in the dialer. |
| **LeadSquared Smart Views** | Per-rep tabs: **daily follow-ups, open leads, overdue tasks**, priority-ordered. | Saved views per role (we have this on the Team Lead table; extend to BDE leads). |
| **Close Inbox** | A "command centre": new leads, follow-ups, missed communications and overdue tasks in one place. | Our BDE Today queue already does this; add **missed calls / callbacks** as a section once telephony exists. |

### 1.3 Lead record page (our lead detail sheet)

Seen in Pipedrive's deal page (in-account):

- **Stage progress bar** across the top with **"N days in current stage"**.
- Big **Won / Lost** buttons, owner, followers.
- One **composer** with tabs: Activity, Notes, Meeting, **Call, WhatsApp**, Email, Files, Documents, Invoice.
- **History** timeline with filters: All, Activities, Notes, WhatsApp, Emails, Files, Changelog.
- Pinned focus item (next activity) above the history.

Attio: record page = main column + side panel; table and board views open a **preview panel** without leaving the list; 30+ keyboard shortcuts (`?` shows them).

**Adopt:** "days in status" bar, Converted / Lost quick buttons, one composer (call, WhatsApp, note, follow-up), history filters, next follow-up pinned at the top.

### 1.4 Follow-ups and activities (our §8)

Pipedrive Activities (in-account): quick filters by **type** (Call, Meeting, Task, Deadline, Email) and **time** (To-do, Overdue, Today, Tomorrow, This week, Next week, custom period); **list or calendar** view; calendar sync (paid integrations).

Close: workflow **blackout dates** skip holidays for automated steps.

**Adopt:** the same type and time filters; a calendar view of follow-ups; follow-up quick picks skip holidays and week-offs from our attendance calendar.

### 1.5 Process control and data quality

| Platform | Feature | Our equivalent / action |
|---|---|---|
| Zoho **Blueprint** | Each stage requires certain **fields, actions or approvals** before a record can move on. | We have allowed transitions and required remarks/follow-ups. **Extend:** required fields per status (e.g. Converted requires course and expected amount). |
| Pipedrive | **Merge duplicates**, **Restore data** (undo deletes), Import / Export. | Duplicate merge is in our design; **add Restore** (soft delete with a 30-day trash). |
| Pipedrive | Onboarding **setup guide** (1/16 tasks) and "Remove sample data" button. | Add an **Admin setup checklist** (company settings, teams, BDEs, first upload, targets) and one-click sample data removal. |

### 1.6 Scoring and sequences

- **Lead scoring** (Zoho, LeadSquared, HubSpot): points for attributes and engagement; higher scores worked first. Already in our design (§15).
- **Sequences / cadences** (HubSpot, Close, Freshsales, Zoho): multi-step plans (Day 1 call, Day 2 WhatsApp, Day 4 call) that create tasks automatically and **stop when the lead replies or converts**. Not in our design yet. Can be built free as a task generator; WhatsApp and SMS sending stay manual (`wa.me` links) unless a paid API is added.

### 1.7 Performance and reporting (our §9, §14)

| Platform | Feature | Action |
|---|---|---|
| Close | **Activity comparison table** (calls, emails, opportunities per rep), **leaderboard**, call graph, **week-over-week** comparison; draggable columns. | Add week-over-week deltas to the Team Lead BDE table and reports. |
| Pipedrive Insights (in-account) | **Dashboards, Goals, Reports** (up to 250); AI "generate report". | Goals = our targets; consider a simple custom-report builder later. |
| TeleCRM | Live leaderboards, funnel analytics, call breakdowns. | Leaderboard and funnel are in our design. |
| LeadSquared | Call recordings tied to the lead; flag high/low-quality calls for training. | Needs paid telephony (future). |

### 1.8 Field and attendance

- **LeadSquared** mobile: check-in / check-out, automatic check-in by workday, route tracking if an agent forgets to check in, day plans, proximity-based assignment. Our attendance (punch in/out, optional location) covers office teams; field features are future.
- **TeleCRM**: no attendance feature found. Our built-in attendance is a differentiator.

### 1.9 Finance link (our §11)

Pipedrive deals carry **Products** and an **Invoice** tab; won deals can open a **Project** for after-sales work. **Adopt later:** link a product/course and amount to a converted lead, so "converted, payment not recorded" can show the expected amount.

---

## 2. Gap analysis: what to add to our design

**P1: adopt now** (free, high value, small to medium effort)

1. **Call outcome vs lead status split**, with Admin-configurable call outcomes (HubSpot).
2. **Allocation history page** listing every run and assignment with its reason (Pipedrive).
3. **Power dialer: Reschedule, Pause and wrap-up timer**, and exclude leads already called today (HubSpot, TeleCRM, Close).
4. **Lead page: "days in status" bar, Converted / Lost buttons, one composer, history filters** (Pipedrive).
5. **Required fields per status** (Zoho Blueprint), e.g. Converted needs course and amount.
6. **Follow-up filters by type and time, plus calendar view** (Pipedrive); quick picks skip holidays (Close).
7. **Week-over-week deltas** in team tables and reports (Close).
8. **Admin setup checklist** and sample data with one-click removal (Pipedrive).

**P2: later**

9. Sequences / cadences that create follow-up tasks automatically.
10. Bulk reschedule for Team Leads (Salesloft).
11. Restore (trash) for deleted leads (Pipedrive).
12. Simple custom report builder (Pipedrive Insights).
13. Product / course and expected amount on converted leads (Pipedrive).

**Skip for now (paid services)**

- Call recording and QA, predictive and parallel dialing, IVR (need a paid telephony provider).
- WhatsApp Business API drips, SMS sequences, email sync.
- AI note-takers and AI report generation.

---

## 3. Still to do

- Walk through **HubSpot in-account** (Start guide, contacts, deals, tasks, calling, sequences, reports) once the Chrome extension reconnects, and add findings here.
- Optionally sign up for free trials of Close and Attio to see them in-app.

## Sources

- HubSpot: [Manage leads (help)](https://knowledge.hubspot.com/records/manage-leads), [Lead management & prospecting](https://www.hubspot.com/products/sales/sales-leads), [Sales prospecting automation](https://blog.hubspot.com/sales/sales-prospecting-automation), [Lead rotation: round robin, balanced, random](https://www.sidekickstrategies.com/hubspot-updates/lead-workflow-rotation-distribution-user-availability-hubspot), [Custom call and meeting outcomes](https://knowledge.hubspot.com/calling/create-custom-call-and-meeting-outcomes?app=wp), [Task queue guide](https://insidea.com/blog/hubspot/kb/how-to-customize-and-optimize-the-hubspot-task-queue), [RevPartners automation guide 2026](https://blog.revpartners.io/en/revops-articles/hubspot-automation-guide-2026), [TripleDart prospecting guide](https://tripledart.com/revops/hubspot-prospecting)
- Close: [Using the Power Dialer](https://help.close.com/docs/using-the-power-dialer), [Calling Smart Views](https://help.close.com/docs/creating-smart-views-for-calling), [3 ways to call in Close](https://close.com/blog/3-ways-to-call-in-close), [Reporting](https://close.com/features/reporting), [Activity reports](https://close.com/blog/introducing-new-activity-reports), [2025 product roundup](https://www.close.com/blog/close-2025-product-roundup)
- Attio: [Create and view records](https://attio.com/help/reference/managing-your-data/records/create-and-view-records), [Kanban views](https://attio.com/help/reference/managing-your-data/views/create-and-manage-kanban-views.md), [Quick actions](https://attio.com/help/reference/tips-and-tricks/quick-actions)
- Apollo: [Power and parallel dialing](https://knowledge.apollo.io/hc/en-us/articles/45479798484621-Use-Power-and-Parallel-Dialing-on-Apollo)
- Salesloft: [Cadence Focus Zone](https://salesloft.com/salesloft-u/lesson/cadence-focus-zone/)
- Freshsales: [Territory auto-assignment](https://support.freshsales.io/support/solutions/articles/217811-how-are-leads-automatically-assigned-using-territories-), [Assign leads equally](https://support.freshsales.io/support/solutions/articles/50000002009-how-can-i-assign-leads-to-a-set-of-users-equally-), [Features](https://www.freshworks.com/freshsales-crm/features/)
- Zoho CRM: [Automate business processes](https://help.zoho.com/portal/en/kb/crm/automate-business-processes/overview/articles/get-started-automate-business-process), [Assignment rules](https://help.zoho.com/portal/en/kb/crm/automate-business-processes/assignment-rules/articles/set-assignment-rules), [Lead scoring](https://www.zoho.com/crm/lead-scoring.html)
- LeadSquared: [Lead distribution help](https://help.leadsquared.com/leadsquared-help-home/page/20/), [Call center CRM](https://www.leadsquared.com/call-center-sales-crm/), [Field management](https://www.leadsquared.com/field-management-software/)
- TeleCRM: [Telecalling software](https://telecrm.in/telecalling-software), [Call management](https://devweb.telecrm.in/features/call-management)
- Pipedrive: walked through in our own trial account (adz4needs.pipedrive.com).

---

## 4. Update 20 Nov 2026: second in-account pass

### Pipedrive (walked through in our trial account, read-only)

| Area | What we saw | Idea for us |
|---|---|---|
| Contacts | People / Organizations, a **Contacts timeline**, a suggested filter ("Total activities > 0") shown to new users, Import contacts. | Offer ready-made filters to new users, e.g. "never called" and "no activity in 7 days". |
| Merge duplicates | Separate page with **editable matching rules** (People, Organizations). | Duplicate rules become an Admin setting: match on phone, email or both. |
| Deals timeline | Deals grouped by **expected close month**, with a total for each month. | Finance: a "expected collections by month" view for converted leads. |
| Automations | Trigger → action. The six ready templates: follow-up when the stage changes; first activity for every new deal; update one field when another changes; **next activity when one is completed**; email on stage change; welcome email. Also offers delays and "wait for condition". | Build a small rule set: (1) a new lead gets a "first call" task, (2) a status change creates the next follow-up, (3) finishing a follow-up asks for the next one. No full workflow builder needed. |
| Phone calls | **No built-in calling.** Only a default "callto" handler (the phone's own dialer) plus paid marketplace apps (JustCall, CloudTalk). | Confirms our free approach: `tel:` links + manual call logging; paid telephony later. |
| Restore data | Restore **deleted items, bulk edits and bulk conversions** from the last 30 days, per type, showing who deleted and when. | Add to P1: soft delete + 30-day restore, and **undo for bulk actions** (bulk assign / bulk status change), logged in `audit_log`. |
| Sequences | In beta: timed follow-ups from templates. | Matches our P2 "sequences". |
| Projects | Post-sale board: Kick-off → Setup → Configuration → Testing → Go-Live → Support. | Out of scope; a converted lead could later hand over to an onboarding board. |
| Apps | WhatsApp, Slack, MS Teams, Mailchimp, DocuSign, Invoicing integrations. | Only `wa.me` links (free) for now. |

### HubSpot (signed in, Free tier, marketing-focused account)

- Sidebar: Contacts, Companies, Deals, Segments; Marketing (emails, forms, campaigns); Content (pages, blog); Platform (Dashboards, **Workflows, locked on Free**). A **Calls** button sits in the top bar.
- **Start guides** for each team (Marketing, Sales, Customer Service, Content, Revenue). Each shows a **% progress bar** and task cards with time estimates ("About 7 minutes").
- **Workflows, lead rotation, sequences and the prospecting workspace all need paid tiers** (Sales Hub Professional). This confirms that the automatic allocation we build for free is something HubSpot charges for.
- **Deals:** board view by default (list view available), saved views "All deals / My deals" + add your own, pipeline switcher, filter, sort, export. One default "Sales Pipeline" with **7 stages**; Admin can create more pipelines and choose how stage labels look (plain text, coloured dot, or coloured badge).
- **Deal settings:** editable properties, the fields on the "Create deal" form, a **default close date** (end of this month, or N days after creation), and collaborators on a deal.
- **Contacts:** built-in views **All / My / Unassigned contacts**. "Unassigned" is the same idea as our pool.
- **Tasks:** quick tabs **All / Due today / Overdue / Upcoming**, board or table view, filtered by "Assigned to" by default; offers to sync tasks to Google or Outlook calendar.
- **Calls:** a list of calls (tabs **Recorded calls / All calls**). Columns: title, activity date, **call direction**, **call outcome**, assigned to, **call duration**, call notes, linked contact/company. Calls can be imported.
- **Reports:** a ready "CRM Data Overview" dashboard with quick filters (owner, date range), **compare to last month**, and tiles: new contacts, contact sources, contacts over time, deals created over time, deals by stage, **activity type breakdown**, **team activity summary**.

**Adopt from HubSpot:**
- Our call log stores **direction, outcome, duration and notes** separately from lead status (same as P1 #1).
- Default lead views per role: **All / Mine / Unassigned**.
- BDE follow-up tabs: **Due today / Overdue / Upcoming**.
- A ready-made dashboard on day one with an owner/date filter and "compare to last month" on every tile.
- Status labels shown as coloured badges, with the colour chosen by Admin in settings.
- The Admin setup checklist (P1 #8) shows % progress and a time estimate on each task, like HubSpot's start guides.
