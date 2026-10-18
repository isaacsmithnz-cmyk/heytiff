import { Suspense } from "react";
import { redirect } from "next/navigation";
import { headers } from "next/headers";
import { auth0 } from "@/lib/auth0";
import { TeamPage, type TeamPageData } from "@/components/team/team-page";
import { Loading } from "@/components/parts/states";
import { can, getCapabilities, getDbRole } from "@/lib/permissions-server";
import { hasMinRole } from "@/lib/roles-shared";
import { invitableRoles } from "@/lib/permissions";
import { listMembersWithoutCard, listPendingInvites, listStaff } from "@/lib/staff/query";
import { orgExpiryWindow } from "@/lib/org/query";
import { loadTimepaySection } from "@/lib/timepay/section";
import { loadFleetPage } from "@/lib/fleet/page-data";
import { loadNoticeBoard } from "@/lib/dashboard/page-data";
import { readTeamView, teamViewsFor } from "@/lib/team/views";

/* TEAM (v2, step 5; the board "Team, People"). One place for the people
   and what they hand in: People, Timesheets, Leave, Expenses, Vehicles and
   Notices, as soft tabs under the title, with Add a person as the main
   button.

   Every view is today's screen's read, under today's gate:
   - People is the directory's (listStaff, listMembersWithoutCard,
     listPendingInvites), and Team itself is gated on `team`, here, because
     a leaf route is deep-linkable. The directory never shows pay: listStaff
     selects identity columns only.
   - Timesheets, Leave and Expenses are Time & Pay's one load
     (loadTimepaySection), asked for only with `timepay_all`, which is what
     today's /dashboard/timepay asks. Inside it `approvals` and `financials`
     still decide what each face may do and see.
   - Vehicles is the Fleet register (loadFleetPage), asked for only with
     `assets_all`, Assets' gate.
   - Notices is the noticeboard's own read, which everyone has.

   Inviting: WHICH roles this viewer may create is decided here
   (invitableRoles: owner gives admin or staff, a delegated inviter staff
   only) and re-checked by the action. An empty list is also "can they
   invite at all", so there is one gate, not two.

   The view, and Timesheets' period, ride in the address. The wait is the
   page's own Suspense, so a person's page under /dashboard/team/ never
   waits behind this list's skeleton. */

type Params = Promise<Record<string, string | string[] | undefined>>;

async function TeamBody({ searchParams }: { searchParams: Params }) {
  const session = await auth0.getSession();
  const orgId = session?.orgId as string | undefined;
  if (!orgId) redirect("/dashboard");

  const params = await searchParams;
  const period = typeof params.period === "string" ? params.period : undefined;

  const [expiry, timepayAll, assetsAll] = await Promise.all([
    orgExpiryWindow(orgId),
    can("timepay_all"),
    can("assets_all"),
  ]);
  const [staff, orphans, actorRole, caps, timepay, fleet, notices] = await Promise.all([
    listStaff(orgId, expiry.warnDays),
    /* A member with no staff card is invisible everywhere else on this page:
       People reads cards, and the invites are unaccepted ones, so somebody
       who accepted and never got a card is in neither. Read the roster
       directly and show them. */
    listMembersWithoutCard(orgId),
    getDbRole(),
    getCapabilities(),
    timepayAll ? loadTimepaySection(period) : Promise.resolve(null),
    assetsAll ? loadFleetPage({ withRegister: true }) : Promise.resolve(null),
    loadNoticeBoard(),
  ]);
  const inviteRoles = invitableRoles(actorRole, caps);
  const canInvite = inviteRoles.length > 0;
  // tokens and ids ride along only when this viewer may act on them
  const pending = await listPendingInvites(orgId, { withLinks: canInvite });

  /* Prefer the configured base URL; otherwise derive it from the incoming
     request so invite links are always right in production (never localhost). */
  const h = await headers();
  const host = h.get("host");
  const proto = h.get("x-forwarded-proto") ?? "https";
  const appUrl = process.env.APP_BASE_URL ?? (host ? `${proto}://${host}` : "http://localhost:3000");

  const register = fleet?.register ?? null;
  const views = teamViewsFor({ timepay: !!timepay, fleet: !!register });

  const data: TeamPageData = {
    people: {
      staff,
      orphans,
      pending,
      canInvite,
      inviteRoles,
      appUrl,
      // an owner may take back the seat of a member who never got a card
      canRemoveMembers: hasMinRole(actorRole, "owner"),
      /* The vehicle each person drives, from the register, only for a reader
         who may see the register. Without it the column isn't drawn. */
      vehicles: register
        ? Object.fromEntries(
            register.vehicles
              .filter((v) => v.assignedTo && v.status !== "sold")
              .map((v) => [v.assignedTo as string, [v.model || v.name || v.make, v.plate].filter(Boolean).join(" ")]),
          )
        : null,
    },
    timepay,
    fleet: register && fleet ? { register, today: fleet.today, warnDays: fleet.warnDays } : null,
    notices,
    views,
  };

  return <TeamPage data={data} view={readTeamView(params.view, views)} />;
}

export default async function TeamRoute({ searchParams }: { searchParams: Params }) {
  if (!(await can("team"))) redirect("/dashboard");
  return (
    <Suspense
      fallback={
        <div className="tm2">
          <Loading what="Loading the team" shape="rows" count={7} />
        </div>
      }
    >
      <TeamBody searchParams={searchParams} />
    </Suspense>
  );
}
