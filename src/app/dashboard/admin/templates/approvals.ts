import { getDbRole } from "@/lib/permissions-server";
import { hasMinRole } from "@/lib/roles-shared";
import { auDayOf, fmtAuWeekdayDayMonth } from "@/lib/au-dates";
import { libraryApproval, ownerName } from "@/lib/swms/query";
import { certApprovals } from "@/lib/certs/query";
import { CERT_LIBRARY_VERSION, changedSince } from "@/lib/certs/mechanical";
import { staffDisplayNames } from "@/lib/workboard/job-notes-query";
import type { ApprovalProps, PaperApproval } from "@/components/admin/approved-templates";

/* WHERE THE TWO APPROVED TEMPLATES STAND — read once for the list (which
   says whether each waits for the owner) and for each one's page. */

export type TemplateApprovals = ApprovalProps & { swms: PaperApproval };

const day = (iso: string) => fmtAuWeekdayDayMonth(auDayOf(iso));

export async function templateApprovals(orgId: string): Promise<TemplateApprovals> {
  const [role, swms, approvals, owner] = await Promise.all([getDbRole(), libraryApproval(orgId), certApprovals(orgId), ownerName(orgId)]);
  const names = await staffDisplayNames(orgId, approvals.map((a) => a.approvedById));
  const by = (id: string) => names.get(id) ?? "Unnamed";

  /* this version's approval, and the last one before it to compare with */
  const current = approvals.find((a) => a.version === CERT_LIBRARY_VERSION) ?? null;
  const earlier = approvals.filter((a) => a !== current);
  const last = earlier[0] ?? null;
  const changed = current ? null : changedSince(last?.wording ?? null);

  return {
    isOwner: hasMinRole(role, "owner"),
    ownerName: owner,
    swms: swms ? { by: swms.approvedBy, on: day(swms.approvedAt) } : null,
    wording: {
      approved: current ? { by: by(current.approvedById), on: day(current.approvedAt) } : null,
      changed: changed ? [...changed].map((clause) => ({ clause, isNew: !last?.wording?.[clause] })) : null,
      lastApprovedOn: last ? day(last.approvedAt) : null,
      earlier: earlier.map((a) => ({ by: by(a.approvedById), on: day(a.approvedAt) })),
    },
  };
}
