import Link from "next/link";
import { redirect } from "next/navigation";
import { ScreenBand, ScreenPanel } from "@/components/shell/screen-band";
import { auth0 } from "@/lib/auth0";
import { getDbRole } from "@/lib/permissions-server";
import { hasMinRole } from "@/lib/roles-shared";
import { auDayOf, fmtAuWeekdayDayMonth } from "@/lib/au-dates";
import { ownerName } from "@/lib/swms/query";
import { certApproval } from "@/lib/certs/query";
import { staffDisplayNames } from "@/lib/workboard/job-notes-query";
import { CERT_LEDE, DEFAULT_CERT_ANSWERS, NOT_APPLICABLE, notCoveredLine, wordingSamples } from "@/lib/certs/mechanical";
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

  const [approval, role] = await Promise.all([certApproval(orgId), getDbRole()]);
  const isOwner = hasMinRole(role, "owner");
  /* who approved it, or who will: each read only when it's shown */
  const [names, owner] = await Promise.all([
    approval ? staffDisplayNames(orgId, [approval.approvedById]) : null,
    !approval && !isOwner ? ownerName(orgId) : null,
  ]);
  const approvedBy = approval ? (names?.get(approval.approvedById) ?? "Unnamed") : null;
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
                  ? `Approved by ${approvedBy} on ${when}. Every certificate is written from these statements.`
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
                  <b>Around the statements</b>
                  <span>The first on every certificate; the other two only when there is something to say</span>
                </div>
                <p className="sw-text">{CERT_LEDE}</p>
                <p className="sw-text">{`${NOT_APPLICABLE} [what was asked]: [the reason given]`}</p>
                <p className="sw-text">{notCoveredLine({ ...DEFAULT_CERT_ANSWERS, notCoveredExtra: "[what the person typed]" })}</p>
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
