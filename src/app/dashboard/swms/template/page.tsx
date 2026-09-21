import Link from "next/link";
import { ScreenBand, ScreenPanel } from "@/components/shell/screen-band";
import { redirect } from "next/navigation";
import { auth0 } from "@/lib/auth0";
import { getDbRole } from "@/lib/permissions-server";
import { hasMinRole } from "@/lib/roles-shared";
import { auDayOf, fmtAuWeekdayDayMonth } from "@/lib/au-dates";
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
  /* the app's own day, like every other SWMS screen — only paper takes a year */
  const when = approval ? fmtAuWeekdayDayMonth(auDayOf(approval.approvedAt)) : null;

  return (
    /* Paper to the frame, the title in the band and the way back on its own
       line above it (2026-09-20). Who approved it, and when, follows the band:
       it is a fact about the template rather than a subtitle of the screen. */
    <div className="page in full">
      <div className="wrap">
        <div className="stg">
          <ScreenBand
            crumb={
              <Link className="sws-back" href="/dashboard">
                ← Home
              </Link>
            }
            title="SWMS template"
          />
          <ScreenPanel>
          <div className="sws">
            <p className="sws-lede">
              {approval
                ? `Approved by ${approval.approvedBy} on ${when}. Every SWMS is written from these steps.`
                : isOwner
                  ? "Read the steps and controls, then approve them at the end. No SWMS can be issued until you do."
                  : `${owner ?? "The owner"} approves the template before the first SWMS can be issued.`}
            </p>
            <div className="sws-grp">
              <TemplateSteps />
            </div>
            {!approval && isOwner && (
              <div className="sws-actions">
                <ApproveTemplate />
              </div>
            )}
          </div>
          </ScreenPanel>
        </div>
      </div>
    </div>
  );
}
