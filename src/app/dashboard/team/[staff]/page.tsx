import { notFound, redirect } from "next/navigation";
import { auth0 } from "@/lib/auth0";
import { PersonPage, type PersonPageData } from "@/components/team/person-page";
import type { PermissionsCtx } from "@/components/profile/types";
import type { StaffProfile } from "@/lib/staff/profile";
import { assignedVehicleFor } from "@/lib/fleet/query";
import { can, getCapabilities, getOrgName, getOrgState, getOwnership } from "@/lib/permissions-server";
import {
  CAPABILITIES,
  canChangeRoleOf,
  canEditPermissionsOf,
  canSetCapability,
  invitableRoles,
  resolve,
  type Capability,
} from "@/lib/permissions";
import { hasMinRole } from "@/lib/roles-shared";
import { getStaff, listLicenceTerms, listWorkRightsChecks, permissionsOf, staffCardsInUse } from "@/lib/staff/query";
import { documentsForStaffLicences, documentsForWorkRights } from "@/lib/documents/query";
import { signPhotoUrl } from "@/lib/staff/photo";
import { getPaySettings, shiftDefaultsFor } from "@/lib/timepay/query";
import { derivedDayHours, normalHours, rosteredWeekHours } from "@/components/timepay/logic";
import { classifyEmployment } from "@/lib/staff/employment";
import { balancesFor } from "@/lib/timepay/leave-query";
import { balanceView, type BalanceKind } from "@/lib/timepay/leave";
import { sm8StaffLinkMap } from "@/lib/integrations/links";
import { capacityRowFor } from "@/lib/workboard/capacity-query";
import { readRegularDaysOff } from "@/lib/team/regular-days-off-query";
import { todayInAu } from "@/lib/au-dates";
import { orgExpiryWindow } from "@/lib/org/query";
import { aliasesOf } from "@/lib/staff/aliases-query";
import {
  addStaffLicence,
  attachStaffLicenceDocument,
  attachStaffWorkRightsDocument,
  clearStaffPhoto,
  recordStaffLicenceTerm,
  recordStaffWorkRightsCheck,
  removeStaffLicence,
  removeStaffLicenceTerm,
  removeStaffWorkRightsCheck,
  saveStaffAliases,
  saveStaffSection,
  setStaffPhoto,
  updateStaffLicence,
} from "@/app/actions/staff";

/* TEAM, A PERSON (v2, step 5; the board "Team, a person"). One page, three
   columns of groups, an Edit on each (the staff card's own edit cycle, in
   place). Today's card, every section and every gate:

   - Which groups render is decided HERE, from the viewer's capabilities, and
     the matching action re-checks the same rules. A group the viewer may not
     have is OMITTED, never rendered and hidden: Pay needs `financials`, the
     notes are never on your own page, Signature is only ever yours.
   - Normal week reads Time & Pay's hours for the person (the org's, or their
     own). Only you change your own (saveMyHours is yours alone); a manager
     reads them. Counts toward the schedule is the Schedule's crew row, read
     with `workboard` and switched with `workboard_manage`, found through the
     person's ServiceM8 link (the crew is keyed on ServiceM8's people).
   - Leave reads the person's balances with `timepay_all`, Time & Pay's gate,
     and sets them with `team`, setLeaveBalance's. Only hours and dates go to
     the page: no certificate leaves the server.
   - Regular days off come with Team (`team`), their actions' gate.
   - Deactivate and Reactivate are the personal section's `status`; Delete is
     offered only to an owner, on a card nothing on the records points at.

   Note what is NOT here: someone else's pay without `financials`. */

export default async function StaffPersonPage({
  params,
  searchParams,
}: {
  params: Promise<{ staff: string }>;
  searchParams: Promise<{ [key: string]: string | string[] | undefined }>;
}) {
  if (!(await can("team"))) redirect("/dashboard");

  const session = await auth0.getSession();
  const orgId = session?.orgId as string | undefined;
  if (!orgId) redirect("/dashboard");

  const [{ staff: staffId }, caps, ownership, query, orgName, orgState, expiry] = await Promise.all([
    params,
    getCapabilities(),
    getOwnership(),
    searchParams,
    getOrgName(),
    getOrgState(),
    orgExpiryWindow(orgId),
  ]);

  const canPay = caps.has("financials");
  // Scoped to the caller's org: an id from another org is indistinguishable
  // from one that doesn't exist, which is the point.
  const found = await getStaff(orgId, staffId, { pay: canPay, notes: true }, expiry.warnDays);
  if (!found) notFound();

  const { row, profile, licences } = found;
  const isSelf = !!row.userId && row.userId === ownership.userId;
  const today = todayInAu();

  const editable = canEditPermissionsOf(
    { role: ownership.role, userId: ownership.userId, caps },
    { role: row.orgRole, userId: row.userId },
  );
  const settable = new Set<Capability>(CAPABILITIES.filter((c) => canSetCapability(ownership.role, c)));
  const isOwner = hasMinRole(ownership.role, "owner");
  const [workboard, manageCrew, timepayAll] = await Promise.all([can("workboard"), can("workboard_manage"), can("timepay_all")]);

  const licenceIds = licences.map((l) => l.id);
  const [
    targetOverrides,
    assignedVehicle,
    photoUrl,
    licenceTerms,
    licenceDocuments,
    workRightsChecks,
    workRightsDocuments,
    aliases,
    { settings },
    defaults,
    inUse,
    links,
    regularDaysOff,
    leaveRead,
  ] = await Promise.all([
    row.userId ? permissionsOf(orgId, row.userId) : Promise.resolve(null),
    // derived from the register, never stored on the staff record
    assignedVehicleFor(orgId, staffId),
    // the link into a private bucket is minted per render
    signPhotoUrl(profile.photo_url as string | null | undefined),
    listLicenceTerms(orgId, staffId),
    documentsForStaffLicences(orgId, licenceIds),
    listWorkRightsChecks(orgId, staffId),
    documentsForWorkRights(orgId, staffId),
    aliasesOf(orgId, staffId),
    getPaySettings(orgId),
    shiftDefaultsFor(orgId, [staffId]),
    /* WHICH CARDS MAY OFFER DELETE: owners only, and only a card nothing on
       the records points at. A failed read offers it on none. */
    isOwner ? staffCardsInUse(orgId) : Promise.resolve(null),
    workboard ? sm8StaffLinkMap(orgId) : Promise.resolve(new Map<string, string>()),
    readRegularDaysOff(orgId, staffId),
    timepayAll ? balancesFor(orgId, staffId) : Promise.resolve(null),
  ]);

  /* The Schedule's crew row: ServiceM8's uuid for this person, through their link. */
  const sm8Uuid = [...links.entries()].find(([, profileId]) => profileId === staffId)?.[0] ?? null;
  const crew = workboard && sm8Uuid ? { ...(await capacityRowFor(orgId, sm8Uuid)), staffUuid: sm8Uuid } : null;

  const own = { hours: defaults.hours.get(staffId), workDays: defaults.workDays.get(staffId) };
  const hours = normalHours(settings, own.hours);
  const employment = classifyEmployment(profile.employment_type as string | null | undefined);

  const leave = leaveRead
    ? (() => {
        const cell = (kind: BalanceKind) => {
          const b = leaveRead.balances.find((x) => x.kind === kind);
          if (!b) return null;
          const v = balanceView(b, leaveRead.requests);
          return { available: v.available, balanceHours: v.balanceHours, asAt: v.asAt, source: v.source };
        };
        return {
          annual: cell("annual"),
          personal: cell("personal"),
          coming: leaveRead.requests
            .filter((r) => (r.status === "pending" || r.status === "approved") && r.endDate >= today)
            .sort((a, b) => a.startDate.localeCompare(b.startDate))
            .slice(0, 3)
            .map((r) => ({ id: r.id, kind: r.kind, startDate: r.startDate, endDate: r.endDate, hours: r.hours, status: r.status })),
        };
      })()
    : null;

  const permissions: PermissionsCtx = {
    role: row.orgRole,
    caps: resolve(row.orgRole, targetOverrides),
    settable,
    canChangeRole: canChangeRoleOf(
      { role: ownership.role, userId: ownership.userId, primaryOwnerUserId: ownership.primaryOwnerUserId },
      { role: row.orgRole, userId: row.userId ?? "", primaryOwnerUserId: ownership.primaryOwnerUserId },
    ),
    editable,
    lockedReason: editable
      ? undefined
      : isSelf
        ? "You can't change your own access. Ask another owner."
        : row.isMaster
          ? "The owner's access can't be changed. Transfer ownership first."
          : "Only an owner, or someone granted Permissions, can change access.",
  };

  /* Only for a viewer who sees Pay: the week Time & Pay fills in, beside the
     typed hours a week, so the two can be seen to agree. */
  const rosteredWeek = canPay ? rosteredWeekHours(settings, own, employment) : null;

  const data: PersonPageData = {
    header: { ...row, photoUrl },
    profile: profile as unknown as StaffProfile,
    licences,
    licenceTerms,
    licenceDocuments: Object.fromEntries(licenceDocuments),
    workRightsChecks,
    workRightsDocuments,
    vehicle: assignedVehicle,
    today,
    warnDays: expiry.warnDays,
    org: orgName,
    orgState,
    aliases,
    addressLookup: Boolean(process.env.GOOGLE_MAPS_API_KEY),
    isSelf,
    // omitted entirely without `financials`, not rendered and hidden
    payroll: canPay ? profile : null,
    rosteredWeek,
    permissions,
    // notes are written ABOUT someone; you don't read your own
    notes: isSelf ? null : { notes: (profile.notes as string | null | undefined) ?? null },
    week: {
      start: hours.start,
      end: hours.end,
      days: own.workDays ?? settings.workDays,
      perDay: derivedDayHours(hours.start, hours.end, settings),
      breakMinutes: settings.breakMinutes,
      breakPaid: settings.breakPaid,
      weekHours: rosteredWeekHours(settings, own, employment),
      ownHours: !!own.hours,
      ownDays: own.workDays !== undefined,
    },
    crew,
    canManageCrew: manageCrew,
    linkedToSm8: !!sm8Uuid,
    showCrew: workboard,
    leave,
    canSetBalances: caps.has("team"),
    regularDaysOff,
    deletable: !!inUse && !inUse.has(staffId) && !row.isMaster && row.orgRole !== "owner" && row.userId !== ownership.userId,
    inviteRoles: invitableRoles(ownership.role, caps),
    initialSec: typeof query.sec === "string" ? query.sec : undefined,
  };

  return (
    <PersonPage
      data={data}
      actions={{
        onSave: saveStaffSection.bind(null, staffId),
        onSaveAliases: saveStaffAliases.bind(null, staffId),
        onAddLicence: addStaffLicence.bind(null, staffId),
        onUpdateLicence: updateStaffLicence.bind(null, staffId),
        onRemoveLicence: removeStaffLicence.bind(null, staffId),
        onRecordLicenceTerm: recordStaffLicenceTerm.bind(null, staffId),
        onAttachLicenceDoc: attachStaffLicenceDocument.bind(null, staffId),
        onRemoveLicenceTerm: removeStaffLicenceTerm.bind(null, staffId),
        onRecordWorkRightsCheck: recordStaffWorkRightsCheck.bind(null, staffId),
        onAttachWorkRightsDoc: attachStaffWorkRightsDocument.bind(null, staffId),
        onRemoveWorkRightsCheck: removeStaffWorkRightsCheck.bind(null, staffId),
        onSetPhoto: setStaffPhoto.bind(null, staffId),
        onClearPhoto: clearStaffPhoto.bind(null, staffId),
      }}
    />
  );
}
