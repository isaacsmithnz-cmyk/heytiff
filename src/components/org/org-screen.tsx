"use client";

import Link from "next/link";
import { useState } from "react";
import { Icon } from "@/components/shell/icon";
import { AddressField } from "@/components/address/address-field";
import { IdCard } from "@/components/cards/id-card";
import { CredentialCard } from "@/components/cards/credential-card";
import { SectionCard } from "@/components/profile/section-card";
import { Field, FactRow, Seg, SelectInput, TextInput } from "@/components/profile/fields";
import { auDayOf, formatAuDate } from "@/lib/au-dates";
import { licenceStatus } from "@/lib/staff/licence";
import { orgCredBadge, type OrgCredential, type OrgCredentialInput } from "@/lib/org/credentials";
import { ownerLabel, planLabel, type OrgAccount } from "@/lib/org/account";
import {
  AU_STATES,
  formatAbn,
  formatAcn,
  preValidateOrg,
  type OrgSettings,
} from "@/lib/org/settings";
import { OrgCredentialModal } from "./org-credential-modal";
import { LogoUploader } from "./logo-uploader";
import type { OrgActions } from "./types";

/* The Organisation screen — the company profile.

   THE PAGE HAD TWO SHELLS INSIDE EACH OTHER. `.wrap` is the dashboard's page
   frame (40px of padding, centred at 1500) and `.prof` is the STAFF CARD's
   frame (another 32/40, centred at its own max-width). This screen nested one
   in the other, so the cards were centred inside a box that was itself centred,
   while the `<h1>` stayed at the left edge of the outer one: measured at
   1440px, the heading sat at x=40 and the cards it headed began at x=322, with
   282px of dead page to their right. That is the whole reason the screen did
   not look like the rest of the app — nothing was wrong with the cards.

   It is one shell now, the one its siblings under /dashboard/admin use:
   `.wrap > .stg`, with the Admin breadcrumb those pages all carry and this one
   was missing. `.org-stg` is a little wider than `.adm-stg` because this screen
   has a two-column brand row and a grid of credentials where Tax and the
   integrations have lists.

   WHAT ELSE MOVED.

     THE LOGO IS ON THE SCREEN. It was the last field of the Company identity
     EDIT form — invisible unless you pressed Edit on a card named after
     something else. It is the first card now, beside a live preview of the
     company card it feeds, and it saves on drop.

     THE COMPANY CARD LEFT THE IDENTITY CARD. It was the read view of a section
     whose edit view was six text boxes, so pressing Edit replaced the object
     you were reading with an unrelated form — and it was a 460px card sitting
     in a 780px one with the rest of the row empty. It is the preview in the
     brand row now, next to the logo that changes it, and identity reads as the
     same labelled rows it edits.

     WEBSITE STOPPED BEING AN ORPHAN. It was one lone fact row under the card,
     the only survivor of identity's read view. It is a field among its own.

   The compliance COLUMNS are still gone from this screen: the ARC
   authorisation, the contractor licence and the insurance policy are rows in
   org_credentials (docs/migrations/org_credentials.sql).

   The hints are still gone too. Two lines are allowed to exist and both say
   something their control does not: the State field picks your holiday
   calendar, and the logo goes to customers. */

function identityValues(o: OrgSettings): Record<string, string> {
  return {
    trading_name: o.trading_name ?? "",
    legal_name: o.legal_name ?? "",
    abn: o.abn ?? "",
    acn: o.acn ?? "",
    gst_registered: o.gst_registered === true ? "Yes" : o.gst_registered === false ? "No" : "",
    website: o.website ?? "",
  };
}

function contactValues(o: OrgSettings): Record<string, string> {
  return {
    email: o.email ?? "",
    phone: o.phone ?? "",
    address: o.address ?? "",
    suburb: o.suburb ?? "",
    state: o.state ?? "",
    postcode: o.postcode ?? "",
  };
}

/** Two letters off the trading name, for the card with no logo yet. */
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

export function OrgScreen({
  org,
  credentials,
  account,
  logoUrl,
  today,
  addressLookup = false,
  actions,
}: {
  org: OrgSettings;
  credentials: OrgCredential[];
  /** whose account this is — owner, size, age, plan. Optional so a caller that
      has no session to resolve "is that you" against can leave it out. */
  account?: OrgAccount | null;
  /** signed at render — the bucket is private, so this expires */
  logoUrl: string | null;
  /** AU calendar date, so expiries agree with the dashboard chips */
  today: string;
  /** server-computed Boolean(GOOGLE_MAPS_API_KEY) — the key never comes with it */
  addressLookup?: boolean;
  actions: OrgActions;
}) {
  return (
    <div className="page in">
      <div className="wrap">
        <div className="stg org-stg">
          <div className="v2head" style={{ marginBottom: 26 }}>
            <div>
              <Link href="/dashboard/admin" className="int-back">
                <Icon name="chevL" size={15} />
                Admin
              </Link>
              <h1 style={{ margin: "10px 0 0" }}>Organisation</h1>
            </div>
          </div>

          <BrandSection org={org} logoUrl={logoUrl} actions={actions} />
          <IdentitySection org={org} actions={actions} />
          <ContactSection org={org} addressLookup={addressLookup} actions={actions} />
          <CredentialsSection credentials={credentials} today={today} actions={actions} />
          {account && <AccountSection account={account} />}
        </div>
      </div>
    </div>
  );
}

/* Your business — the logo, and the thing the logo lands on.

   The two halves are one subject: the tile is the only control on the screen
   that changes what a customer sees, and the card beside it is what they see.
   Uploading and then hunting for the result on another card was the arrangement
   this replaces.

   No Edit button, because there is nothing here to hold in a draft — the logo
   writes on drop, and the names it prints are edited on the card below. Same
   bargain the credentials card makes. */
function BrandSection({
  org,
  logoUrl,
  actions,
}: {
  org: OrgSettings;
  logoUrl: string | null;
  actions: OrgActions;
}) {
  const trading = org.trading_name ?? "";
  const gst = org.gst_registered;

  return (
    <div className="card2">
      <div className="c2h">
        <span className="ci">
          <Icon name="hexagon" size={18} />
        </span>
        <span>
          <b>Your business</b>
          <em>How the company appears to a customer</em>
        </span>
      </div>

      <div className="orgbrand">
        <LogoUploader logoUrl={logoUrl} onSet={actions.onSetLogo} onClear={actions.onClearLogo} />

        {/* LIGHT plastic, where a staff card is dark: same object, other side
            of the relationship — the business that issues the cards. And the
            one card with NO issuer line: unset it read "HeyTiff", which on a
            card meant to show a customer whose business this is named the
            platform instead; set to the trading name it printed that name
            twice, once in 10px caps directly above itself in 21px. */}
        <IdCard
          variant="light"
          showIssuer={false}
          badge={{ label: "Company", color: "#2E68FF" }}
          photoUrl={logoUrl}
          initials={orgInitials(trading || org.legal_name || "")}
          name={trading || "Name your business"}
          sub={org.legal_name || "Legal name not set"}
          facts={[
            { em: "ABN", b: formatAbn(org.abn) || "—" },
            { em: "ACN", b: formatAcn(org.acn) || "—" },
            {
              em: "GST",
              b: gst === true ? "Registered" : gst === false ? "Not registered" : "—",
              tone: gst === true ? "ok" : undefined,
            },
          ]}
        />
      </div>
    </div>
  );
}

function IdentitySection({ org, actions }: { org: OrgSettings; actions: OrgActions }) {
  const values = identityValues(org);

  /* Read and edit name the same six things in the same order, which is what
     they did not do before: the read view was a piece of plastic and the edit
     view was these boxes, so pressing Edit moved everything. */
  const read = (
    <div className="ro-rows">
      <FactRow label="Trading name" value={values.trading_name} />
      <FactRow label="Legal name" value={values.legal_name} />
      <FactRow label="ABN" value={formatAbn(values.abn)} />
      <FactRow label="ACN" value={formatAcn(values.acn)} />
      <FactRow
        label="GST"
        value={
          org.gst_registered === true
            ? "Registered"
            : org.gst_registered === false
              ? "Not registered"
              : ""
        }
      />
      <FactRow
        label="Website"
        value={
          values.website ? (
            <a
              className="ro-link"
              href={href(values.website)}
              target="_blank"
              rel="noreferrer noopener"
            >
              {values.website}
            </a>
          ) : (
            ""
          )
        }
      />
    </div>
  );

  return (
    <SectionCard
      icon="fingerprint"
      title="Company identity"
      sub="Who the business is on paper"
      values={values}
      onSave={(fields) => actions.onSave("identity", fields)}
      validate={(fields) => preValidateOrg("identity", fields)}
      read={read}
      edit={({ draft, set, invalid }) => (
        <>
          <div className="frow c2">
            <Field label="Trading name" req>
              <TextInput
                name="trading_name"
                placeholder="e.g. Smith Air Conditioning"
                value={draft.trading_name}
                onChange={(v) => set("trading_name", v)}
              />
            </Field>
            <Field label="Legal name">
              <TextInput
                name="legal_name"
                placeholder="e.g. Smith Air Pty Ltd"
                value={draft.legal_name}
                onChange={(v) => set("legal_name", v)}
              />
            </Field>
          </div>
          <div className="frow c2">
            {/* the checksum is the error, not a caption: a wrong ABN says so
                here, on the field, instead of a line promising it will be
                checked later */}
            <Field label="ABN" error={invalid("abn") ? "That ABN doesn't check out" : null}>
              <TextInput
                name="abn"
                placeholder="e.g. 51 824 753 556"
                value={draft.abn}
                invalid={invalid("abn")}
                onChange={(v) => set("abn", v)}
              />
            </Field>
            <Field label="ACN" error={invalid("acn") ? "An ACN is 9 digits" : null}>
              <TextInput
                name="acn"
                placeholder="9 digits — companies only"
                value={draft.acn}
                invalid={invalid("acn")}
                onChange={(v) => set("acn", v)}
              />
            </Field>
          </div>
          <div className="frow c2">
            <Field label="GST registered">
              <Seg
                value={draft.gst_registered}
                greenValue="Yes"
                options={["Yes", "No"]}
                onChange={(v) => set("gst_registered", v)}
              />
            </Field>
            <Field label="Website">
              <TextInput
                name="website"
                placeholder="e.g. smithair.com.au"
                value={draft.website}
                onChange={(v) => set("website", v)}
              />
            </Field>
          </div>
        </>
      )}
    />
  );
}

function ContactSection({
  org,
  addressLookup,
  actions,
}: {
  org: OrgSettings;
  addressLookup: boolean;
  actions: OrgActions;
}) {
  const values = contactValues(org);
  const place = [values.suburb, values.state, values.postcode].filter(Boolean).join(" ");

  const read = (
    <div className="ro-rows">
      <FactRow
        label="Email"
        value={values.email ? <a className="ro-link" href={`mailto:${values.email}`}>{values.email}</a> : ""}
      />
      <FactRow
        label="Phone"
        value={values.phone ? <a className="ro-link" href={`tel:${values.phone}`}>{values.phone}</a> : ""}
      />
      <FactRow label="Address" value={values.address} />
      <FactRow label="Suburb, state & postcode" value={place} />
    </div>
  );

  return (
    <SectionCard
      icon="phone"
      title="Contact & address"
      sub="Where the business lives & how to reach it"
      values={values}
      onSave={(fields) => actions.onSave("contact", fields)}
      read={read}
      edit={({ draft, set, setMany }) => (
        <>
          <div className="frow c2">
            <Field label="Email">
              <TextInput
                name="email"
                type="email"
                placeholder="e.g. office@smithair.com.au"
                value={draft.email}
                onChange={(v) => set("email", v)}
              />
            </Field>
            <Field label="Phone">
              <TextInput
                name="phone"
                type="tel"
                placeholder="e.g. (03) 9000 0000"
                value={draft.phone}
                onChange={(v) => set("phone", v)}
              />
            </Field>
          </div>
          {/* Pick the address once and the three boxes below fill themselves.
              The STREET line is what stays here — AddressField's onChange puts
              the whole formatted address in first, and onResolve immediately
              narrows it to the street, because suburb / state / postcode have
              their own fields and would otherwise be printed twice. If Google
              found no street line (a suburb-level match), the formatted line is
              better than an empty box.

              setMany, not four sets: one draft update, so a re-render can't
              land between the fields and leave half an address on screen. */}
          <div className="frow">
            <Field label="Street address">
              <AddressField
                name="address"
                placeholder="e.g. 12 Trade Street"
                value={draft.address}
                enabled={addressLookup}
                onChange={(v) => set("address", v)}
                onResolve={(parts, formatted) =>
                  setMany({
                    address: parts.address || formatted,
                    suburb: parts.suburb,
                    state: parts.state,
                    postcode: parts.postcode,
                  })
                }
              />
            </Field>
          </div>
          <div className="frow c3">
            <Field label="Suburb">
              <TextInput
                name="suburb"
                placeholder="e.g. Ringwood"
                value={draft.suburb}
                onChange={(v) => set("suburb", v)}
              />
            </Field>
            {/* the one help line worth keeping: this field does something the
                label doesn't say */}
            <Field label="State" help="Also sets your public-holiday calendar">
              <SelectInput
                name="state"
                placeholder="Select state"
                options={AU_STATES}
                value={draft.state}
                onChange={(v) => set("state", v)}
              />
            </Field>
            <Field label="Postcode">
              <TextInput
                name="postcode"
                placeholder="e.g. 3134"
                value={draft.postcode}
                onChange={(v) => set("postcode", v)}
              />
            </Field>
          </div>
        </>
      )}
    />
  );
}

/* Licences & insurance — data, not an edit cycle.

   There is no Edit / Save / Cancel on this card because there is nothing on it
   to hold in a draft: each card opens its own modal and each write is its own
   action. That is the same bargain the staff Compliance card makes. */
function CredentialsSection({
  credentials,
  today,
  actions,
}: {
  credentials: OrgCredential[];
  today: string;
  actions: OrgActions;
}) {
  // null = closed. A row = editing it; "new" = adding one.
  const [open, setOpen] = useState<OrgCredential | "new" | null>(null);

  const editing = open === "new" ? null : open;

  /* Every write happens inside the modal, so the modal owns the failure too —
     a refusal is shown where the fields are, and only there. Printing it on the
     card as well put the same sentence on the screen twice. */
  const save = (input: OrgCredentialInput) =>
    open && open !== "new"
      ? actions.onUpdateCredential(open.id, input)
      : actions.onAddCredential(input);

  const remove = async () =>
    !open || open === "new" ? { ok: true as const } : actions.onRemoveCredential(open.id);

  return (
    <div className="card2" data-live>
      <div className="c2h">
        <span className="ci">
          <Icon name="shield" size={18} />
        </span>
        <span>
          <b>Licences &amp; insurance</b>
          <em>What lets the business trade</em>
        </span>
      </div>

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
            onOpen={() => setOpen(c)}
          />
        ))}
        <button className="cred-add" type="button" onClick={() => setOpen("new")}>
          <span className="ci">
            <Icon name="plus" size={18} />
          </span>
          <b>Add licence or insurance</b>
          <em>ARC, contractor licence, public liability…</em>
        </button>
      </div>

      {open && (
        <OrgCredentialModal
          credential={editing}
          onSave={save}
          onDelete={editing ? remove : undefined}
          onClose={() => setOpen(null)}
          today={today}
        />
      )}
    </div>
  );
}

/* The account — whose it is, how big, how old, what tier.

   Read-only on purpose, and each fact points at whatever DOES own it rather
   than growing a control here: the team count links to Team, and ownership
   moves through the handover flow. See lib/org/account.ts.

   Last on the page because it is the only card that isn't about the company as
   a customer sees it. */
function AccountSection({ account }: { account: OrgAccount }) {
  return (
    <div className="card2">
      <div className="c2h">
        <span className="ci">
          <Icon name="usershield" size={18} />
        </span>
        <span>
          <b>Account</b>
          <em>Who holds this HeyTiff account</em>
        </span>
      </div>

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
          <b>
            {account.activeStaff} active
          </b>
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
          {/* created_at is a TIMESTAMPTZ, so it goes through auDayOf rather than
              being sliced: every AU state is ahead of UTC, and an evening
              signup sliced in UTC reads a day early. Numeric, to match the
              expiry dates on the card above it. */}
          <b>{account.createdAt ? formatAuDate(auDayOf(account.createdAt)) : "—"}</b>
        </span>

        <span className="orgacct-f">
          <em>Plan</em>
          <b>{planLabel(account.plan)}</b>
        </span>
      </div>
    </div>
  );
}
