"use client";

import { useState } from "react";
import { Icon } from "@/components/shell/icon";
import { IdCard } from "@/components/cards/id-card";
import { CredentialCard } from "@/components/cards/credential-card";
import { SectionCard } from "@/components/profile/section-card";
import { Field, FactRow, Seg, SelectInput, TextInput } from "@/components/profile/fields";
import { formatAuDate } from "@/lib/au-dates";
import { licenceStatus } from "@/lib/staff/licence";
import { orgCredBadge, type OrgCredential, type OrgCredentialInput } from "@/lib/org/credentials";
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

/* The Organisation screen — the company profile, on the staff card's machinery.

   WHAT CHANGED, BEYOND BEING REACT. The old screen was an HTML string with
   three cards, and the third one ("Licences & insurance") was five text boxes:
   one ARC authorisation, one contractor licence, one insurance policy. A
   business with two policies had nowhere to put the second. Those are rows now,
   and the section below is a wall of credential cards you click to edit —
   the same plastic the staff card carries, for the company's own papers.

   The hints went with it. "Shown across HeyTiff — including under the logo" and
   "Checked against the ATO checksum on save" described the software to itself;
   the one help line that survives is the State field's, because it says
   something the field does NOT otherwise say: it picks your holiday calendar.
   A rejected ABN now marks the ABN box, which is what the removed sentence was
   really trying to promise. */

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

export function OrgScreen({
  org,
  credentials,
  logoUrl,
  today,
  actions,
}: {
  org: OrgSettings;
  credentials: OrgCredential[];
  /** signed at render — the bucket is private, so this expires */
  logoUrl: string | null;
  /** AU calendar date, so expiries agree with the dashboard chips */
  today: string;
  actions: OrgActions;
}) {
  return (
    <div className="page in">
      <div className="wrap">
        <div className="stg">
          <div className="v2head" style={{ marginBottom: 22 }}>
            <div>
              <h1
                style={{
                  fontSize: 44,
                  fontWeight: 800,
                  letterSpacing: "-0.03em",
                  margin: 0,
                }}
              >
                Organisation
              </h1>
            </div>
          </div>

          <div className="prof" style={{ maxWidth: 860 }}>
            <IdentitySection org={org} logoUrl={logoUrl} actions={actions} />
            <ContactSection org={org} actions={actions} />
            <CredentialsSection credentials={credentials} today={today} actions={actions} />
          </div>
        </div>
      </div>
    </div>
  );
}

function IdentitySection({
  org,
  logoUrl,
  actions,
}: {
  org: OrgSettings;
  logoUrl: string | null;
  actions: OrgActions;
}) {
  const values = identityValues(org);
  const trading = values.trading_name;
  const gst = org.gst_registered;

  const read = (
    <>
      {/* LIGHT plastic, where a staff card is dark: same object, other side of
          the relationship — the business that issues the cards. */}
      <IdCard
        variant="light"
        badge={{ label: "Company", color: "#2E68FF" }}
        photoUrl={logoUrl}
        initials={orgInitials(trading || org.legal_name || "")}
        name={trading || "Name your business"}
        sub={values.legal_name || "Trading name not set"}
        facts={[
          { em: "ABN", b: formatAbn(values.abn) || "—" },
          { em: "ACN", b: formatAcn(values.acn) || "—" },
          {
            em: "GST",
            b: gst === true ? "Registered" : gst === false ? "Not registered" : "—",
            tone: gst === true ? "ok" : undefined,
          },
        ]}
      />
      <div className="ro-rows">
        <FactRow
          label="Website"
          value={
            values.website ? (
              <a
                className="ro-link"
                href={values.website.startsWith("http") ? values.website : `https://${values.website}`}
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
    </>
  );

  return (
    <SectionCard
      icon="hexagon"
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
          <div className="frow">
            <Field label="Logo">
              <LogoUploader
                logoUrl={logoUrl}
                onSet={actions.onSetLogo}
                onClear={actions.onClearLogo}
              />
            </Field>
          </div>
        </>
      )}
    />
  );
}

function ContactSection({ org, actions }: { org: OrgSettings; actions: OrgActions }) {
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
      edit={({ draft, set }) => (
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
          {/* address autocomplete lands here (PR 11) */}
          <div className="frow">
            <Field label="Street address">
              <TextInput
                name="address"
                placeholder="e.g. 12 Trade Street"
                value={draft.address}
                onChange={(v) => set("address", v)}
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
          <em>
            What lets the business trade — each one tracks its number and expiry, and warns on the
            dashboard before it lapses
          </em>
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
        />
      )}
    </div>
  );
}
