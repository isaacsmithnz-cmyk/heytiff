import Link from "next/link";
import { redirect } from "next/navigation";
import { ScreenBand, ScreenPanel } from "@/components/shell/screen-band";
import { auth0 } from "@/lib/auth0";
import { getDbRole } from "@/lib/permissions-server";
import { hasMinRole } from "@/lib/roles-shared";
import { auDayOf, fmtAuWeekdayDayMonth } from "@/lib/au-dates";
import { ownerName } from "@/lib/swms/query";
import { certApproval } from "@/lib/certs/query";
import { wordingSamples } from "@/lib/certs/mechanical";
import { ApproveWording } from "@/components/certs/approve-wording";
import "@/components/swms/swms.css";

/* THE CERTIFICATE WORDING — every statement a certificate can make, as it
   prints, and when it is made. Anyone signed in can read it; only the owner
   approves it, and until they do no certificate can be issued. A new wording
   version needs approving again (lib/certs/mechanical, CERT_LIBRARY_VERSION). */
export default async function CertificateWordingPage() {
  const session = await auth0.getSession();
  const orgId = session?.orgId as string | undefined;
  if (!orgId) redirect("/dashboard");

  const [approval, role, owner] = await Promise.all([certApproval(orgId), getDbRole(), ownerName(orgId)]);
  const isOwner = hasMinRole(role, "owner");
  const when = approval ? fmtAuWeekdayDayMonth(auDayOf(approval.approvedAt)) : null;

  return (
    <div className="page in full">
      <div className="wrap">
        <div className="stg">
          <ScreenBand
            crumb={
              <Link className="sws-back" href="/dashboard">
                Home
              </Link>
            }
            title="Certificate wording"
          />
          <ScreenPanel>
            <div className="sws">
              <p className="sws-lede">
                {approval
                  ? `Approved by ${approval.approvedBy} on ${when}. Every certificate is written from these statements.`
                  : isOwner
                    ? "Read every statement, then approve them at the end. No certificate can be issued until you do."
                    : `${owner ?? "The owner"} approves the wording before the first certificate can be issued.`}
              </p>
              {wordingSamples().map((w) => (
                <div key={w.clause} className="sws-grp">
                  <div className="sw-gh">
                    <b>{w.name}</b>
                    <span>{w.when}</span>
                  </div>
                  {w.texts.map((t) => (
                    <p key={t} className="sw-text">
                      {t}
                    </p>
                  ))}
                </div>
              ))}
              <div className="sws-grp">
                <div className="sw-gh">
                  <b>On every certificate</b>
                </div>
                <p className="sw-text">Not covered: electrical work, certified separately under AS/NZS 3000.</p>
                <p className="sw-note">A requirement that no statement answers is written by the person issuing, and prints as they typed it.</p>
              </div>
              {!approval && isOwner && (
                <div className="sws-actions">
                  <ApproveWording />
                </div>
              )}
            </div>
          </ScreenPanel>
        </div>
      </div>
    </div>
  );
}
