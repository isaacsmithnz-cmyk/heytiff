# MVP launch cut list — office/admin on desktop

**Decision (2026-08-14):** the first real users are **office/admin staff on desktop**.
Field techs wait for the phone app. Target: the team is working in it inside two weeks.

**The premise this document is built on.** The desktop doesn't feel finished because it
*isn't full*, not because it's badly drawn. There are 30 routes in the rail and exactly
two of them stand on real data:

| Table | Rows | | Table | Rows |
|---|---:|---|---|---:|
| `sm8_attachments` | 39,817 | | `timesheets` | **0** |
| `sm8_job_activities` | 17,703 | | `expense_claims` | **0** |
| `sm8_job_checklists` | 9,790 | | `notices` | **0** |
| `sm8_jobs` | 3,455 | | `projects` / `project_jobs` | **0** |
| `kb_chunks` | 2,134 | | `maintenance_visits` | **0** |
| `kb_documents` | 14 | | `leave_balances`, `staff_licences` | **0** |
| | | | **`staff_profiles`** | **1** |

One staff card, against 20 people mirrored from ServiceM8. Nothing about that is fixed by
a redesign. Cutting the surface to what can actually be *full* on day one is.

---

## 1. What ships

| Screen | Route | Why it's in |
|---|---|---|
| **Home** | `/dashboard` | The landing. Six tabs, all of which fill from the screens below. |
| **Timesheet + Leave** | `/dashboard/my-timesheet` | **The reason anyone opens the app tomorrow.** Everything else is optional; this is not. |
| **Time & Pay** | `/dashboard/timepay` | The other half of the loop — approve, send back. Useless without it. |
| **Team** | `/dashboard/team` | Where people get invited and where their cards live. It is the onboarding screen. |
| **Library** | `/dashboard/tiff` | 14 documents and 2,134 chunks of real content. Works on day one with no data entry. |
| **Workboard → All jobs** | `/dashboard/workboard` | Read-only over the SM8 mirror. The one screen that looks *full* immediately. |
| **Admin → Organisation** | `/dashboard/admin/organization` | Needed during launch week (see §3). Owner/admin only already. |

## 2. What gets gated off, and how

The lever already exists and needs no new mechanism: **trim `STAFF_DEFAULTS` and
`ADMIN_DEFAULTS` in [`src/lib/permissions.ts`](../src/lib/permissions.ts)**. Because
`ROLE_DEFAULTS.owner = CAPABILITIES`, the owner keeps the entire app — so Isaac can still
open anything to check it while the team sees only the MVP surface. Reverting is a
one-line change per capability, and per-person grants still work from Team for anyone who
needs an exception.

| Screen | Capability to drop | Why it's out |
|---|---|---|
| Design Studio | `studio` | 3 designs, none of them a customer's. Not part of an office day. |
| Toolbox | `toolbox` | Calculators for people on the tools — that's the phone app's audience, not this one. |
| Assets | `assets_all` | 2 vehicles, 1 log. Nothing to manage yet. |
| Workboard money | `workboard_money` | Already off by default at every role. Leave it off. |
| Workboard → Projects | `workboard_manage` | 0 projects, 0 linked jobs. The "Attach job" path has never once been used. |

**Three rows can't be gated today** — Vehicle, Expenses and Notes are deliberately
ungated ("spending your own money on the job and asking for it back is not a privilege").
Options, in order of preference:

1. **Leave them.** Notes is genuinely useful and self-explanatory; Vehicle and Expenses
   are two rows of clutter for an office user. Cheapest, and honest.
2. Add `vehicle` and `expenses` capabilities. The model is built for exactly this — an
   hour's work including tests — but it's new code in launch fortnight.

Recommendation: **option 1 for the launch**, revisit when the techs come on.

## 3. Pre-launch configuration — none of this is code

Each of these is currently wrong or unset in prod, and each is visible to a new user on
their first day.

- **The organisation is called `isaacsmithnz1@gmail.com`.** `trading_name` is set
  correctly to "Diamond Air Solutions", but `name` is the address signup used. Set it in
  Admin → Organisation.
- **Public holidays are switched OFF in the pay rules** (`pay_settings.rules.ph.on =
  false`, everything else configured: Weekly, Mon start, submit Sun 3pm, 8h standard, OT
  after 8/day, Sat ×1.5, Sun ×2, super 12%). For an NSW business this is a decision that
  needs making deliberately before the first pay period, not discovered in one.
- **Everyone needs a staff card and an invite.** One exists. See §4 — this is the single
  most dangerous step of the launch.
- **Leave `SELF_SERVE_SIGNUP` unset in Vercel.** See §4.
- **Three orphan organisations exist** (`brucemcc90@gmail.com` owns two). Decide whether
  to delete them or leave them inert — Isaac's call, and a deletion nobody should make
  on his behalf.

## 4. Onboarding is the riskiest path in the launch

It has run **once** in the app's lifetime, and it had a trap in it:

- **Invite emails are never sent.** [`actions/invite.ts:152`](../src/app/actions/invite.ts)
  is still a `TODO`. An invite reaches a person only when an admin copies its link from
  the Pending tab on Team and sends it themselves. Plan for that — it is fine for five
  people and impossible for fifty.
- **Invites expire after 7 days.** With hand-delivered links, expect at least one lapse.
  Renew is on the Pending tab.
- **Signing in without clicking the link used to mint a ghost company.** Fixed on this
  branch: uninvited signup no longer creates an org (it's behind `SELF_SERVE_SIGNUP`,
  off by default), a person in that state lands on the new `/no-org` screen which hands
  them their pending invite, and the membership read is now ordered so a double-membership
  login stops flipping between companies. Prod already carries three of these ghosts.

**Rehearse it once before the real invites go out**: invite a spare address, sign in via
the front door *without* the link, confirm `/no-org` names Diamond Air and its button
lands you in the app.

## 5. What each surviving screen needs before anyone is invited

Everything below is *unwalked* — previews can't authenticate, so all of it shipped
verified by tests and a static harness only. This is the launch-blocking half of
`project-unwalked-prod-backlog`, in priority order.

1. **The timesheet loop, end to end, with a real person and a real wage.** Enter a day →
   submit the week → approve it from Time & Pay → send one back. Zero rows exist today,
   so every state transition is unproven against the database. This surface has already
   shipped a bug that understated a Saturday by 25% — being wrong here in week one costs
   trust that doesn't come back.
2. **My Pay reads right** for someone whose wage you can check by hand.
3. **The Team row menu writes.** Deactivate became a real write recently and has never
   been pressed. Confirm someone goes Inactive and comes back.
4. **Time & Pay tab navigation** — Timesheets/Leave/Expenses. A client-navigation change
   no harness can cover.
5. **The Library answers and cites.** First visit seeds the 49 tags; that has never
   happened in prod.
6. **Home's debrief capture** — bar → words → Go → review → Save. A bug that made Save
   unreachable was live until recently; the whole path is unclicked.

## 5a. Timesheet loop — code audit (2026-08-14)

**The good news first, because it's the part that usually goes wrong.** The hunt that
found the worst bug in each of the last three audits — *one number computed twice* — comes
up **empty** on this surface:

- `splitDay` in [`components/timepay/logic.ts`](../src/components/timepay/logic.ts) is the
  only model of what an hour is worth. Penalties don't stack, and the ordering
  (public holiday → weekend → night portion) is stated and enforced in one place.
- The employee's screen and the approver's screen both import `derive` from that same
  file, so the two can't disagree about a week.
- `materialise` on submit reuses `presumeFor` — the same function the screen displays
  from — rather than a second copy of the presumption rules.
- `getMyPay` carries the rule objects whole and re-derives nothing. That is the fix for
  the Saturday-25% bug, and it held.

**Two real findings.**

1. **An approver's own row sits in their own queue with an Approve button that can never
   work.** `review()` correctly refuses to let anyone sign off their own hours, but
   `page-data.ts` builds the list with only `employment !== "subbie"` filtered out — the
   viewer is still in it. Pressing the button returns "You can't review your own
   timesheet."

   The operational half matters more than the cosmetic one: **with one approver, that
   person's own timesheet can never be approved by anyone.** `approvals` is an admin
   default, so a `staff`-role office hire doesn't have it. Isaac is currently the only
   staff card in the org — meaning on day one his own sheet has no possible approver.
   **Grant `approvals` to a second person before the first period closes.**

2. **Working a public holiday currently pays ordinary rates.** The shipped default is
   `ph: { on: true, rate: 2 }`; prod has `pay_settings.rules.ph.on = false`, with 36
   holidays seeded in `public_holidays`. The app is honest about it — the approver's
   bullet reads "worked the public holiday … at ordinary rates — the holiday rule is
   off" — but this is a payroll decision that should be made deliberately before a period
   containing one, not discovered inside it.

## 6. Suggested order for the fortnight

**Week 1 — make it true**
1. Merge the onboarding fix on this branch.
2. Trim the capability defaults (§2) and confirm the rail on a non-owner account.
3. Fix the org name and decide the public-holiday rule (§3).
4. Walk the timesheet loop (§5.1) and fix whatever it turns up. Budget most of the week
   for this — it is the launch. Settle both §5a findings first: a second approver, and
   the public-holiday rule.

**Week 2 — let people in**
5. Create the staff cards; rehearse onboarding on a spare address (§4).
6. Walk items §5.2–§5.4.
7. Invite the office, two or three people, day one of the week — not all at once on the
   last day.
8. Leave the last two days empty on purpose. The first real users will find something.

## 7. Explicitly not in this MVP

The phone app; ServiceM8 two-way writes; Projects and maintenance visits; expense claims;
the tax screen; Design Studio; Toolbox; fleet management; invite emails. None of these are
cancelled — they are simply not what the first two weeks are for, and every one of them
is a screen that would be empty on day one.
