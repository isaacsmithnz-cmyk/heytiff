"use client";

import { EXPIRY_WARN_ERROR } from "@/lib/expiry";
import Link from "next/link";
import { useState } from "react";
import { flushSync } from "react-dom";
import { Icon } from "@/components/shell/icon";
import { ViewTabs } from "@/components/shell/view-tabs";
import { AddressField } from "@/components/address/address-field";
import { CredentialCard } from "@/components/cards/credential-card";
import { SectionCard } from "@/components/profile/section-card";
import { Field, SelectInput, Seg, TextInput } from "@/components/profile/fields";
import { auDayOf, formatAuDate } from "@/lib/au-dates";
import { licenceStatus } from "@/lib/staff/licence";
import { ORG_CRED_KINDS, orgCredBadge, type OrgCredential } from "@/lib/org/credentials";
import { credentialState, type OrgCredentialRecord } from "@/lib/org/credential-records";
import type { StoredDocument } from "@/lib/documents/query";
import { ownerLabel, planLabel, type OrgAccount } from "@/lib/org/account";
import type { OwnerCandidate } from "@/lib/org/ownership";
import {
  AU_STATES,
  formatAbn,
  formatAcn,
  expiryEmailLabel,
  expiryWarnLabel,
  paymentTermsLabel,
  PAYMENT_TERMS_ERROR,
  preValidateOrg,
  type OrgSettings,
} from "@/lib/org/settings";
import { CredentialModal } from "./credential-modal";
import { TransferOwnerModal } from "./transfer-owner-modal";
import { LogoUploader } from "./logo-uploader";
import { BrandColorPicker } from "./brand-color";
import { ORG_TABS, orgTabFromParam, type OrgTabKey } from "./tabs";
import type { OrgActions, TransferResult } from "./types";

/* The Organisation screen — the company profile, on the Workboard's card.

   One row of tabs joined to ONE persistent white card, the shape the Workboard
   and the staff card wear: `.wb2-vtabs` above `.wb2-card`, with the strip, the
   measured thumb, the keyboard walk and the view transition all
   `shell/view-tabs` and `.wb2-card` — borrowed, not copied.

   FOUR TABS. Company opens first and is the screen's own summary: titled
   groups stacked down it, each one rows of label and value — Brand (the logo
   and colour, which save on pick), Trading details and Contact (each its own
   Edit). Preferences is the knobs. Licences & insurance and Account are as
   they were. There is no Overview: it restated five tabs and the first tab
   is now the thing it summarised.

   WHAT A DOCUMENT LOOKS LIKE IS NOT ON THIS SCREEN. The templates draw every
   document with the letterhead on it, which is where a logo is checked against
   a white page and a dark bar; Brand links there rather than carrying a second,
   drifting copy.

   `?sec=` is written back with history.replaceState (not a router push) so a
   refresh or a shared link lands on the same tab without a navigation, and the
   server reads it from its own searchParams — no useSearchParams, so no
   Suspense boundary around the page. The four tabs that merged into Company
   still resolve to it (see tabs.ts).

   The compliance COLUMNS are gone from this screen: the ARC authorisation, the
   contractor licence and the insurance policy are rows in org_credentials
   (docs/migrations/org_credentials.sql).

   The hints are gone too. One line is allowed to exist and it says something
   its control does not: the State field picks your holiday calendar. */

function identityValues(o: OrgSettings): Record<string, string> {
  return {
    trading_name: o.trading_name ?? "",
    legal_name: o.legal_name ?? "",
    abn: o.abn ?? "",
    acn: o.acn ?? "",
    gst_registered: o.gst_registered === true ? "Yes" : o.gst_registered === false ? "No" : "",
  };
}

function contactValues(o: OrgSettings): Record<string, string> {
  return {
    email: o.email ?? "",
    phone: o.phone ?? "",
    website: o.website ?? "",
    address: o.address ?? "",
    suburb: o.suburb ?? "",
    state: o.state ?? "",
    postcode: o.postcode ?? "",
  };
}

export function OrgScreen({
  org,
  credentials,
  credentialRecords = {},
  credentialDocuments = {},
  account,
  ownerCandidates = [],
  logoUrl,
  today,
  warnDays,
  initialSec,
  addressLookup = false,
  actions,
}: {
  org: OrgSettings;
  credentials: OrgCredential[];
  /* The terms behind the cards, their paperwork, and the viewer's own
     — all keyed by credential id, all loaded once for the wall
     rather than per card. Defaulted so a caller that only wants the company
     profile (a test, the welcome flow) need not supply three empty maps. */
  credentialRecords?: Record<string, OrgCredentialRecord[]>;
  credentialDocuments?: Record<string, StoredDocument[]>;
  /** whose account this is — owner, size, age, plan. Optional so a caller that
      has no session to resolve "is that you" against can leave it out. */
  account?: OrgAccount | null;
  /** Everyone else in the org with a login — who the account could be handed
      to. Loaded only for the master owner, because nobody else may. */
  ownerCandidates?: OwnerCandidate[];
  /** signed at render — the bucket is private, so this expires */
  logoUrl: string | null;
  /** AU calendar date, so expiries agree with the dashboard chips */
  today: string;
  /** The org's expiry window — the same number the dashboard chips use, so
      a card can never say "Valid" about a policy the bell is warning on. */
  warnDays: number;
  /** from the page's own searchParams, so a shared link opens the right tab */
  initialSec?: string;
  /** server-computed Boolean(GOOGLE_MAPS_API_KEY) — the key never comes with it */
  addressLookup?: boolean;
  actions: OrgActions;
}) {
  /* An account nobody could resolve gets no tab, never an empty one — same
     rule the staff card's admin sections follow, and it is what keeps the
     strip and the Overview panel agreeing about what exists. */
  const available = ORG_TABS.filter((t) => t.key !== "account" || !!account);

  const [tab, setTab] = useState<OrgTabKey>(() => {
    const wanted = orgTabFromParam(initialSec);
    return wanted && available.some((t) => t.key === wanted) ? wanted : "company";
  });

  /* The board's switch: the information swaps, the surface stays. `.wb2-card`
     carries `view-transition-name: wbcard`, so the box morphs while the
     outgoing panel drifts up and the incoming rises. No View Transitions
     support and the panel simply re-keys with the same vertical entrance. */
  const [fallbackSwap, setFallbackSwap] = useState(0);

  const go = (key: OrgTabKey) => {
    const doc = document as Document & { startViewTransition?: (cb: () => void) => void };
    if (key !== tab && typeof doc.startViewTransition === "function") {
      doc.startViewTransition(() => flushSync(() => setTab(key)));
    } else {
      setTab(key);
      if (key !== tab) setFallbackSwap((n) => n + 1);
    }

    if (typeof window !== "undefined") {
      const url = new URL(window.location.href);
      url.searchParams.set("sec", key);
      // replaceState, not router.push: this is which section you're looking
      // at, not a navigation — a push would re-run the server render and
      // remount the very cards this screen exists to keep still.
      window.history.replaceState(null, "", url.toString());
    }
    document.querySelector(".outlet")?.scrollTo({ top: 0 });
  };

  return (
    /* Paper to the frame, the title in the tab band, and the way back to
       Admin on its own line above it (2026-09-20). The 1,040px cap goes with
       the grey: the point of the frame is the screen. */
    <div className="page in full">
      <div className="wrap">
        {/* `orgcard2` rides the stage itself, as `pcard2` does on the staff
            card: the full frame scrolls the PANEL, which only works if every
            box between `.stg` and `.wb2-card` is in its flex column. A block
            wrapper here let the card grow past the screen, and the outlet,
            which no longer scrolls, clipped everything under the fold. */}
        <div className="stg orgcard2">
          <div className="wb2-crumbline">
            <Link href="/dashboard/admin" className="int-back">
              <Icon name="chevL" size={15} />
              Admin
            </Link>
          </div>
          <ViewTabs
            lead={<h1 className="wb2-h1">Organisation</h1>}
            ariaLabel="Organisation sections"
            idPrefix="orgtab"
            panelPrefix="orgsec"
            active={tab}
            onGo={(k) => go(k as OrgTabKey)}
            items={available.map((t) => ({ key: t.key, label: t.label }))}
          />

          <div className="wb2-card">
            <div className="wb2-panel"><div className="ppanel2">
              {/* Keyed for `fallbackSwap`, the recovery remount — NOT for an
                  animation any more. `.psec2` used to fade the panel in on
                  every switch; it stopped when Isaac asked for this card to
                  match Team's, which just changes its children. The remount
                  itself is invisible: React swaps it in one commit. */}
              <section
                key={`${tab}#${fallbackSwap}`}
                id={`orgsec-${tab}`}
                role="tabpanel"
                aria-labelledby={`orgtab-${tab}`}
                tabIndex={-1}
                className="psec2"
                data-sec={tab}
              >
                {tab === "company" && (
                  <div className="orgco">
                    <BrandSection org={org} logoUrl={logoUrl} actions={actions} />
                    <TradingSection org={org} actions={actions} />
                    <ContactSection org={org} addressLookup={addressLookup} actions={actions} />
                  </div>
                )}
                {tab === "preferences" && (
                  <div className="orgco">
                    <PaymentsSection org={org} actions={actions} />
                    <ExpirySection org={org} actions={actions} />
                  </div>
                )}
                {tab === "credentials" && (
                  <CredentialsSection
                    credentials={credentials}
                    records={credentialRecords}
                    documents={credentialDocuments}
                    today={today}
                    warnDays={warnDays}
                    actions={actions}
                  />
                )}
                {tab === "account" && account && (
                  <AccountSection
                    account={account}
                    candidates={ownerCandidates}
                    onTransfer={actions.onTransferOwnership}
                  />
                )}
              </section>
            </div></div>
          </div>
        </div>
      </div>
    </div>
  );
}

/* Brand — the logo and the document colour: the two things on this screen
   that change what a customer is sent.

   No Edit button, because there is nothing here to hold in a draft — each
   control writes on pick, and a row of two in a card with an Edit would
   promise a Save that neither needs. The way to SEE what they do is the
   templates, one link away. */
function BrandSection({
  org,
  logoUrl,
  actions,
}: {
  org: OrgSettings;
  logoUrl: string | null;
  actions: OrgActions;
}) {
  return (
    <div className="pdlcard">
      <div className="pdlh jump">
        <span>Brand</span>
        <Link href="/dashboard/admin/templates" className="jumpb">
          View on templates
        </Link>
      </div>
      <dl className="pdl split orgbrand">
        <div className="pdrow">
          <dt>Logo</dt>
          <dd>
            <LogoUploader
              logoUrl={logoUrl}
              tone={org.logo_tone ?? null}
              onSet={actions.onSetLogo}
              onClear={actions.onClearLogo}
            />
          </dd>
        </div>
        <div className="pdrow">
          <dt>Document colour</dt>
          <dd>
            <BrandColorPicker
              value={org.brand_color}
              onSet={actions.onSetBrandColor}
              onClear={actions.onClearBrandColor}
            />
          </dd>
        </div>
      </dl>
    </div>
  );
}

/* Trading details — who the business is on paper: the names it trades and is
   registered under, and the numbers that go beside them on an invoice.

   Read and edit name the same five things in the same order, which is what a
   card has to do or pressing Edit moves everything. Payment terms and the
   expiry window used to sit here; they are the business's settings rather than
   its registration, and live on Preferences. */
function TradingSection({ org, actions }: { org: OrgSettings; actions: OrgActions }) {
  const values = identityValues(org);

  const read = (
    <dl className="pdl split">
      <Row label="Trading name" value={values.trading_name} />
      <Row label="Legal name" value={values.legal_name} />
      <Row label="ABN" value={formatAbn(values.abn)} />
      <Row label="ACN" value={formatAcn(values.acn)} />
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
    </dl>
  );

  return (
    <SectionCard
      variant="group"
      title="Trading details"
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
          </div>
        </>
      )}
    />
  );
}

/* Contact — how to reach the business, and where it is. The website is here
   with the email and phone because it prints on the same line of the
   letterhead, and the state is here because it is part of the address it picks
   the public-holiday calendar from. */
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
  // one row: the street and the place read as the single address they are
  const where = [values.address, place].filter(Boolean).join(", ");

  const read = (
    <dl className="pdl split">
      <Row
        label="Email"
        value={
          values.email ? (
            <a className="ro-link" href={`mailto:${values.email}`}>
              {values.email}
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
          values.phone ? (
            <a className="ro-link" href={`tel:${values.phone}`}>
              {values.phone}
            </a>
          ) : (
            ""
          )
        }
      />
      <Row
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
        small
      />
      <Row label="Address" value={where} small />
    </dl>
  );

  return (
    <SectionCard
      variant="group"
      title="Contact"
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
          <div className="frow c2">
            <Field label="Website">
              <TextInput
                name="website"
                placeholder="e.g. smithair.com.au"
                value={draft.website}
                onChange={(v) => set("website", v)}
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

/* Payments — the business's own answer to "when is an invoice due", and the
   one number that answers it. It is what lets a raised claim on the job card
   say when it is DUE; ServiceM8 mirrors no invoice terms, so this is the only
   place it can come from. */
function PaymentsSection({ org, actions }: { org: OrgSettings; actions: OrgActions }) {
  const values = {
    payment_terms_days: org.payment_terms_days === null ? "" : String(org.payment_terms_days),
  };

  return (
    <SectionCard
      variant="group"
      title="Payments"
      values={values}
      onSave={(fields) => actions.onSave("preferences", fields)}
      validate={(fields) => preValidateOrg("preferences", fields)}
      read={
        <dl className="pdl split">
          <Row label="Payment terms" value={paymentTermsLabel(org.payment_terms_days)} />
        </dl>
      }
      edit={({ draft, set, invalid }) => (
        <div className="frow c2">
          {/* The unit is IN THE LABEL, not under the box: a caption explaining
              a field is a field that didn't explain itself. "0" is a real
              answer and the placeholder says so. */}
          <Field
            label="Payment terms (days)"
            error={invalid("payment_terms_days") ? PAYMENT_TERMS_ERROR : null}
          >
            <TextInput
              name="payment_terms_days"
              placeholder="e.g. 14 — or 0 for on receipt"
              value={draft.payment_terms_days}
              invalid={invalid("payment_terms_days")}
              onChange={(v) => set("payment_terms_days", v)}
            />
          </Field>
        </div>
      )}
    />
  );
}

/* Expiry warnings — ONE NUMBER FOR EVERYTHING THAT EXPIRES: staff tickets,
   visas, the business's own papers, rego, vehicle insurance, green slip, a
   service-by date. It replaced six hard-coded 30s and the per-card Remind me
   buttons (issue #640). The unit is in the label, as it is for payment terms. */
function ExpirySection({ org, actions }: { org: OrgSettings; actions: OrgActions }) {
  const values = {
    expiry_warn_days: String(org.expiry_warn_days),
    expiry_email: org.expiry_email ? "Yes" : "No",
  };

  return (
    <SectionCard
      variant="group"
      title="Expiry warnings"
      values={values}
      onSave={(fields) => actions.onSave("preferences", fields)}
      validate={(fields) => preValidateOrg("preferences", fields)}
      read={
        <dl className="pdl split">
          <Row label="Warn before" value={expiryWarnLabel(org.expiry_warn_days)} />
          <Row label="Morning email" value={expiryEmailLabel(org.expiry_email)} />
        </dl>
      }
      edit={({ draft, set, invalid }) => (
        <div className="frow c2">
          <Field
            label="Warn before an expiry (days)"
            error={invalid("expiry_warn_days") ? EXPIRY_WARN_ERROR : null}
          >
            <TextInput
              name="expiry_warn_days"
              placeholder="e.g. 30"
              value={draft.expiry_warn_days}
              invalid={invalid("expiry_warn_days")}
              onChange={(v) => set("expiry_warn_days", v)}
            />
          </Field>
          <Field label="Email the morning list">
            <Seg
              value={draft.expiry_email}
              greenValue="Yes"
              options={["Yes", "No"]}
              onChange={(v) => set("expiry_email", v)}
            />
          </Field>
        </div>
      )}
    />
  );
}

/* Licences & insurance — data, not an edit cycle.

   There is no Edit / Save / Cancel on this tab because there is nothing on it
   to hold in a draft: each card opens its own modal and each write is its own
   action. That is the same bargain the staff Compliance tab makes.

   WHAT CHANGED. The wall used to be one flat grid and the modal behind it a
   six-field form, so a renewal overwrote the term before it. The cards are
   grouped by kind now and each one says how many terms it has on file — the
   history is the point, so it has to be visible from the outside — and the
   modal is the fleet's vehicle card: scan the certificate, check what Tiff
   read, save a NEW term, keep the old one.

   THE SUMMARY LINE IS ONE NUMBER, not four. What an owner opening this tab
   wants to know is whether anything is about to lapse; the cards answer
   everything else. */
function CredentialsSection({
  credentials,
  records,
  documents,
  today,
  warnDays,
  actions,
}: {
  credentials: OrgCredential[];
  records: Record<string, OrgCredentialRecord[]>;
  documents: Record<string, StoredDocument[]>;
  today: string;
  warnDays: number;
  actions: OrgActions;
}) {
  // null = closed. A row = opened on it; "new" = adding one.
  const [open, setOpen] = useState<OrgCredential | "new" | null>(null);

  const editing = open === "new" ? null : open;
  const openId = editing?.id ?? "";

  const groups = ORG_CRED_KINDS.map((kind) => ({
    kind,
    label: kind === "licence" ? "Licences" : "Insurance",
    rows: credentials.filter((c) => c.kind === kind),
  })).filter((g) => g.rows.length > 0);

  /* The one number: how many cards are inside the warning window or already
     past it. Counted from the same rule the cards' own status chips use, so
     the headline can never disagree with the wall under it. */
  const attention = credentials.filter((c) => {
    const state = credentialState(c.expiryDate, today, warnDays);
    return state === "warn" || state === "bad";
  }).length;

  return (
    <div className="psec-body" data-live>
      {/* ADD IS IN THE HEADER, not at the end of the wall. It was a dashed
          tile in a `.credgrid` of its own below the groups, which put the one
          control on the tab underneath every card — and, with a single group
          on screen, made it look like a third insurance card that had lost its
          heading. `.psechd` was built with an `.acts` slot for exactly this and
          the Account tab two sections down already uses it, so this is the
          panel's own furniture rather than a new one. */}
      <div className="psechd">
        {/* the one line that earns its place is the figure (law 15) */}
        {attention > 0 && <em>{attention === 1 ? "1 needs attention" : `${attention} need attention`}</em>}
        <span className="acts">
          <button className="pbtn ghost" type="button" onClick={() => setOpen("new")}>
            <Icon name="plus" size={14} />
            Add licence or insurance
          </button>
        </span>
      </div>

      {credentials.length === 0 && (
        <div className="ro-empty" style={{ marginTop: 18 }}>
          <span className="ei">
            <Icon name="shield" size={20} />
          </span>
          <b>Nothing on file</b>
          <em>ARC authorisations, contractor licences and policies are added here.</em>
        </div>
      )}

      {groups.map((g) => (
        <div key={g.kind} className="credgroup">
          <span className="credgroup-h">{g.label}</span>
          <div className="credgrid">
            {g.rows.map((c) => {
              const terms = records[c.id]?.length ?? 0;
              return (
                <CredentialCard
                  key={c.id}
                  typeName={c.name}
                  licenceNumber={c.number}
                  issuer={c.issuer}
                  expiry={c.expiryDate ? formatAuDate(c.expiryDate) : null}
                  status={licenceStatus(c.expiryDate, today, warnDays)}
                  badge={orgCredBadge(c)}
                  note={terms > 1 ? `${terms} terms on file` : terms === 1 ? "1 term on file" : undefined}
                  onOpen={() => setOpen(c)}
                />
              );
            })}
          </div>
        </div>
      ))}

      {open && (
        <CredentialModal
          key={openId || "new"}
          credential={editing}
          records={records[openId] ?? []}
          documents={documents[openId] ?? []}
          today={today}
                      warnDays={warnDays}
          onAdd={actions.onAddCredential}
          onSaveIdentity={(input) =>
            editing ? actions.onUpdateCredential(editing.id, input) : actions.onAddCredential(input)
          }
          onDelete={() => (editing ? actions.onRemoveCredential(editing.id) : Promise.resolve({ ok: true as const }))}
          onRecord={(input) =>
            editing ? actions.onRecordTerm(editing.id, input) : Promise.resolve({ ok: true as const })
          }
          onAttach={(recordId, documentId, ...details) =>
            editing
              ? actions.onAttachCredentialDoc(editing.id, recordId, documentId, ...details)
              : Promise.resolve({ ok: true as const })
          }
          onRemoveTerm={actions.onRemoveTerm}
          onClose={() => setOpen(null)}
        />
      )}
    </div>
  );
}

/* The account — whose it is, how big, how old, what tier.

   ONE CONTROL, and it is the reason this tab is no longer purely a statement:
   the account can be HANDED OVER from here. Everything else still points at
   whatever owns it — the team count links to Team, the plan is billing, and
   the owner's name and email come from the identity provider (see
   lib/org/account.ts for why editing them here would be erased at next login).

   The handover button exists only for the master owner. A co-owner reading
   this tab sees the same four facts and no button, rather than a control that
   would answer "only the account owner can do that" — the server refuses them
   too, so this is about not offering, not about security.

   Last tab because it is the only one that isn't about the company as a
   customer sees it. */
function AccountSection({
  account,
  candidates,
  onTransfer,
}: {
  account: OrgAccount;
  candidates: OwnerCandidate[];
  onTransfer?: (userId: string) => Promise<TransferResult>;
}) {
  const [handing, setHanding] = useState(false);
  const mayHand = account.ownerIsYou && !!onTransfer;

  return (
    <div className="psec-body">
      <div className="psechd">
        <em>Who holds this HeyTiff account</em>
        {mayHand && (
          <span className="acts">
            <button className="pbtn ghost" type="button" onClick={() => setHanding(true)}>
              <Icon name="usershield" size={14} />
              Hand over
            </button>
          </span>
        )}
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
          <b>{account.activeStaff} active</b>
          <i>
            {account.totalStaff === account.activeStaff
              ? "on the books"
              : `of ${account.totalStaff} on the books`}
            {", "}
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
              expiry dates on the tab above it. */}
          <b>{account.createdAt ? formatAuDate(auDayOf(account.createdAt)) : "—"}</b>
        </span>

        <span className="orgacct-f">
          <em>Plan</em>
          <b>{planLabel(account.plan)}</b>
        </span>
      </div>

      {handing && onTransfer && (
        <TransferOwnerModal
          candidates={candidates}
          currentOwnerLabel={ownerLabel(account)}
          onTransfer={onTransfer}
          onClose={() => setHanding(false)}
        />
      )}
    </div>
  );
}

/* A read row: the same `.pdrow` shape the panels above use, so a section's read
   view and the Overview panel that summarises it are the same object. Blank is
   a dash — pressing Edit is what fills it, and it is one button away. */
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
