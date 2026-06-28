# HeyTiff — Roles & Permissions Spec

> Source of truth for **what each role can see and do** per section.
> **UI hides; the backend enforces.** Every "✗" below must be enforced server-side
> (RLS policies + server-action role checks), not just hidden in the UI.
> This is the implementation reference for when each section is built in code.

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
