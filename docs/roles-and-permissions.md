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
| **Owner/Admin** | Full access within their business — everything, incl. financials, pay, billing, settings. Multiple owners are allowed: exactly one **master owner** (`organizations.primary_owner_user_id`, shown as "Owner") plus any number of **co-owners** (also `role='owner'`, shown as "Co-owner"). Co-owners hold every capability; only the master can transfer ownership, hold billing or delete the org, and **nobody can demote, remove or edit the master**. |
| **Manager/Supervisor** | Runs the crew, not the money. Sees everyone's data + approves. **No** financials (pay rates, charge-out, billing) and **no** org settings. |
| **Staff** | Own data + shared tools only. No team-wide views, no approvals, no financials, no admin. |

Legend: ✓ = full · ◐ = own/limited · ✗ = no access (enforce server-side)

> **2026-07-20 — capability model (implemented).** Role is a *default*, not a
> verdict: it seeds a per-person capability set (`src/lib/permissions.ts`) and
> the owner can grant/revoke individual capabilities in Team (sparse overrides
> in `memberships.permissions`; a role change resets them). Enforcement asks
> `can(capability)` (`src/lib/permissions-server.ts`, fresh DB read per
> request) — never the role — except owner-intrinsics (change roles,
> invite/offboard, billing, org settings), which use the fresh DB role.
> Permission management itself is the `permissions` capability, so the owner
> can delegate it — but the owner-tier grants (`financials`, `permissions`)
> stay owner-only (`OWNER_TIER` + `canSetCapability`/`canEditPermissionsOf` in
> `src/lib/permissions.ts`), so delegation can't become a side door into pay.
> Onboarding is likewise the `invites` capability, but a delegated inviter can
> only invite at **staff** role (`invitableRoles`) — picking a role is a role
> assignment, which stays owner-only. So the rows below that read "Manager ✗"
> mean *by default*: the owner can grant Invites or Financials to a specific
> admin. Only role changes, billing and org settings are ungrantable.
> The three-role DB stays: the doc's "Manager" tier is the `admin` role's
> default set (everything operational, no money); granting `financials` to an
> admin is how an owner delegates pay visibility. The tables below remain the
> source for the *defaults*.

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
| Invites / users / roles / settings | ✗ (invites grantable via `invites`, staff-role only) | ✓ |
| **Organisation settings** *(built 2026-07-20)* — trading/legal name, ABN (checksummed), ACN, GST, contact & address (state → public holidays), ARC RTA, contractor licence, public liability insurance, logo (upload deferred). Trading name renders as the sidebar's "HeyTiff × …" line. | ✗ | ✓ (incl. co-owners) |
| Charge-out rate calculator | ✗ (grantable via `financials`) | ✓ |
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
- **organizations** *(exists; extended 2026-07-20)* — the business. Root of every
  tenant scope. Now also carries the **company profile** (trading/legal name,
  ABN/ACN, GST flag, contact, address + `state` with an AU CHECK — the state
  that public holidays key off — ARC RTA, contractor licence, public-liability
  insurance incl. expiry `date`, `logo_url`) and **`primary_owner_user_id`**
  (NOT NULL, composite FK → memberships): the master owner, undeletable until
  ownership is transferred. Legacy `name` = signup-email seed, never displayed.
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
