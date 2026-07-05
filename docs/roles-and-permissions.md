# HeyTiff — Operations Build Spec (Roles, Permissions & Data Model)

> **Running spec for the future data-layer build.** Today Team / Time & Pay /
> Assets are a design shell with no persistence (only `organizations`,
> `memberships`, `invitations` are real in Supabase). When the operational design
> settles, the backend gets built from this doc in one holistic pass.
>
> Two parts:
> 1. **Roles & permissions** (below) — what each role can see/do per section.
>    **UI hides; the backend enforces.** Every "✗" must be enforced server-side
>    (RLS + server-action role checks), not just hidden in the UI.
> 2. **Data model** (end of doc) — the tables/relationships to build. **Draft —
>    update as the design settles**; don't lock it until the operational screens
>    stop moving.

## Roles
| Role | Scope |
|---|---|
| **Super Admin** | HeyTiff platform team. Cross-org oversight, separate & audited. Not a normal business role. (Treat as Owner within an org for now; cross-org tooling is out of scope for these sections.) |
| **Owner/Admin** | Full access within their business — everything, incl. financials, pay, billing, settings. |
| **Manager/Supervisor** | Runs the crew, not the money. Sees everyone's data + approves. **No** financials (pay rates, charge-out, billing) and **no** org settings. |
| **Staff** | Own data + shared tools only. No team-wide views, no approvals, no financials, no admin. |

Legend: ✓ = full · ◐ = own/limited · ✗ = no access (enforce server-side)

---

## Dashboard (home)
| Capability | Staff | Manager | Owner |
|---|---|---|---|
| Welcome / greeting | ✓ | ✓ | ✓ |
| Action required | ◐ own | ✓ team | ✓ team |
| Team today (roster) | ✗ | ✓ | ✓ |
| Tasks today | ◐ own | ✓ own+team | ✓ own+team |
| Assign tasks | ✗ | ✓ | ✓ |
| Noticeboard (read/ack) | ✓ | ✓ | ✓ |
| Noticeboard (post/broadcast) | ✗ | ✓ | ✓ |

## Team (People)
| Capability | Staff | Manager | Owner |
|---|---|---|---|
| View own profile | ✓ | ✓ | ✓ |
| Edit own profile | ◐ | ◐ | ◐ |
| View team directory/profiles | ✗ (own only) | ✓ | ✓ |
| Manage team records (licences, training, assignments) | ✗ | ✓ | ✓ |
| View/edit **pay & employment fields** | ✗ | ✗ | ✓ |
| Invite / offboard staff | ✗ | ✗ | ✓ (Owner/Admin) |

## Time & Pay
| Capability | Staff | Manager | Owner |
|---|---|---|---|
| Timesheets — enter/submit own | ◐ | ◐ | ◐ |
| Timesheets — view all + approve | ✗ | ✓ | ✓ |
| Leave — request own | ◐ | ◐ | ◐ |
| Leave — approve + team calendar | ✗ | ✓ | ✓ |
| Expenses — submit own claim | ◐ | ◐ | ◐ |
| Expenses — approve | ✗ | ✓ | ✓ |
| Expenses — Xero export | ✗ | ✗ | ✓ |
| See **pay rates / wage $ / charge-out** | ✗ | ✗ | ✓ |

> Note: Managers approve **hours** (timesheets) and **expense amounts**, but never see
> **pay rates / wages / charge-out** — those are dollar-figures tied to pay, Owner-only.

## Assets
| Capability | Staff | Manager | Owner |
|---|---|---|---|
| Fleet — own assigned vehicle (log issues/fuel/odo) | ◐ | ◐ | ◐ |
| Fleet — whole fleet, assign, service schedule | ✗ | ✓ | ✓ |
| Fleet — valuations | ✗ | ✓ | ✓ |
| Equipment — view "assigned to me" | ◐ | ◐ | ◐ |
| Equipment — full register (serial, holder, calibration) | ✗ | ✓ | ✓ |

> Note: fleet **value** is explicitly Manager+ (per content spec), unlike pay/charge-out
> which is Owner-only — keep that distinction.

## Admin (existing section)
| Item | Manager | Owner |
|---|---|---|
| Invites / users / roles / settings | ✗ | ✓ |
| Charge-out rate calculator | ✗ | ✓ |
| Compliance (incidents, QA) | ✓ | ✓ |
| Documents (store/verify/share) | ✓ | ✓ |
| Licences & insurances (expiry tracking) | ✓ | ✓ |
| Training & apprentices (authoring/oversight) | ✓ | ✓ |
| Password vault · Billing · Usage analytics · Feedback | ✗ | ✓ |
| Help | ✓ (all roles) | ✓ |

(Staff: Admin section hidden entirely.)

---

## Enforcement checklist (when building each section)
- [ ] Every feature table carries `org_id`; RLS scopes rows to the caller's org.
- [ ] Row-level scoping for `◐ own`: RLS restricts Staff to `user_id = auth.uid()` rows.
- [ ] Manager-vs-Owner gates (financial fields) enforced in queries/columns, not just UI.
- [ ] Server actions re-check role on every mutating call (approve, assign, invite, export).
- [ ] "Acceptance test" per role: delete mock data → every screen renders a clean empty state.

---

# Data model (DRAFT — finalise when the operational design settles)

> Don't build these yet. This captures the entities + relationships the design
> implies so far, so the schema is designed **once, holistically** later. Every
> table carries `org_id` (multi-tenant, RLS-scoped). Tables marked *own-scoped*
> also carry a `user_id`/`staff_id` that RLS restricts Staff to their own rows.

## Entities & key relationships
- **organizations** *(exists)* — the business. Root of every tenant scope.
- **memberships** *(exists)* — `user_id` ↔ `org_id` + `role` (owner/admin/manager/staff).
- **invitations** *(exists)* — pending invites by email + role.
- **staff** *(new)* — the profile record per person. Likely links 1:1 to a
  membership (the login) but may exist before a login (invited / not yet joined).
  Holds: personal details, emergency contact, employment, work-rights/visa.
  **Payroll fields are Owner-only** (separate table or column-level RLS).
- **licences** *(new, own-scoped)* — belongs to `staff`; type, number, expiry, document. Feeds Dashboard "Action required" via expiry.
- **vehicles** *(new)* — Fleet. rego, service schedule, insurance expiry, value (Manager+), **assigned to a `staff` (nullable)** → shows on the staff profile's "Assigned vehicle".
- **equipment** *(new)* — serial, calibration/test-tag dates, **current holder = `staff`**.
- **timesheets** *(new, own-scoped)* — `staff` × day/job, hours, status (draft/submitted/approved/rejected), approver.
- **leave_requests** *(new, own-scoped)* — `staff`, type, dates, status, approver; feeds the team calendar + Dashboard "Team today".
- **expenses** *(new, own-scoped)* — `staff`, amount, category, receipt doc, status, approver; Owner-only Xero export.
- **tasks** *(new, own-scoped)* — assigned to `staff` by manager/owner; surfaces in Dashboard "Tasks today".
- **notices** *(new)* — noticeboard posts + read receipts.

## Cross-section couplings to keep in mind (why we design it together)
- staff ↔ vehicles ↔ equipment (assignment).
- staff.payroll (cost-split, wage) → Admin **charge-out rate** calculator.
- timesheets / leave / expenses → shared **submit → approve** workflow + Dashboard "Action required".
- licence / rego / calibration **expiries** → Dashboard "Action required" (a cross-cutting "expiring soon" concept).

## Shared patterns to build once
- **Approvals**: one approval model reused by timesheets, leave, expenses (submitter, approver, status, timestamps).
- **Documents**: licence scans, expense receipts, work-rights evidence — likely one `documents` table + storage bucket, referenced by the others.
- **Expiry/compliance**: a consistent "expires_at + severity" treatment feeding the Dashboard.

> Update this section whenever a design change adds/removes a field or relationship.
