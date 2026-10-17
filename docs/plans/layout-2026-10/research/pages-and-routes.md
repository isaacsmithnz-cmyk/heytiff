# Every page HeyTiff renders, against the plan

Paths are under src/app unless they start with src/ or lib/. Stylesheets: tokens.css + globals.css (Tailwind) reach everything via layout.tsx:4-5; shell.css via dashboard/layout.tsx:10 and welcome/details/page.tsx:14; studio.css via components/studio/studio.tsx:1, live/[token]/page.tsx:4, live/[token]/not-found.tsx:1, live/[token]/live-viewer.tsx, print/design/page.tsx:2; hq.css via hq/layout.tsx:3. Status: covered = a board or Address names it; partial = plan names its contents, no board; missing = never mentioned; deleted = plan removes it (what takes over).

## Auth and onboarding (outside the shell)

| URL | What it does | Audience | Stylesheets | Overlays | Plan says | Status |
|---|---|---|---|---|---|---|
| / | page.tsx:25-58 signed-out front door: Create account, Sign in, Staff HQ; Chevron gradient teal→blue (:29), Wordmark, teal hover (:43,:54) | auth | tokens, globals | none | build-plan Addresses and V3-home give "/" to Home; the door is never named | missing; "/" double-booked |
| /auth/login, /auth/logout, /auth/callback + Auth0 Universal Login | Auth0 SDK routes, not in src/app (src/proxy.ts:111-119); widget dressed by lib/brand/auth0/theme.ts (lockup :112, teal focus/hover :84-85, #F0F2F5 ground :128), page-template.ts (teal glow :17-18,:70), palette.ts (teal :28, MARK_GRADIENT :91) | auth | Auth0 theme | — | never | missing |
| /start | start/page.tsx:28-91 signed in, no workspace: accept the waiting invite or create a company (components/start/start-screen.tsx, Tailwind zinc, no mark) | auth | tokens, globals | none | flows A14 first press "Create a company"; no board | partial |
| /welcome | welcome/page.tsx:39-78 owner's first-run company setup (components/org/company-setup.tsx; gradient Chevron :156) | auth | tokens, globals | AddressField listbox | main-tab What gets deleted "first-run company and staff forms → Settings and Your card forms"; A14 keeps Continue/Finish; no board | deleted (Settings › Business form; where the first run shows is unsaid) |
| /welcome/details | welcome/details/page.tsx:14,29-62 new staff first run (components/onboarding/staff-onboarding.tsx; gradient Chevron :229); loads all of shell.css for one address box | auth | tokens, globals, shell | AddressField | same row; today-every-feature "Loads the whole 12,700-line stylesheet" | deleted (Your card form; first run unsaid) |
| /invite/accept?token= | invite/accept/route.ts:239-354 GET renders nothing: to Auth0 signup / password ticket, /invite/error or /dashboard | auth | — | — | T1 covers sending, not accepting | missing |
| /invite/error?reason=&token= | invite/error/page.tsx:14-56 why a link can't be accepted (components/start/invite-problem.tsx) | auth | tokens, globals | none | never | missing |
| /link-account?state= | link-account/route.ts:40-60 Auth0 linking turnaround; 400 plain text if opened by hand (:49-52) | auth | — | — | never | missing (only the 400 text is seen) |
| /opengraph-image | opengraph-image.tsx:16-22 → lib/og/card.tsx BrandCard: ink chevron, "Tiff" teal (:19,:39) | public preview | Satori | — | rule 9 "teal leaves the app"; picture never named | missing |
| /icon, /apple-icon, public/brand/favicon.png, heytiff-chevron.png/.svg, heytiff-lockup.png | icon.png 192² and apple-icon.png 512²: gradient chevron on ink tile; lockup: gradient chevron + teal "Tiff"; the brand set feeds Auth0 and every email (lib/brand/auth0/assets.ts:34-40) | public | — | — | never | missing |

## Signed-in staff (dashboard shell)

| URL | What it does | Audience | Stylesheets | Overlays | Plan says | Status |
|---|---|---|---|---|---|---|
| /dashboard/* frame | dashboard/layout.tsx:34-82: sidebar 11 rows with gradient Chevron (components/shell/sidebar.tsx:52), topbar clock + Bell dialog (bell.tsx:365) + Tiff button → Tiff modal + your-name menu Profile/Sign out (topbar.tsx:105-131), ⌘K palette (command-palette.tsx:409), record host: job card / visit sheet / agreement sheet over any screen + Set-aside dock (components/records/record-host.tsx, record-dock.tsx), toasts; dashboard/loading.tsx → PageSkeleton | staff | shell | as listed | Phase 2 frame, tabs replace dock, mark b/w; S-you, S-search, S-dialog, V3-states | covered |
| /dashboard (?task) | dashboard/page.tsx:51-60 Home desk: Diary/Urgent/Needs attention/Noticeboard/Tasks faces + Calendar (components/dashboard/home-desk.tsx:145,465), day band, Tiff box | staff | shell | home-job-sheet, home-confirm, Tiff modal, calendar edit | V3-home "Home /"; H1–H6, S2–S3 | covered (address /dashboard → /) |
| /dashboard/action-required | action-required/page.tsx:7-10 chips board | staff | shell | none | main-tab "The bell, Home's Tasks tab, Action required → To do" | deleted (To do on Home) |
| /dashboard/notices | notices/page.tsx:10-22 noticeboard: post/poll/event, comment, vote (notices-board.tsx; post dialog :294) | staff | shell | post-a-notice dialog | main-tab "Noticeboard page → Team › Notices"; H7; no Team › Notices board | deleted (Team › Notices; not drawn) |
| /dashboard/workboard (?job ?face ?q ?visit) | workboard/page.tsx:12-64 All jobs (6 tabs), Projects (4), Maintenance (5), Capacity, Gallery, Display mode, work+photo search | workboard | shell (+swms.css via job faces) | job-sheet faces Summary/Timeline/Billing/Photos/Files/Compliance (job-sheet.tsx:1445-1450) + Quote, Installation; visit-sheet, agreement-sheet, project-sheet, project-trip-sheet, day-modal, project-day-modal, new-job-modal, new-agreement-modal, job-claim-modal, job-customer-dialog, job-media-viewer, swms-wizard, cert-wizard, wb-modal, inspector, gallery filter menu | V3-jobs /jobs, JC-1 /jobs/3342, V3-schedule, S-project; J2 "a job is a page with its own address"; S1–S5 | deleted (Jobs, job page, Schedule; Gallery J23 "Jobs, Starred photos" and S5 "Schedule, Display" named, not drawn) |
| /dashboard/workboard/projects | projects/page.tsx:11-24 project list | workboard | shell | wb-modal new project | main-tab "project record: page, card, list page, board, calendar, trip sheet → job page as a Project job"; P1 | deleted (Jobs › Projects view) |
| /dashboard/workboard/projects/[id] | projects/[id]/page.tsx:21-59 stage, trips, checklist, money, equipment, linked jobs, design link | workboard | shell | project-trip-sheet, wb-modal (claim, variation, equipment, attach job, link design), toasts | S-project /jobs/3302; P2–P9 | deleted (Project job page) |
| /dashboard/workboard/quotes/[id] | quotes/[id]/page.tsx:21-42 quote builder full screen | workboard; money by grant | shell | proposal preview portal (quote-screen.tsx:242), job-media-viewer, toasts, Tiff questions | S-quote /jobs/3361/quote; J17–J20, J25 | covered |
| /dashboard/toolbox | toolbox/page.tsx:8-12 index of the four tools | toolbox | shell, toolbox.css (733) | none | decision 1 Library with tools as one shelf; L4; S-library | covered (as a shelf) |
| /dashboard/toolbox/{heat-load, running-pressures, troubleshooting, outdoor-unit} | four ToolPages with hard-coded accents: #00E5C0 (heat-load/page.tsx:12), #FF3366 (running-pressures:12, troubleshooting:32), #8A2BE2 (outdoor-unit:14) | toolbox | shell, toolbox.css | fault finder's Library offer | L4 "Library, The tool"; no tool drawn | partial |
| /dashboard/studio (?design) | studio/page.tsx:42-103 Design studio; own dark studio/loading.tsx (StudioHold) | studio | shell, studio.css (10,512) | library-modal, room-modal, summary-modal, send-viewer, sim-overlay, reference-viewer, unit-browser, plans-panel, variation-menu | S-design /design; L5–L7; insides out of scope | covered (note: studio.css also dresses /live, /print/design) |
| /dashboard/tiff | tiff/page.tsx:23-53 the Library's ask page (components/tiff/assistant.tsx, 1,985 lines) | tiff | shell | voice recorder | main-tab "Library's own ask page and engine → The box" (3,400 lines); decision 3; H5 | deleted (box on Home + Search's Ask Tiff) |
| /dashboard/tiff/library (?cat ?tag ?doc) | library/page.tsx:38-117 All documents | tiff; manage by grant | shell | upload-drawer, tag-picker, Manage tags (tag-manager.tsx:81), Edit/Remove document (library.tsx:923,1021), doc-search dialog | S-library /library; L1–L3, A13 | covered |
| /dashboard/my-timesheet (?period) | (me)/my-timesheet/page.tsx:10-17 MeScreen timesheet face; day editor portal my-timesheet.tsx:412 with TimeWheel | everyone | shell | day editor, normal week, can't-work | S-timesheet /you/timesheet, S-phone-timesheet; E1–E3 | covered |
| /dashboard/my-leave | (me)/my-leave/page.tsx:6-8 | everyone | shell | request form, cancel | S-you lists Leave; E4; no board | partial |
| /dashboard/my-expenses | (me)/my-expenses/page.tsx:14-16 | everyone | shell | scan a receipt, job-picker, company card | S-you; E5, Y3; no board | partial |
| /dashboard/my-vehicle | (me)/my-vehicle/page.tsx:6-8 | everyone | shell | fleet modals fuel/issue/odometer (fleet/modals.tsx:70) | build-plan Still open "your vehicle on your card"; E6 | deleted (Your card; not drawn) |
| /dashboard/my-notes | (me)/my-notes/page.tsx:9-11 private notes | everyone | shell | none | Y1 "Conversations, Only me"; S-convos | deleted (Conversations › Only me; "Only me" not drawn) |
| /dashboard/profile (?sec) | profile/page.tsx:51-172 your card: personal, licences, work rights, signature, pay, vehicle, sign-in email, photo | everyone | shell (+swms.css via signature-card) | licence-modal, work-rights-modal, signin-email-modal, signature pad, photo | build-plan "your card (normal week, pay and vehicle)"; E7–E11, Y2; no board | partial |
| /dashboard/timepay (?period) | timepay/page.tsx:15-27 Time & Pay, Timesheets face | timepay_all | shell | settings gear 7-step wizard + public holidays + Xero payroll (timepay/settings.tsx), send back, approve | V3-team /team/timesheets; T6; A9 → V3-settings /settings/pay | covered |
| /dashboard/timepay/leave | timepay/leave/page.tsx:10-17 | timepay_all | shell | approve/decline, balances | S-leave /team/leave; T7 | covered |
| /dashboard/timepay/expenses | timepay/expenses/page.tsx:15-22 | timepay_all | shell | approve, reimbursed | S-expenses /team/expenses; T8 | covered |
| /dashboard/assets (?v ?screen) | assets/page.tsx:11-50 vehicle register; no assets_all → /dashboard/my-vehicle (:20) | assets_all | shell | vehicle-modal (main/entry/financials/log/renewal/services), add vehicle, scan-card | T9 "Team, Vehicles"; main-tab "old vehicle forms → the vehicle card's forms"; no Team › Vehicles board | partial |
| /dashboard/team | team/page.tsx:25-129 directory, pending invites, members without a card | team | shell | invite-modal, row menu deactivate/delete | S-person /team/lyle; T1, T11 | covered |
| /dashboard/team/[staff] (?sec) | team/[staff]/page.tsx:62-218 a person's card as admin; own loading.tsx | team | shell | licence-modal, work-rights-modal, photo | S-person, S-person-tech; T2–T5, A15 | covered |
| /dashboard/analytics (?period) | analytics/page.tsx:20-64 win rate, prices, to decide | workboard_money | shell, analytics.css | decide answers | V3-analytics "Reports, under your name"; A10 | covered |
| /dashboard/admin | admin/page.tsx:22-42 index with 7 "coming" rows | admin+ | shell | none | main-tab "Coming rows: Admin's 7"; Settings | deleted (Settings) |
| /dashboard/admin/organization (?sec) | organization/page.tsx:52-135 trading details, contact, licences & insurance, payments, expiry warnings, logo/colour, handover | owner | shell | credential-modal, transfer-owner-modal, logo picker, AddressField | A1 Settings › Business, A2 Licences and insurance, A3, A12; V3-settings draws only Pay and holidays | deleted (Settings sections; not drawn) |
| /dashboard/admin/integrations | integrations/page.tsx:17-31 index | owner | shell | none | A4/A5 Settings › ServiceM8 and Xero | deleted (not drawn) |
| /dashboard/admin/integrations/servicem8 (?connected ?error ?switched) | servicem8/page.tsx:35-240 connect, sending switches, writes card, people | owner | shell | people link panel, disconnect confirm | A4 one People table | deleted (Settings › ServiceM8 and Xero; not drawn) |
| /dashboard/admin/integrations/xero (?connected ?error) | xero/page.tsx:23-83 | owner | shell | organisation picker, people | A5 | deleted (same) |
| /dashboard/admin/quoting | quoting/page.tsx:19-43 rate, day, markups, components, ranges | financials | shell | none | A6 Settings › Quoting and prices | deleted (not drawn) |
| /dashboard/admin/price-book | price-book/page.tsx:12-20 suppliers, price lists, links, same items | financials | shell | add supplier, upload price list, invoice read | A7 | deleted (Settings › Suppliers / Price book; not drawn) |
| /dashboard/admin/rate-calculator | rate-calculator/page.tsx:13-40 | financials | shell, rate-calculator.css (255) | help-modal | A8 "Work out my rate" | deleted (not drawn) |
| /dashboard/admin/tax (?fy) | tax/page.tsx:20-40 a financial year + export link | financials | shell | none | A11 "Reports, Tax year" | deleted (Reports › Tax year; not drawn) |
| /dashboard/admin/analytics | admin/analytics/page.tsx:18-53 how jobs are counted | workboard_money | shell, analytics-settings.css | none | A10 "Settings, Reports" | deleted (not drawn) |
| /dashboard/admin/knowledge | knowledge/page.tsx:10-17 field notes to review | admin+ | shell | none | A13 To do + Library › Field notes | deleted |
| /dashboard/admin/letters | letters/page.tsx:12-23 list | admin+ | shell, templates.css | none | D6 Documents; S-documents | deleted (Documents list) |
| /dashboard/admin/letters/[id] (new) | letters/[id]/page.tsx:14-60 editor on letterhead, Download PDF | admin+ | shell, templates.css, letter-editor.css, letter.css, sheet-doc.css | none | D6 "Documents, Make a document, Letter"; "opens in its own tab"; no board | partial |
| /dashboard/admin/templates (?sec) | templates/page.tsx:10-32 list; ?sec redirects (:20-21) | signed in; owner approves | shell | none | S-templates; D4, D5 | covered |
| /dashboard/admin/templates/[key] | templates/[key]/page.tsx:21-72 certificate, swms, letterhead, project-checklist, quote, handover, documents-email, drawn as the document | signed in | shell, templates.css, swms.css, letterhead.css | none | D5 "The template, Edit"; S-templates shows the list only | partial |
| /dashboard/certificates/template | redirect (page.tsx:6) | — | — | — | main-tab "Two redirect pages" | deleted |
| /dashboard/swms/template | redirect (page.tsx:6) | — | — | — | same | deleted |
| /dashboard/swms/[versionId] | dashboard/swms/[versionId]/page.tsx:15-28 sign on to a SWMS (components/swms/sign-on.tsx, SignaturePad) | named on it, else workboard | shell, swms.css | signature pad | D2 "To do: Sign on, ~Draw"; S-swms is the wizard | partial |

## Print and public documents (outside the shell)

| URL | What it does | Audience | Stylesheets | Overlays | Plan says | Status |
|---|---|---|---|---|---|---|
| /swms/[versionId] | swms/[versionId]/page.tsx:32-400 the SWMS as paper, Letterhead, Print | named on it or workboard | tokens, globals, swms-doc.css, letterhead.css | window.print | D1 "in its own tab", D7; no board of the paper | partial |
| /certificates/[versionId] | certificates/[versionId]/page.tsx:17-35 certificate paper + Print | workboard | tokens, globals, certificate-page.css, certificate.css, sheet-doc.css | window.print | D3; no board | partial |
| /handover/[id] | handover/[id]/page.tsx:26-216 project handover sheet; CSS inline in sheet-chrome.tsx:16; contract total to everyone (:91-96); reads getProjectDetail (:38) | workboard | tokens, globals, letterhead.css, inline | window.print | P9 "Open the job, Documents, Handover sheet, Print"; Bugs: money leak; the project record it reads is deleted | partial |
| /print/certificate?t= | print/certificate/page.tsx:16-28 headless Chrome target, ticket only | server | certificate.css, sheet-doc.css | — | main-tab "Three copies of the PDF signing code → One" | partial (code, not page) |
| /print/letter?t= | print/letter/page.tsx:16-34 | server | letter.css, sheet-doc.css | — | same | partial |
| /print/design?t= | print/design/page.tsx:30-78 | server | studio.css | — | L7 | note only (studio) |
| /live/[token] + not-found.tsx + opengraph-image.tsx | live/[token]/page.tsx:81-173 customer's design sheet; expired card (:25-36) and not-found (:6-15) say "HeyTiff" in ds-live-brand; LiveCard PNG | public link | tokens, globals, studio.css, live-sheet.css | sim viewer (live-viewer.tsx, studio.css) | L7 "live link"; today-every-feature "one of 3 ways a design is drawn" | missing (studio.css dresses it; the dead-link cards aren't studio) |

## HQ (frozen)

| /hq, /hq/orgs/[id], /hq/data, /hq/data/[brand], /hq/changes, /hq/map | hq/layout.tsx:10-34 "HeyTiff HQ" text header + nav; KPIs and orgs, an org's members (delete workspace), data packs, a brand's catalogue edits + watchlist, change log, system map | HQ allowlist | tokens, globals, hq.css (1,576) | delete-workspace confirm, override editor | build-plan Ground rules "HQ cannot be touched" | covered (frozen) |

## Routes that hand a person a document or send them to a page

| Route | What | Audience | Plan | Status |
|---|---|---|---|---|
| GET /api/letters/[id]/pdf | letter PDF download printed from /print/letter (route.ts:18-47) | admin+ | D6 Download PDF | partial |
| POST /api/certificates/issue | issues a version, prints /print/certificate, files PDF on the job (route.ts:21-60) | workboard | D3 | partial |
| POST /api/studio/design-pdf | design PDF download (route.ts:15-47) | studio | L7 | note only |
| POST /api/studio/design-to-job | design PDF onto the job + ServiceM8 (route.ts:32-60) | workboard/manage | L7 | note only |
| GET /dashboard/admin/tax/export?fy= | CSV of a tax year (route.ts:19-46) | financials | A11 Export CSV | partial |
| GET /api/integrations/{servicem8,xero}/connect, /callback | OAuth hops landing back on /dashboard/admin/integrations/* with ?connected/?error (xero/callback.ts:26-37; servicem8/connect.ts:24-28) | owner | A4, A5 | deleted (landing moves to Settings; redirects must follow) |
| GET /invite/accept, GET /link-account | see Auth | | | missing |
| /opengraph-image, /live/[token]/opengraph-image | PNG previews | public | — | missing |
| GET /api/cron/reminders | sends the morning email | — | decision 12 | partial |

## Emails (all through lib/brand/auth0/email-shell.ts: chevron PNG + ink "Hey" + teal "Tiff" :119-122, ink button :189)

| Letter | Where | Plan | Status |
|---|---|---|---|
| Invitation | lib/email/invite-letter.ts | T1 sends it; nothing on its look | missing |
| Documents from a job | lib/email/documents-letter.ts:32 | J14, D3, D8 send it | missing |
| Morning reminders | lib/dashboard/reminder-digest.ts:42 | decision 12 "the morning email stays, with each item linking to its place"; A3 | partial |
| Auth0's seven: verify_email, verify_email_by_code, reset_email, reset_email_by_code, welcome_email, blocked_account, stolen_credentials | lib/brand/auth0/templates.ts:69-164 | never | missing |

## Pages that don't exist but the plan needs

- No not-found.tsx, error.tsx or global-error.tsx anywhere except live/[token]/not-found.tsx (find over src/app); 15 pages call notFound() (certificates, handover, swms x2, letters/[id], templates/[key], team/[staff], projects/[id], quotes/[id], live, print x3, hq x2) into Next's default 404. Decision 10 "an old address lands on Home" and V3-states "when something goes wrong" have no route file to live in.
- Stylesheet leaks across the studio boundary: studio.css on /live, live/not-found, /print/design; swms.css on profile signature-card.tsx, workboard job-documents-face.tsx, state-line.tsx, templates/[key]; shell.css on /welcome/details.