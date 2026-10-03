import { redirect } from "next/navigation";
import { auth0 } from "@/lib/auth0";
import { can, getDbRole } from "@/lib/permissions-server";
import { hasMinRole } from "@/lib/roles-shared";
import { auDayOf, fmtAuWeekdayDayMonth } from "@/lib/au-dates";
import { libraryApproval, ownerName } from "@/lib/swms/query";
import { certApprovals, listFanModels } from "@/lib/certs/query";
import { CERT_LIBRARY_VERSION, changedSince } from "@/lib/certs/mechanical";
import { staffDisplayNames } from "@/lib/workboard/job-notes-query";
import { PaperworkScreen, type PaperworkProps } from "@/components/admin/paperwork-screen";

/* PAPERWORK — the SWMS template, the certificate wording and the fan list,
   in Admin with the business's other settings. Anyone signed in can read it,
   as they could read the two template pages it replaces; only the owner
   approves, and the fan list is changed by whoever can open a job card
   (`workboard`), as it always could be from a certificate. */

const day = (iso: string) => fmtAuWeekdayDayMonth(auDayOf(iso));

export default async function PaperworkPage({
  searchParams,
}: {
  searchParams: Promise<{ [key: string]: string | string[] | undefined }>;
}) {
  const session = await auth0.getSession();
  if (!session) redirect("/auth/login");
  const orgId = session.orgId as string | undefined;
  if (!orgId) redirect("/dashboard");

  const [role, canFans, swms, approvals, fans, owner, params] = await Promise.all([
    getDbRole(),
    can("workboard"),
    libraryApproval(orgId),
    certApprovals(orgId),
    listFanModels(orgId),
    ownerName(orgId),
    searchParams,
  ]);
  const names = await staffDisplayNames(orgId, approvals.map((a) => a.approvedById));
  const by = (id: string) => names.get(id) ?? "Unnamed";

  /* this version's approval, and the last one before it to compare with */
  const current = approvals.find((a) => a.version === CERT_LIBRARY_VERSION) ?? null;
  const earlier = approvals.filter((a) => a !== current);
  const last = earlier[0] ?? null;
  const changed = current ? null : changedSince(last?.wording ?? null);

  const wording: PaperworkProps["wording"] = {
    approved: current ? { by: by(current.approvedById), on: day(current.approvedAt) } : null,
    changed: changed ? [...changed].map((clause) => ({ clause, isNew: !last?.wording?.[clause] })) : null,
    lastApprovedOn: last ? day(last.approvedAt) : null,
    earlier: earlier.map((a) => ({ by: by(a.approvedById), on: day(a.approvedAt) })),
  };
  const sec = params.sec;

  return (
    <PaperworkScreen
      initialSec={typeof sec === "string" ? sec : undefined}
      isOwner={hasMinRole(role, "owner")}
      ownerName={owner}
      canEditFans={canFans}
      swms={swms ? { by: swms.approvedBy, on: day(swms.approvedAt) } : null}
      wording={wording}
      fans={fans}
    />
  );
}
