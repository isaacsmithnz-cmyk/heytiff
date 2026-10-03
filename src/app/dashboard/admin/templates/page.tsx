import { redirect } from "next/navigation";
import { auth0 } from "@/lib/auth0";
import { getDbRole } from "@/lib/permissions-server";
import { hasMinRole } from "@/lib/roles-shared";
import { auDayOf, fmtAuWeekdayDayMonth } from "@/lib/au-dates";
import { libraryApproval, ownerName } from "@/lib/swms/query";
import { certApprovals } from "@/lib/certs/query";
import { CERT_LIBRARY_VERSION, changedSince } from "@/lib/certs/mechanical";
import { staffDisplayNames } from "@/lib/workboard/job-notes-query";
import { TemplatesScreen, type TemplatesProps } from "@/components/admin/templates-screen";

/* TEMPLATES — the SWMS and the Mechanical Compliance Certificate as they are
   written before a job fills them in, in Admin with the business's other
   settings. Anyone signed in can read them, as they could read the two
   template pages these replace; only the owner approves. */

const day = (iso: string) => fmtAuWeekdayDayMonth(auDayOf(iso));

export default async function TemplatesPage({
  searchParams,
}: {
  searchParams: Promise<{ [key: string]: string | string[] | undefined }>;
}) {
  const session = await auth0.getSession();
  if (!session) redirect("/auth/login");
  const orgId = session.orgId as string | undefined;
  if (!orgId) redirect("/dashboard");

  const [role, swms, approvals, owner, params] = await Promise.all([
    getDbRole(),
    libraryApproval(orgId),
    certApprovals(orgId),
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

  const wording: TemplatesProps["wording"] = {
    approved: current ? { by: by(current.approvedById), on: day(current.approvedAt) } : null,
    changed: changed ? [...changed].map((clause) => ({ clause, isNew: !last?.wording?.[clause] })) : null,
    lastApprovedOn: last ? day(last.approvedAt) : null,
    earlier: earlier.map((a) => ({ by: by(a.approvedById), on: day(a.approvedAt) })),
  };
  const sec = params.sec;

  return (
    <TemplatesScreen
      initialSec={typeof sec === "string" ? sec : undefined}
      isOwner={hasMinRole(role, "owner")}
      ownerName={owner}
      swms={swms ? { by: swms.approvedBy, on: day(swms.approvedAt) } : null}
      wording={wording}
    />
  );
}
