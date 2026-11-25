# LeadDesk: manual test plan

Work through one section at a time. Each test has **Steps** and **Expected**. Mark the box and write a note when something is different.

- `[x]` = passed
- `[!]` = failed (write what you saw)
- `[-]` = skipped

Sections are independent unless they say "needs section N first".

---

## 0. Before every session

**Start the app** (two terminals; on this laptop close other heavy apps first):

```bash
cd "D:/Adz4/New folder/backend"  && npm run dev     # API  → http://localhost:4000/api
cd "D:/Adz4/New folder/frontend" && npm run dev     # App  → http://localhost:5173
```

**Accounts** (password for all demo accounts: `Demo@1234`):

| Role | Login | Team |
|---|---|---|
| Admin (demo) | `DEMO-ADM` | — |
| Team Lead | `DEMO-TL1` (Rahul S) | Team A |
| Team Lead | `DEMO-TL2` (Divya M) | Team B |
| Team Lead | `DEMO-TL3` (Karthik N) | Team C |
| BDE | `DEMO-B01` (Priya K), `DEMO-B02` (Arun V), `DEMO-B03` (Meena R), `DEMO-B04` (Kavin T) | Team A |
| BDE | `DEMO-B05` (Deepa S) … `DEMO-B07` | Team B |
| BDE | `DEMO-B08` (Rohit M) … `DEMO-B10` | Team C |
| Your real Admin | `admin@leaddesk.local` | first sign-in asks for a new password |

**Tips**
- To be two people at once (e.g. Team Lead + BDE), use a normal window and a private/incognito window.
- The sign-in page has buttons that fill the demo accounts (development only).
- Tests change the data. That is fine, it is demo data. Write down names or numbers you create.
- Times follow India time. Some rules depend on the clock: shift 09:30–18:30, and **absent cut-off = 11:30**.
- **Sunday is a week-off**: BDEs can't get automatic leads on Sunday. Test allocation on a weekday, or remove Sunday in Settings → Attendance & holidays → Week-offs.
- **Automatic giving needs BDEs to punch in** (setting *Only BDEs who punched in get leads*). Either punch in as the BDE first, or switch that setting off in Settings → Allocation.

---

## W. Full workflow run (one lead from upload to payment)

Do it on a weekday, in order. Normal window = Admin, then Team Lead. Private window = BDE. File: `docs/test-data/workflow-leads.csv` (12 new leads, numbers 9500011001–012; for a second run change the last digits).

- [ ] **W1 BDEs punch in.** Private window: `DEMO-B01` → Today → Punch in; sign out, same for `DEMO-B02`; sign back in as `DEMO-B01`. Expected: "Punched in at hh:mm" (Late after 09:40).
- [ ] **W2 Upload.** Normal window: `DEMO-ADM` → Upload → the file → Skip duplicates → Add. Expected: "12 rows: 12 added, 0 duplicates, 0 rejected".
- [ ] **W3 To teams.** "Give these leads to teams" → Equal, all 3 teams → Preview 4/4/4 → Allocate. Expected: "12 leads given to 3 team(s)".
- [ ] **W4 To BDEs.** Sign out; `DEMO-TL1` → Team pool → Automatic → Smart. Expected: Priya and Arun get leads with a "Why"; Meena and Kavin are under Skipped (not punched in). Note: the pool also holds older demo leads, so more than our 4 may be given; that's fine. Give. Expected: toast; pool count drops; Priya's bell goes up without refresh.
- [ ] **W5 BDE sees them.** Private window, Priya → My leads → search `95000110`. Expected: our new leads that went to Priya, each with a first-call follow-up. (If none went to her, as `DEMO-TL1` use Leads → tick one → Assign to Priya.)
- [ ] **W6 Call, no answer.** Call on one new lead (e.g. Anand Raj) → End call → No answer → Save. Expected: still New; History "Call: No answer".
- [ ] **W7 Call, answered.** Call again → Answered → Contacted → remarks → follow-up Tomorrow 11:00 → Save. Expected: status Contacted; "Next follow-up" card on top.
- [ ] **W8 Follow-ups.** Priya → Follow-ups. Expected: Anand Raj under Upcoming tomorrow 11:00; Week view shows it.
- [ ] **W9 Move forward.** Lead page → Change status → Interested → Save; then → Converted (fill any required field). Expected: Converted; Priya can't change it any more ("Ask your Team Lead…").
- [ ] **W10 Team Lead sees it.** Normal window `DEMO-TL1` → Dashboard. Expected: Priya's calls today and conversions went up; "converted, no payment yet" may show.
- [ ] **W11 Payment.** TL → Payments (or the lead page) → Record payment 50,000 → Save. Expected: "waiting for Admin to confirm".
- [ ] **W12 Admin confirms.** `DEMO-ADM` → Finance → Payments to confirm → Confirm. Expected: "Confirmed · company share ₹15,000" (at 30%).
- [ ] **W13 Numbers match.** Admin Dashboard and Reports → Performance → Month. Expected: same conversions; Priya's row shows the conversion. Leaderboard → Month shows Priya.
- [ ] **W14 Audit trail.** Audit log. Expected: upload, allocation, assignment, phone reveals, status changes, payment record and confirm all listed.
- [ ] **W15 Punch out.** Priya → Today → Punch out. Expected: day status (under 4 h = Absent, 4–8 h = Half day).

## 1. Sign-in and passwords

- [x] **1.1 Sign in.** Steps: open http://localhost:5173, sign in as `DEMO-TL1`. Expected: lands on "Good morning/afternoon/evening, Rahul" (Team Lead dashboard).
- [x] **1.2 Employee code or email.** Steps: sign out (avatar top right → Sign out), sign in with `demo-tl1@demo.leaddesk.local`. Expected: works the same.
- [ ] **1.3 Wrong password.** Steps: sign in with a wrong password. Expected: red message "Wrong email / employee code or password".
- [ ] **1.4 Show / Hide.** Steps: type a password, click **Show**. Expected: the password becomes visible; **Hide** hides it.
- [ ] **1.5 Lockout after 5 wrong tries.** Use a throw-away user, not a demo one (create one in 4.2). Steps: 5 wrong passwords in a row, then the right one. Expected: "Too many wrong tries… Locked for 15 min"; the right password is refused until 15 min pass.
- [ ] **1.6 First sign-in forces a new password.** Steps: sign in with a new person's temporary password (from 4.2). Expected: "Choose your password" screen, nothing else opens. The rule checklist ticks green as you type (8+ characters, a letter, a number, both match). After saving you land on your home screen.
- [ ] **1.7 Change password later.** Steps: avatar → Change password. Expected: works; "Other devices will be signed out".
- [ ] **1.8 Session stays after refresh.** Steps: press F5 on any page. Expected: still signed in, same page.

## 2. Roles see only what they should

- [ ] **2.1 Menus.** Expected menus:
  - Admin: Dashboard, Leads, Upload, Allocation, Teams & people, Attendance, Follow-ups, Reports, Leaderboard, Finance, Settings, Audit log.
  - Team Lead: Dashboard, Team pool, Leads, Follow-ups, Attendance, Payments, Reports, Leaderboard.
  - BDE: Today, My leads, Follow-ups, Attendance, My performance, Leaderboard.
- [ ] **2.2 Typing a forbidden address.** Steps: as BDE, type `http://localhost:5173/settings`. Expected: sent back to Today.
- [ ] **2.3 BDE sees only own leads.** Steps: as `DEMO-B01`, open My leads. Expected: only Priya's leads; phone numbers masked like `98XXXXX096`.
- [ ] **2.4 Team Lead sees only own team.** Steps: as `DEMO-TL1`, open Leads. Expected: only Team A leads, full phone numbers. A Team B lead's address (`/leads/<id>`) shows "Lead not found".
- [ ] **2.5 Finance is Admin only.** Expected: Team Lead and BDE have no Finance menu; Team Lead has Payments only.

## 3. Admin dashboard (as `DEMO-ADM`)

- [ ] **3.1 Loads.** Expected, top to bottom:
  - "Set up your company" card (only while setup is unfinished)
  - "Waiting on you" (or "All clear")
  - 6 number cards
  - a line about the Cohort rule
  - "Where leads are lost", "Conversions per week", "Teams side by side", Team Leads, Conversion % by source, BDEs, Today so far
- [ ] **3.2 Period switch.** Steps: click Today / Week / Month. Expected: numbers and the sub-title change.
- [ ] **3.3 Team filter.** Steps: choose Team A. Expected: numbers for Team A only.
- [ ] **3.4 Action buttons go to the right screen.** Steps: click each button in "Waiting on you". Expected: it opens the screen that fixes it (Allocation, Teams & people, Finance, Attendance, Leads with the filter).
- [ ] **3.5 Setup checklist.** Steps: do the next unfinished item (e.g. set a target, 5.10). Expected: the item gets a tick; when all are done the card disappears.

## 4. Teams & people (Admin)

- [ ] **4.1 Create a team.** Steps: Teams tab → New team → "Team D" → Create. Expected: new card "Team D · 0 BDEs".
- [ ] **4.2 Add a person.** Steps: People tab → Add person → Name "Test BDE", Employee code "T-01", Email `t01@example.com`, Role BDE, Team D → Add. Expected: "Temporary password" box with a password shown once. Write it down (used in 1.5 and 1.6).
- [ ] **4.3 Duplicate email / code.** Steps: add another person with the same email. Expected: error "This email is already used".
- [ ] **4.4 Link a Team Lead.** Steps: Teams tab → Team D → Team Lead dropdown → pick a Team Lead. Expected: "Team Lead updated". Choosing "None" shows "Admin acts as Team Lead".
- [ ] **4.5 Edit a person.** Steps: People → Edit → change phone → Save. Expected: "Saved".
- [ ] **4.6 Reset password.** Steps: People → Reset password. Expected: a new temporary password is shown; that person must change it at next sign-in; their old session ends.
- [ ] **4.7 Move a BDE (leads stay).** Steps: People → Move on a Team A BDE with open leads → choose Team B → "Stay in the old team's pool" → Move. Expected: message "N open leads stayed in the old team pool"; the BDE is now under Team B; those leads show "Team A pool" in Leads.
- [ ] **4.8 Move a BDE (leads go with them).** Same as 4.7 with "Go with … to the new team". Expected: the leads now belong to Team B with the same BDE.
- [ ] **4.9 Deactivate (temporary).** Steps: People → Deactivate → Inactive → Confirm. Expected:
  - that person is signed out at once and can't sign in;
  - their leads stay theirs, and Admin dashboard shows "N lead(s) with nobody";
  - the dashboard button opens Leads filtered "BDE inactive".
- [ ] **4.10 Left the company.** Steps: People → Change → Left the company → Confirm. Expected: the person leaves the team, and their open leads go back to the team pool ("N leads back in the team pool").
- [ ] **4.11 Reactivate.** Steps: People → state filter "Inactive" → Change → Active. Expected: can sign in again.
- [ ] **4.12 Deactivate a team.** Steps: Team D (no BDEs left) → Deactivate. Expected: "Team deactivated · N leads back in the company pool". A team that still has BDEs is refused with a message.

## 5. Settings (Admin)

- [ ] **5.1 Save and Discard.** Steps: Company → change Company name. Expected: "Save changes" becomes active; **Discard** puts the old value back; Save shows "Company saved".
- [ ] **5.2 Every group saves.** Steps: change one value in each group (Allocation, Leads, Calls, Follow-ups & automation, Recycling, Attendance, Performance, Exports, Finance) and Save. Expected: "… saved" each time; the value is still there after F5.
- [ ] **5.3 Bad value is refused.** Steps: Attendance → Half day minimum bigger than Full day minimum → Save. Expected: error message, nothing saved.
- [ ] **5.4 Add a status.** Steps: Lead statuses → Add status → "Demo Booked", Type Open, Counts as contacted ✓, Needs a follow-up ✓, Default follow-up 24 h, colour → Save. Expected: it appears in the table.
- [ ] **5.5 Allowed next statuses.** Steps: edit "Interested" → tick "Demo Booked" under "From this status a lead can change to" → Save. Expected: on an Interested lead, Change status now offers Demo Booked (10.1).
- [ ] **5.6 Required fields.** Steps: Leads, fields & sources → Custom fields → add "Course" (text). Then edit status Converted → tick Course under "Fields that must be filled first" → Save. Expected: converting a lead now asks for Course (10.4).
- [ ] **5.7 Call outcome.** Steps: Calls & outcomes → add "Asked to email" (not connected, Attempt ✓). Expected: it appears in the call dialog's outcomes. **Turn off** hides it.
- [ ] **5.8 Lead source.** Steps: add "Facebook ads". Expected: offered in Upload, Add lead and Edit details.
- [ ] **5.9 Scoring rule.** Steps: add "Source equal to Referral +20". Expected: new Referral leads get score 20 more (check after an upload).
- [ ] **5.10 Target.** Steps: Performance & targets → Whole company, Conversions, Month, 50, today → Save target. Expected: the Admin dashboard Conversions card shows "Target 50 · x%" and a bar.
- [ ] **5.11 Holiday.** Steps: Attendance & holidays → add tomorrow as a holiday. Expected: follow-up quick pick "Tomorrow 11:00" skips to the next working day (13.6); attendance shows that day as Holiday.
- [ ] **5.12 WhatsApp template.** Steps: add a template "Fee details" with `Hi {{name}}, …`. Expected: offered in the lead's WhatsApp dialog (10.9).
- [ ] **5.13 Every change is audited.** Steps: open Audit log → What: Settings. Expected: each change above is listed with your name.

## 6. Upload (Admin)

Ready-made copy: `docs/test-data/test-leads.csv`. Or save this as `test-leads.csv` (Notepad → Save as → "All files"):

```csv
Name,Phone,Email,Source
Asha Menon,9123456700,asha.menon@example.com,Referral
Ravi Kiran,9123456701,,Website
Bad Number,12345,,Website
Duplicate Person,9840000000,,Website
Same In File,9123456700,,Website
,9123456702,,Website
```

- [x] **6.1 Read the file.** Steps: Upload → drop the file. Expected: step 2 "Match your columns" with Name, Phone, Email, Source already matched, and the first rows shown on the right.
- [x] **6.2 Add rows.** Steps: "When a lead already exists" = Skip → Add 6 rows. Expected: "6 rows: 2 added, 2 duplicates, 2 rejected": _23 Nov: got 1 added, 3 duplicates. Correct: Asha matched an older test lead (#301) by email; duplicate rule is phone OR email. Sample email changed to asha.menon@example.com._
  - added: Asha, Ravi
  - duplicates: Duplicate Person already exists; Same In File repeats Asha's number
  - rejected: bad phone, missing name
- [ ] **6.3 Error file.** Steps: Download errors / Download duplicates. Expected: CSV files with the row number and the problem, e.g. `Phone "12345" is not a valid number`, `Name is missing`.
- [ ] **6.4 Same file again.** Steps: upload the same file again. Expected: 0 added (all duplicates or errors).
- [ ] **6.5 Merge.** Steps: change Ravi's email in the file to `ravi@example.com`, upload with **Merge**. Expected: Ravi is not created twice; his lead now has that email and a note "Merged from upload …".
- [ ] **6.6 Not a CSV / Excel.** Steps: upload a .jpg renamed to .csv. Expected: refused with a message.
- [ ] **6.7 Excel file.** Steps: save the CSV as .xlsx in Excel and upload. Expected: works the same.
- [x] **6.8 Go to allocation.** Steps: after 6.2 click "Give these leads to teams". Expected: Allocation opens with that upload preselected.

## 7. Allocation: company pool → teams (Admin)

- [ ] **7.1 Preview updates.** Steps: Allocation → change "How many", method, teams. Expected: the Preview table updates and "Nothing is saved until you confirm".
- [ ] **7.2 Equal with rotating extra.** Steps: 4 leads to 3 teams, Equal, allocate; then again with 4 more. Expected: e.g. 2/1/1 then 1/2/1 (the extra moves on).
- [ ] **7.3 By free capacity.** Expected: teams with more room under their BDEs' max get more.
- [ ] **7.4 Manual.** Steps: Manual, type numbers per team (total more than available). Expected: error "You typed N leads but only M match the filters".
- [x] **7.5 Allocate.** Expected: "N leads given to K team(s)"; team pools go up (Teams tab, or the Team pool page).
- [ ] **7.6 Also give to BDEs now.** Steps: tick it, allocate (on a weekday with BDEs punched in, or the punch-in setting off). Expected: the message also says how many were passed on to BDEs.
- [ ] **7.7 Move between team pools.** Steps: "Move leads between team pools…" → from A to B, 5. Expected: "5 leads moved".
- [ ] **7.8 History.** Steps: History and undo tab. Expected: every run listed; click a run to see who got which lead and why.
- [ ] **7.9 Undo.** Steps: Undo on the last run. Expected: "N leads put back"; leads that were moved again since are skipped and counted.

## 8. Team pool → BDEs (as `DEMO-TL1`)

Before: punch in as 2–3 Team A BDEs (14.1), or switch off "Only BDEs who punched in get leads".

- [ ] **8.1 Preview with reasons.** Steps: Team pool → Automatic → Smart. Expected:
  - the table "who gets how many" with "Why" (start load, score, performance);
  - BDEs who can't get leads under **Skipped** with the reason (not punched in, on leave, week-off).
- [ ] **8.2 Methods.** Steps: switch Smart / Equal / Workload. Expected: the split changes (Equal ≈ same each; Workload fills the emptiest first).
- [ ] **8.3 Give.** Steps: "Give N leads". Expected:
  - toast;
  - pool count drops;
  - each BDE gets a bell notification "N new leads for you";
  - a first-call follow-up is booked on each lead.
- [ ] **8.4 Never over a max (automatic).** Steps: "Edit max" a BDE down to their current open count, then preview. Expected: that BDE gets 0; leftovers explained.
- [ ] **8.5 Manual counts.** Steps: Manual tab → type 2 for one BDE → Give 2 leads. Expected: "Arun V +2" (or the name you chose).
- [ ] **8.6 Over the max needs a reason.** Steps: Manual → give more than "left". Expected: yellow message "X will be at 55 / 50. Type a reason…"; it works only after typing a reason; the reason appears in the Audit log ("assigned leads over a BDE's max").
- [ ] **8.7 Edit max.** Steps: Edit max → 40 / 30 → Save. Expected: "Limits saved"; Open / max column shows 40.
- [ ] **8.8 Auto-refill.** Steps: tick Auto-refill. Then as Admin: Settings → Allocation → "Needs leads when fresh leads reach" = 50. Then as a BDE, change any lead's status. Expected: within a minute the BDE gets new leads automatically (History shows an "auto refill" run). Set the value back to 0 after.

## 9. Leads list

- [ ] **9.1 Views.** Steps: All / Mine / Unassigned (TL, Admin). Expected: the list changes.
- [ ] **9.2 Search by last 4 digits.** Steps: type the last 4 digits of a phone. Expected: that lead. Name and email search work too.
- [ ] **9.3 Filters.** Steps: click status chips, "Overdue follow-ups", "Fresh (not called)", team, sort. Expected: list and count change; the address bar keeps the filters (F5 keeps them).
- [ ] **9.4 Save a view.** Steps: set filters → Save this view → name → Save. Expected: a new chip with that name.
- [ ] **9.5 Select and assign (TL / Admin).** Steps: tick 3 leads → Assign to a BDE → pick → Assign. Expected: "3 lead(s) assigned · load now x/y". The old owner gets a notification.
- [ ] **9.6 Return to team pool.** Steps: tick leads → Return to team pool. Expected: owner becomes "Team A pool".
- [ ] **9.7 Add a lead by hand (Admin).** First, Settings → Leads → Custom fields: add "City" (text, required) and "Course" (list: MBA, BBA). Steps: Leads → Add a lead (or Upload → Add a lead). Expected:
  - Name, Phone, City are marked `*`; Email, Source, Course say "(optional)"; the Add buttons stay disabled until the `*` fields are filled.
  - **Add a lead** → the lead page opens, "Company pool", City and Course in Details.
  - **Add & add another** → toast "… added. Next one.", the form clears (Source is kept), "1 added so far" shows.
  - Same phone again → red message in the form "This lead already exists · Open the existing lead" (the link opens it).
  - Phone `123` → "Phone "123" is not a valid number" in the form.
  - BDE and Team Lead have no Add a lead button.
- [ ] **9.8 Trash and restore (Admin).** Steps: on a lead page Details → Delete → OK. Then Leads → Trash → Restore. Expected: deleted lead disappears, then comes back.
- [ ] **9.9 Phone layout.** Steps: make the window narrow (or browser dev tools → phone). Expected: cards instead of a table; status chips scroll sideways.

## 10. Lead page

- [ ] **10.1 Only allowed changes.** Steps: on a New lead, Change status. Expected: only Contacted, Not Reachable, Invalid Number, Do Not Call are offered.
- [ ] **10.2 Days in status.** Expected: header shows "Since today" or "N days in this status".
- [ ] **10.3 Status that needs a follow-up.** Steps: Contacted → Interested without a date. Expected: the next step is booked automatically ("booked automatically"). With Settings → Follow-ups & automation → "Next step" off, it asks for a date instead.
- [ ] **10.4 Required fields.** Needs 5.6. Steps: Interested → Converted. Expected: a "Course" box appears; Save is blocked until it's filled.
- [ ] **10.5 Final status and reopen.** Steps: as BDE, open a Converted lead. Expected: "Ask your Team Lead if it needs to be reopened". As Team Lead: "Reopen…" needs a reason; it is in the history as "(reopened)" and in the Audit log.
- [ ] **10.6 Follow-up.** Steps: Follow-up → Tomorrow 11:00 → Book. Expected: pinned "Next follow-up" card on top. **Move** changes the time; **Cancel** needs a reason.
- [ ] **10.7 Note.** Steps: Note → text → Add. Expected: appears in History under Notes.
- [ ] **10.8 History filters.** Steps: All / Calls / Status / Notes / Follow-ups / Assignments / Payments. Expected: each shows only that kind, newest first.
- [ ] **10.9 WhatsApp.** Steps: WhatsApp → pick a template → Open WhatsApp. Expected: a new tab `wa.me/91…?text=Hello <first name>…`; logged in History; phone reveal logged in the Audit log.
- [ ] **10.10 Edit details.** Steps: Details → Edit → change email and a custom field → Save. Expected: "Details saved". As Admin you can change the phone; a phone that another lead has is refused.
- [ ] **10.11 Two people editing at once.** Steps: open the same lead in two windows (TL + BDE). Change status in one, then try in the other. Expected: the second is refused: "This lead was changed by … Reload and try again."
- [ ] **10.12 Record payment.** Steps: as TL or Admin on a Converted lead → Record payment. Expected: saved as pending (see 19).

## 11. Calling (as a BDE)

- [ ] **11.1 Start a call.** Steps: lead page → Call. Expected: the full number appears (only now) with a running timer. On a phone the dialer opens. The reveal is in the Audit log.
- [ ] **11.2 Not connected keeps the status.** Steps: End call → No answer → Save. Expected: status unchanged; "Call attempts" +1 in Details; History "Call: No answer".
- [ ] **11.3 Answered changes the status.** Steps: Call → End call → Answered → New status Contacted → remarks → Save. Expected: status Contacted; History shows the call and the change.
- [ ] **11.4 Call back later needs a time.** Steps: outcome "Call back later" without a time. Expected: Save stays disabled until a follow-up time is picked.
- [ ] **11.5 Save & next.** Steps: Save & next lead. Expected: the next lead in your queue opens with its call dialog already started. After the last one: "That was the last lead in your queue".
- [ ] **11.6 Keep it moving.** Steps: on a lead whose follow-up is due now, log an answered call without booking the next follow-up. Expected: "Book the next follow-up, or give a reason to skip it".
- [ ] **11.7 Recycling.** Steps: Admin → Settings → Recycling → "Spread over at least" = 0. BDE: 3× "No answer" on one lead. Expected: on the 3rd the lead leaves the BDE, goes back to the team pool as New, and is never given to the same BDE again. The Team Lead gets "… was recycled". Put the setting back to 24 after.

## 12. BDE Today

- [ ] **12.1 Punch in.** Steps: Punch in. Expected: "Punched in at hh:mm" (late after 09:40 shows Late); the button becomes Punch out.
- [ ] **12.2 Next to call order.** Expected: overdue follow-ups first, then due today, then fresh leads by score; badges say why.
- [ ] **12.3 Call buttons.** Steps: Call on a row. Expected: the lead opens with the call started.
- [ ] **12.4 No leads message.** Steps: a BDE with 0 fresh leads. Expected: "No new leads. Your Team Lead has been told."; the Team Lead gets a "needs leads" notification (once a day).

## 13. Follow-ups page

- [ ] **13.1 Tabs.** Expected: Overdue / Due today / Upcoming / All with counts (BDE).
- [ ] **13.2 Type and owner filters.** Expected: list filters (owner filter for TL and Admin).
- [ ] **13.3 Week view.** Steps: Week → Previous / This week / Next. Expected: 7 columns, today highlighted, overdue in red.
- [ ] **13.4 Move / Cancel.** Expected: like 10.6.
- [ ] **13.5 Call from the list (BDE).** Expected: opens the lead with the call started.
- [ ] **13.6 Quick picks skip holidays.** Needs 5.11. Expected: "Tomorrow 11:00" shows the next working day.

## 14. Attendance

BDE:
- [ ] **14.1 Punch in / out.** Expected: second punch-in refused "Already punched in at …"; punch-out shows the day status (under 4 h = Absent, 4–8 h = Half day, 8 h+ = Present).
- [ ] **14.2 Month calendar.** Expected:
  - colours for Present / Half day / Absent / Week-off / Holiday / Leave;
  - a dot for late and for missing punch-out;
  - numbers at the top including Attendance %.
- [ ] **14.3 Ask for a correction.** Steps: click a past day → times + reason → Send request. Expected: "Request sent"; listed as pending; the Team Lead gets a notification.

Team Lead / Admin:
- [ ] **14.4 Today board.** Expected: In / Out / Not in yet / Absent (after 11:30) / Leave, with times.
- [ ] **14.5 Approve / Reject.** Steps: Corrections tab → Approve. Expected: the day is recalculated (e.g. Present); the BDE is notified; you can't approve your own request.
- [ ] **14.6 Month report and direct correction.** Steps: Month tab → click a name → click a day → enter times + reason. Expected: corrected; Audit log shows before and after.
- [ ] **14.7 Time off.** Steps: Time off → BDE, today → Save. Expected: that day shows Leave (never Absent), and Team pool → Manual shows "On leave".
- [ ] **14.8 Missing punch-out.** Steps: punch in, never punch out. Expected: next day that date shows Half day with the missing punch-out dot.

## 15. Team Lead dashboard

- [ ] **15.1 Needs you now.** Expected: "X needs leads" with **Give 20** (works, toast), absent BDEs with due follow-ups (only after 11:30), inactive BDEs with leads, overdue follow-ups, unpaid converted leads, corrections.
- [ ] **15.2 Before the cut-off.** Steps: open it before 11:30. Expected: nobody is called "not in today"; status shows "Not in yet".
- [ ] **15.3 Week-off / holiday.** Expected: everyone "Day off"; Today card says "Week-off: nobody is expected in".
- [ ] **15.4 BDE table.** Expected: load bar, fresh, calls today · connected %, follow-ups, speed to first call, conversions, Conv. % with ▲/▼ against the team; team totals row.
- [ ] **15.5 Several teams.** Steps: link a Team Lead to 2 teams (4.4). Expected: a team selector appears on their dashboard and Team pool.

## 16. Notifications

- [ ] **16.1 Live bell.** Steps: BDE window open; in the TL window give that BDE leads. Expected: the BDE's bell count goes up without refreshing.
- [ ] **16.2 Open and mark read.** Expected: clicking a notification opens its screen; "Mark all read" clears the count.
- [ ] **16.3 Follow-up reminder.** Steps: book a follow-up 10 minutes ahead. Expected: within ~15 min before the due time the bell shows "Call <name>…".

## 17. Reports and exports

- [ ] **17.1 Each report opens.** Admin: Performance, Allocation, Status and funnel, Follow-ups, Attendance, Sources and uploads, Lead history (enter a lead number), Finance.
- [ ] **17.2 Same numbers as the dashboard.** Steps: Performance → Month. Expected: total conversions and counted leads equal the Admin dashboard's.
- [ ] **17.3 Downloads.** Steps: Excel, CSV, PDF. Expected: files open. The footer lists filters, the period rule and "Generated <date time> (Asia/Kolkata) by <you>". Each export is in the Audit log.
- [ ] **17.4 BDE limits.** Expected: BDE sees only Performance, Follow-ups, Attendance (own data). Lead history and Finance are not offered.
- [ ] **17.5 Team Lead limits.** Expected: only own team's data.

## 18. Leaderboard and My performance

- [ ] **18.1 Leaderboard.** Steps: switch Conversions / Conv. % / Calls and Today / Week / Month. Expected: ranking changes; top 3 as cards; your row highlighted "(you)".
- [ ] **18.2 Visibility setting.** Steps: Settings → Performance → untick BDE. Expected: a BDE opening Leaderboard sees "The leaderboard is not shown to your role".
- [ ] **18.3 My performance (BDE).** Expected: conversions vs target, Conv. %, contact rate, follow-ups on time, team rank, attendance this month, leads by status.

## 19. Finance

- [ ] **19.1 Record a payment (Team Lead).** Steps: Payments → "Record payment" on a converted lead (or from the lead page) → amount 50,000, method, date → Save. Expected: "waiting for Admin to confirm"; listed under "Payments I recorded" as pending; Admin gets a notification.
- [ ] **19.2 Only converted leads.** Expected: a non-converted lead can't get a payment (the button is not offered; the API refuses).
- [ ] **19.3 Confirm (Admin).** Steps: Finance → Payments to confirm → Confirm. Expected: "Confirmed · company share ₹15,000" (at 30%). Transactions show Company % 30, share ₹15,000, remaining ₹35,000.
- [ ] **19.4 Changing the % doesn't change old payments.** Steps: Settings → Finance → Company share 40 → Save. Expected: the confirmed payment still shows 30% / ₹15,000; the next confirmed one uses 40%.
- [ ] **19.5 Cancel.** Steps: Transactions → Cancel → reason. Expected: state Cancelled with the reason; totals drop; nothing is deleted.
- [ ] **19.6 Investment.** Steps: "Record money in / out" → Investment ₹20,000 → Save → confirm it. Expected: Overview: Investment ₹20,000, Profit = revenue − investment.
- [ ] **19.7 Calculators** (Calculators & history), each one saved to History:

| Calculator | Enter | Expected |
|---|---|---|
| Revenue share | Revenue 50000, % 30 | ₹15,000 company, ₹35,000 remaining |
| Profit share | Investment 20000, Revenue 50000, % 30 | profit ₹30,000 → ₹9,000 / ₹21,000 |
| Profit share (loss) | Investment 54000, Revenue 50000 | "Loss of ₹4,000.00, no profit to share" |
| Percent of | 2500, 18 | ₹450 |
| Discount | 10000, 15 | ₹1,500 off, final ₹8,500 |
| Increase / decrease | 40000, 12, Increase | ₹44,800 |
| Growth | 80000 → 100000 | +25.00% |
| Growth from zero | 0 → 5000 | "n/a (no previous value)" |

- [ ] **19.8 Unpaid list.** Steps: a lead converted more than 7 days ago with no payment (or set "Flag converted leads unpaid after" to 1). Expected: shows in Payments (TL) and in the Admin dashboard "converted, no payment yet".

## 20. Audit log (Admin)

- [ ] **20.1 Readable entries.** Expected: sentences like "Priya K signed in", "Demo Admin deleted <lead>", 12 per page.
- [ ] **20.2 Filter.** Steps: What = Sign-ins, Leads, Allocation…; From / To dates. Expected: only those entries; Clear resets.
- [ ] **20.3 Details.** Expected: "From: this computer (local)" (or an IP on a server), exact time, before / after values.
- [ ] **20.4 Everything is there.** Expected: entries for what you did in the other sections: sign-ins, failed sign-ins, settings, uploads, allocations, over-max reasons, phone reveals, exports, payments, attendance corrections.

## 21. Phone and small screens

- [ ] **21.1 Menu.** Steps: narrow window or phone view. Expected: the sidebar becomes a ☰ menu.
- [ ] **21.2 BDE on a phone.** Steps: Today, a lead, Call, Save & next. Expected: everything reachable without sideways scrolling; dialogs open from the bottom.
- [ ] **21.3 Wide tables.** Expected: tables scroll sideways inside their card; the page itself doesn't.

---

## Found a problem? Write it like this

| # | Section / test | What I did | What I expected | What I saw | Screenshot |
|---|---|---|---|---|---|
| 1 | 8.6 | Gave Arun 10 over his max | Asked for a reason | Gave without asking | yes |
