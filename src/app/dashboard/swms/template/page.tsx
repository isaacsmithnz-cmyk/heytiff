import Link from "next/link";
import { redirect } from "next/navigation";
import { auth0 } from "@/lib/auth0";
import { getDbRole } from "@/lib/permissions-server";
import { hasMinRole } from "@/lib/roles-shared";
import { auDayOf, fmtAuWeekdayDate } from "@/lib/au-dates";
import { libraryApproval, ownerName } from "@/lib/swms/query";
import { TemplateSteps } from "@/components/swms/template-steps";
import { ApproveTemplate } from "@/components/swms/approve-template";
import "@/components/swms/swms.css";

/* THE SWMS TEMPLATE — where the owner's "Approve the SWMS template" lands.

   Anyone signed in can read it: it is the business's own method, and a crew
   lead who wants to know what a SWMS will say should be able to look. Only
   the owner approves it, and until they do, no SWMS can be issued. */
export default async function SwmsTemplatePage() {
  const session = await auth0.getSession();
  const orgId = session?.orgId as string | undefined;
  if (!orgId) redirect("/dashboard");

  const [approval, role, owner] = await Promise.all([libraryApproval(orgId), getDbRole(), ownerName(orgId)]);
  const isOwner = hasMinRole(role, "owner");
  const when = approval ? fmtAuWeekdayDate(auDayOf(approval.approvedAt)) : null;

  return (
    <div className="page in">
      <div className="wrap">
        <div className="stg">
          <div className="sws">
            <div className="sws-head">
              <Link className="sws-back" href="/dashboard">
                ← Home
              </Link>
              <h1>SWMS template</h1>
              <p>
                {approval
                  ? `Approved by ${approval.approvedBy} on ${when}. Every SWMS is written from these steps.`
                  : isOwner
                    ? "Read the steps and controls, then approve them at the end. No SWMS can be issued until you do."
                    : `${owner ?? "The owner"} approves the template before the first SWMS can be issued.`}
              </p>
            </div>
            <div className="card2 sws-read">
              <TemplateSteps />
            </div>
            {!approval && isOwner && (
              <div className="sws-actions">
                <ApproveTemplate />
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
