"use client";

import Link from "next/link";
import { Icon } from "@/components/shell/icon";
import { CredentialCard } from "@/components/cards/credential-card";
import { DetailPanel, DetailPanels } from "@/components/profile/detail";
import { auDayOf, formatAuDate } from "@/lib/au-dates";
import { licenceStatus } from "@/lib/staff/licence";
import { orgCredBadge, type OrgCredential } from "@/lib/org/credentials";
import { ownerLabel, planLabel, type OrgAccount } from "@/lib/org/account";
import { formatAbn, formatAcn, type OrgSettings } from "@/lib/org/settings";
import type { OrgTabKey } from "./tabs";

/* Overview — the landing tab, and the only one that reads rather than edits.

   It is the staff card's Summary, holding a business instead of a person, and
   it is built on the same two rules.

   ONE PANEL PER TAB, in tab order, named the same. Each panel's heading IS the
   tab it summarises and carries the same "Open ›" jump, so the whole screen is
   drivable from here without reading the strip — and the overview can never
   describe a section differently from the section itself.

   IF THE LOCKUP SAYS IT, A PANEL DOESN'T. The logo, the trading name and the
   legal name are at the top, so Company identity opens on the ABN rather than
   repeating the two names directly beneath themselves. It is the same reason
   the staff card's Personal panel opens on Date of birth.

   `Your business` gets no panel of its own: what that tab holds is the logo
   and the plastic card it lands on, and both are already the lockup above —
   a panel would be a third copy of the same picture.

   Blanks are DASHES. Nothing here is editable, so a blank has no button behind
   it and nothing to say beyond "nothing"; a column of "Not set" reads as an
   error state rather than as a company someone hasn't finished filling in. */
export function OverviewTab({
  org,
  credentials,
  account,
  logoUrl,
  today,
  onGo,
}: {
  org: OrgSettings;
  credentials: OrgCredential[];
  account?: OrgAccount | null;
  /** signed at render — the bucket is private, so this expires */
  logoUrl: string | null;
  /** AU calendar date, so expiries agree with the dashboard chips */
  today: string;
  onGo: (key: OrgTabKey) => void;
}) {
  const trading = org.trading_name ?? "";
  const place = [org.suburb, org.state, org.postcode].filter(Boolean).join(" ");

  return (
    <>
      <div className="pident orgident">
        <div className="pphoto">
          {logoUrl ? (
            /* decorative: the trading name is right beside it in 30px. A
               signed, expiring URL into a private bucket — next/image would
               want it in its own allowlist and would re-fetch it server-side,
               which is why every logo and photo on this app is a plain <img>. */
            // eslint-disable-next-line @next/next/no-img-element
            <img className="inn logo" src={logoUrl} alt="" />
          ) : (
            <span className="inn">{orgInitials(trading || org.legal_name || "")}</span>
          )}
        </div>

        <div className="phid">
          <h2>{trading || "Name your business"}</h2>
          <div className="sub">
            <span>{org.legal_name || "Legal name not set"}</span>
          </div>
        </div>
      </div>

      <DetailPanels>
        <DetailPanel title="Company identity" onOpen={() => onGo("identity")}>
          <Row label="ABN" value={formatAbn(org.abn)} />
          <Row label="ACN" value={formatAcn(org.acn)} />
          <Row
            label="GST"
            value={
              org.gst_registered === true
                ? "Registered"
                : org.gst_registered === false
                  ? "Not registered"
                  : ""
            }
          />
          <Row
            label="Website"
            value={
              org.website ? (
                <a
                  className="ro-link"
                  href={href(org.website)}
                  target="_blank"
                  rel="noreferrer noopener"
                >
                  {org.website}
                </a>
              ) : (
                ""
              )
            }
            small
          />
        </DetailPanel>

        <DetailPanel title="Contact & address" onOpen={() => onGo("contact")}>
          <Row
            label="Email"
            value={
              org.email ? (
                <a className="ro-link" href={`mailto:${org.email}`}>
                  {org.email}
                </a>
              ) : (
                ""
              )
            }
            small
          />
          <Row
            label="Phone"
            value={
              org.phone ? (
                <a className="ro-link" href={`tel:${org.phone}`}>
                  {org.phone}
                </a>
              ) : (
                ""
              )
            }
          />
          <Row label="Address" value={org.address} small />
          <Row label="Suburb, state & postcode" value={place} small />
        </DetailPanel>

        {/* The credentials are CARDS, not rows — they are things you carry in a
            wallet, and the same object the Licences tab issues them as. Across
            the bottom at full width because the expiries side by side are the
            fastest read of "what is this business licensed to do" on the
            screen. Not clickable here: this tab reads, and the heading's jump
            is the way to the one that edits them. */}
        <DetailPanel
          title="Licences & insurance"
          wide
          plain
          onOpen={() => onGo("credentials")}
        >
          {credentials.length === 0 ? (
            <div className="ro-empty">
              <span className="ei">
                <Icon name="shield" size={20} />
              </span>
              <b>Nothing on file</b>
              <em>ARC authorisations, contractor licences and policies are added here.</em>
            </div>
          ) : (
            <div className="credgrid">
              {credentials.map((c) => (
                <CredentialCard
                  key={c.id}
                  typeName={c.name}
                  licenceNumber={c.number}
                  issuer={c.issuer}
                  expiry={c.expiryDate ? formatAuDate(c.expiryDate) : null}
                  status={licenceStatus(c.expiryDate, today)}
                  badge={orgCredBadge(c)}
                />
              ))}
            </div>
          )}
        </DetailPanel>

        {account && (
          <DetailPanel title="Account" wide plain onOpen={() => onGo("account")}>
            <div className="orgacct">
              <span className="orgacct-f">
                <em>Primary owner</em>
                <b>
                  {ownerLabel(account)}
                  {account.ownerIsYou && <span className="orgacct-you">You</span>}
                </b>
                {account.ownerEmail && <i>{account.ownerEmail}</i>}
              </span>

              <span className="orgacct-f">
                <em>Team</em>
                <b>{account.activeStaff} active</b>
                <i>
                  {account.totalStaff === account.activeStaff
                    ? "on the books"
                    : `of ${account.totalStaff} on the books`}
                  {" · "}
                  <Link className="ro-link" href="/dashboard/team">
                    Team
                  </Link>
                </i>
              </span>

              <span className="orgacct-f">
                <em>With HeyTiff since</em>
                <b>{account.createdAt ? formatAuDate(auDayOf(account.createdAt)) : "—"}</b>
              </span>

              <span className="orgacct-f">
                <em>Plan</em>
                <b>{planLabel(account.plan)}</b>
              </span>
            </div>
          </DetailPanel>
        )}
      </DetailPanels>
    </>
  );
}

/** Two letters off the trading name, for the business with no logo yet. */
function orgInitials(name: string): string {
  const words = name.trim().split(/\s+/).filter(Boolean);
  if (words.length === 0) return "—";
  return words
    .slice(0, 2)
    .map((w) => w[0]!.toUpperCase())
    .join("");
}

/** A website as typed, made clickable — people write it without the scheme. */
function href(site: string): string {
  return site.startsWith("http") ? site : `https://${site}`;
}

/** An overview row: a value, or the dash that means we don't hold one. */
function Row({
  label,
  value,
  small,
}: {
  label: string;
  value?: React.ReactNode;
  small?: boolean;
}) {
  const empty = value === null || value === undefined || value === "";
  return (
    <div className="pdrow">
      <dt>{label}</dt>
      <dd>
        {empty ? (
          <span className="pdnone" aria-label="not recorded">
            —
          </span>
        ) : (
          <span className={small ? "pdv sm" : "pdv"}>{value}</span>
        )}
      </dd>
    </div>
  );
}
