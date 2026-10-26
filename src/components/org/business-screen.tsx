"use client";

import Link from "next/link";
import { useState } from "react";
import { Button } from "@/components/parts/button";
import { Chooser, type ChooserOption } from "@/components/parts/chooser";
import { Field, TextInput } from "@/components/parts/field";
import { Initials } from "@/components/parts/initials";
import { Empty } from "@/components/parts/states";
import { Row, RowList } from "@/components/parts/row";
import { StateWord, type Tone } from "@/components/parts/state";
import { Tray } from "@/components/parts/tabs";
import { Switch } from "@/components/parts/tick";
import { AddressField } from "@/components/address/address-field";
import { EditGroup, Facts, Group, SectionTitle, Setting, Wrong, useSelfSave } from "@/components/settings/parts";
import { fmtAuDayMonth, fmtAuWeekdayDayMonth } from "@/lib/au-dates";
import { credentialState, type OrgCredentialRecord } from "@/lib/org/credential-records";
import type { OrgCredential } from "@/lib/org/credentials";
import type { StoredDocument } from "@/lib/documents/query";
import { ownerLabel, type OrgAccount } from "@/lib/org/account";
import type { OwnerCandidate } from "@/lib/org/ownership";
import { DEFAULT_EXPIRY_WARN_DAYS } from "@/lib/expiry";
import {
  AU_STATES,
  formatAbn,
  formatAcn,
  paymentTermsLabel,
  preValidateOrg,
  type OrgSettings,
} from "@/lib/org/settings";
import { CredentialModal, type Screen } from "./credential-modal";
import { TransferOwnerModal } from "./transfer-owner-modal";
import { LogoUploader } from "./logo-uploader";
import { BrandColorPicker } from "./brand-color";
import type { OrgActions } from "./types";

/* SETTINGS › BUSINESS (v2, 25 October 2026; the mock's first board). What
   the business is, on one page: its brand, the details that go on paper,
   how to reach it, its licences and insurance (folded in here, Isaac: "are
   we spreading everything out too much? Let's try and keep it simple"), the
   two settings that are the business's own answers (when an invoice is due,
   how early a paper's expiry is flagged), and whose account it is.

   Three kinds of group (components/settings/parts): typed details with one
   Edit; settings that save on pick; licences as rows, each opening its own
   record. The record and the handover keep their dialogs. */

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

export function BusinessScreen({
  org,
  credentials,
  credentialRecords = {},
  credentialDocuments = {},
  account,
  ownerCandidates = [],
  logoUrl,
  today,
  warnDays,
  addressLookup = false,
  actions,
}: {
  org: OrgSettings;
  credentials: OrgCredential[];
  /** the terms behind each licence, and their paperwork, keyed by its id */
  credentialRecords?: Record<string, OrgCredentialRecord[]>;
  credentialDocuments?: Record<string, StoredDocument[]>;
  /** whose account this is; left out when nobody could resolve it */
  account?: OrgAccount | null;
  /** who the account could go to; loaded only for the master owner */
  ownerCandidates?: OwnerCandidate[];
  /** signed at render; the bucket is private, so it expires */
  logoUrl: string | null;
  /** AU calendar date, so an expiry agrees with the bell */
  today: string;
  /** the business's expiry window, the number the bell uses */
  warnDays: number;
  /** server-computed Boolean(GOOGLE_MAPS_API_KEY); the key never comes with it */
  addressLookup?: boolean;
  actions: OrgActions;
}) {
  return (
    <>
      <SectionTitle>Business</SectionTitle>
      <BrandGroup org={org} logoUrl={logoUrl} actions={actions} />
      <TradingGroup org={org} actions={actions} />
      <ContactGroup org={org} addressLookup={addressLookup} actions={actions} />
      <CredentialsGroup
        credentials={credentials}
        records={credentialRecords}
        documents={credentialDocuments}
        today={today}
        warnDays={warnDays}
        actions={actions}
      />
      <PaymentsGroup org={org} actions={actions} />
      {account && <AccountGroup account={account} candidates={ownerCandidates} onTransfer={actions.onTransferOwnership} />}
    </>
  );
}

/* Brand: the logo and the document colour, the two things here that change
   what a customer is sent. Each saves on pick. How a document looks with
   them is on the templates, one link away. */
function BrandGroup({ org, logoUrl, actions }: { org: OrgSettings; logoUrl: string | null; actions: OrgActions }) {
  return (
    <Group
      heading="Brand"
      tools={
        <Link href="/dashboard/admin/templates" className="st2-link">
          View on templates
        </Link>
      }
    >
      <Setting name="Logo">
        <LogoUploader logoUrl={logoUrl} tone={org.logo_tone ?? null} onSet={actions.onSetLogo} onClear={actions.onClearLogo} />
      </Setting>
      <Setting name="Document colour">
        <BrandColorPicker value={org.brand_color} onSet={actions.onSetBrandColor} onClear={actions.onClearBrandColor} />
      </Setting>
    </Group>
  );
}

const GST: readonly { value: "Yes" | "No"; label: string }[] = [
  { value: "Yes", label: "Registered" },
  { value: "No", label: "Not registered" },
];

/* Trading details: who the business is on paper. Read and edit name the
   same five things in the same order, so pressing Edit moves nothing. */
function TradingGroup({ org, actions }: { org: OrgSettings; actions: OrgActions }) {
  const values = identityValues(org);
  return (
    <EditGroup
      heading="Trading details"
      values={values}
      onSave={(fields) => actions.onSave("identity", fields)}
      validate={(fields) => preValidateOrg("identity", fields)}
      read={
        <Facts
          rows={[
            { label: "Trading name", value: values.trading_name },
            { label: "Legal name", value: values.legal_name },
            { label: "ABN", value: formatAbn(values.abn) },
            { label: "ACN", value: formatAcn(values.acn) },
            { label: "GST", value: GST.find((g) => g.value === values.gst_registered)?.label ?? "" },
          ]}
        />
      }
      edit={({ draft, set, invalid }) => (
        <>
          <div className="st2-fields">
            <Field label="Trading name">
              <TextInput name="trading_name" placeholder="e.g. Smith Air Conditioning" value={draft.trading_name} onChange={(e) => set("trading_name", e.target.value)} />
            </Field>
            <Field label="Legal name">
              <TextInput name="legal_name" placeholder="e.g. Smith Air Pty Ltd" value={draft.legal_name} onChange={(e) => set("legal_name", e.target.value)} />
            </Field>
          </div>
          <div className="st2-fields">
            {/* the checksum is the error, on the field, not a caption promising a check later */}
            <Field label="ABN" error={invalid("abn") ? "That ABN doesn't check out" : null}>
              <TextInput name="abn" placeholder="e.g. 51 824 753 556" value={draft.abn} onChange={(e) => set("abn", e.target.value)} />
            </Field>
            <Field label="ACN" error={invalid("acn") ? "An ACN is 9 digits" : null}>
              <TextInput name="acn" placeholder="Companies only" value={draft.acn} onChange={(e) => set("acn", e.target.value)} />
            </Field>
          </div>
          <div className="st2-fields">
            <Field label="GST">
              <Tray
                ariaLabel="GST"
                options={GST}
                value={(draft.gst_registered || "") as "Yes" | "No"}
                onChange={(v) => set("gst_registered", v)}
              />
            </Field>
          </div>
        </>
      )}
    />
  );
}

const STATE_OPTIONS: ChooserOption[] = AU_STATES.map((s) => ({ value: s, label: s }));

/* Contact: how to reach the business and where it is. The state is part of
   the address, and it is also what picks the public-holiday calendar. */
function ContactGroup({ org, addressLookup, actions }: { org: OrgSettings; addressLookup: boolean; actions: OrgActions }) {
  const values = contactValues(org);
  const place = [values.suburb, values.state, values.postcode].filter(Boolean).join(" ");
  const where = [values.address, place].filter(Boolean).join(", ");
  const site = values.website.startsWith("http") ? values.website : `https://${values.website}`;
  return (
    <EditGroup
      heading="Contact"
      values={values}
      onSave={(fields) => actions.onSave("contact", fields)}
      read={
        <Facts
          rows={[
            { label: "Email", value: values.email && <a className="st2-link" href={`mailto:${values.email}`}>{values.email}</a> },
            { label: "Phone", value: values.phone && <a className="st2-link" href={`tel:${values.phone}`}>{values.phone}</a> },
            {
              label: "Website",
              value: values.website && (
                <a className="st2-link" href={site} target="_blank" rel="noreferrer noopener">
                  {values.website}
                </a>
              ),
            },
            { label: "Address", value: where },
          ]}
        />
      }
      edit={({ draft, set, setMany }) => (
        <>
          <div className="st2-fields">
            <Field label="Email">
              <TextInput name="email" type="email" placeholder="e.g. office@smithair.com.au" value={draft.email} onChange={(e) => set("email", e.target.value)} />
            </Field>
            <Field label="Phone">
              <TextInput name="phone" type="tel" placeholder="e.g. (03) 9000 0000" value={draft.phone} onChange={(e) => set("phone", e.target.value)} />
            </Field>
          </div>
          <div className="st2-fields">
            <Field label="Website">
              <TextInput name="website" placeholder="e.g. smithair.com.au" value={draft.website} onChange={(e) => set("website", e.target.value)} />
            </Field>
          </div>
          {/* Picking a suggestion fills the three below in one draft update;
              the street line keeps only the street, as they have their own. */}
          <div className="st2-fields st2-fields--one">
            <Field label="Street address" id="address">
              <AddressField
                name="address"
                className="pt-input"
                placeholder="e.g. 12 Trade Street"
                value={draft.address}
                enabled={addressLookup}
                onChange={(v) => set("address", v)}
                onResolve={(parts, formatted) =>
                  setMany({ address: parts.address || formatted, suburb: parts.suburb, state: parts.state, postcode: parts.postcode })
                }
              />
            </Field>
          </div>
          <div className="st2-fields st2-fields--three">
            <Field label="Suburb">
              <TextInput name="suburb" placeholder="e.g. Ringwood" value={draft.suburb} onChange={(e) => set("suburb", e.target.value)} />
            </Field>
            <Field label="State">
              <Chooser name="state" placeholder="Choose a state" options={STATE_OPTIONS} value={draft.state || null} onChange={(v) => set("state", v)} />
            </Field>
            <Field label="Postcode">
              <TextInput name="postcode" placeholder="e.g. 3134" value={draft.postcode} onChange={(e) => set("postcode", e.target.value)} />
            </Field>
          </div>
        </>
      )}
    />
  );
}

/* A licence's state as a word in its colour (rule 17): run out is wrong,
   inside the warning window needs a look, further off is good, and no date
   at all is for your information. */
function expiryWord(expiry: string | null, today: string, warnDays: number): { tone: Tone; word: string } {
  const state = credentialState(expiry, today, warnDays);
  if (state === "none" || !expiry) return { tone: "info", word: "No end date" };
  const sameYear = expiry.slice(0, 4) === today.slice(0, 4);
  const day = sameYear ? fmtAuWeekdayDayMonth(expiry) : `${fmtAuDayMonth(expiry)} ${expiry.slice(0, 4)}`;
  if (state === "bad") return { tone: "wrong", word: `Ran out ${day}` };
  return { tone: state === "warn" ? "look" : "good", word: `Runs out ${day}` };
}

/* Licences and insurance: rows, each opening its record, where a renewal is
   filed as a new term and the old one kept. The state word carries the one
   dot; a second at the row's start said it twice (the walk, 26 October). A row that has run out or is
   about to carries Renew, which opens the same record on its update. */
function CredentialsGroup({
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
  const [open, setOpen] = useState<{ credential: OrgCredential | null; screen?: Screen } | null>(null);
  const editing = open?.credential ?? null;
  const openId = editing?.id ?? "";

  const add = (
    <Button kind="second" size={32} onClick={() => setOpen({ credential: null })}>
      Add a licence or policy
    </Button>
  );

  return (
    <Group heading="Licences and insurance" anchor="licences" tools={credentials.length > 0 ? add : undefined}>
      {credentials.length === 0 ? (
        <Empty what="No licences or insurance on file" action={add} />
      ) : (
        <RowList label="Licences and insurance">
          {credentials.map((c) => {
            const { tone, word } = expiryWord(c.expiryDate, today, warnDays);
            const line = [c.issuer, c.number ? `No. ${c.number}` : null].filter(Boolean).join(", ");
            const renew = tone === "look" || tone === "wrong";
            return (
              <Row
                key={c.id}
                name={c.name}
                line={line || undefined}
                onClick={() => setOpen({ credential: c })}
                end={
                  <span className="st2-rowend">
                    <StateWord tone={tone}>{word}</StateWord>
                    {renew && (
                      <Button kind="second" size={32} onClick={() => setOpen({ credential: c, screen: "update" })}>
                        Renew
                      </Button>
                    )}
                  </span>
                }
              />
            );
          })}
        </RowList>
      )}

      {open && (
        <CredentialModal
          key={`${openId || "new"}:${open.screen ?? ""}`}
          credential={editing}
          records={records[openId] ?? []}
          documents={documents[openId] ?? []}
          today={today}
          warnDays={warnDays}
          initialScreen={open.screen}
          onAdd={actions.onAddCredential}
          onSaveIdentity={(input) => (editing ? actions.onUpdateCredential(editing.id, input) : actions.onAddCredential(input))}
          onDelete={() => (editing ? actions.onRemoveCredential(editing.id) : Promise.resolve({ ok: true as const }))}
          onRecord={(input) => (editing ? actions.onRecordTerm(editing.id, input) : Promise.resolve({ ok: true as const }))}
          onAttach={(recordId, documentId, ...details) =>
            editing ? actions.onAttachCredentialDoc(editing.id, recordId, documentId, ...details) : Promise.resolve({ ok: true as const })
          }
          onRemoveTerm={actions.onRemoveTerm}
          onClose={() => setOpen(null)}
        />
      )}
    </Group>
  );
}

/* The answers a business gives once: when an invoice is due (what lets a
   claim on a job say when it's DUE; ServiceM8 mirrors no invoice terms), how
   early anything that expires is flagged, staff tickets, visas, these papers
   and the fleet's alike, and whether that list comes by email each morning.
   Each saves on pick. A value outside the lists (set before they existed)
   stays in its list, so the chooser always shows what's saved. */
const TERMS = [0, 7, 14, 21, 30, 45, 60];
const WARN = [7, 14, 30, 60, 90];

const withSaved = (list: number[], saved: number | null) =>
  saved == null || list.includes(saved) ? list : [...list, saved].sort((a, b) => a - b);

function PaymentsGroup({ org, actions }: { org: OrgSettings; actions: OrgActions }) {
  const { write, error, pending } = useSelfSave((fields) => actions.onSave("preferences", fields));
  const terms = org.payment_terms_days;
  const warn = org.expiry_warn_days ?? DEFAULT_EXPIRY_WARN_DAYS;

  const termOptions: ChooserOption[] = withSaved(TERMS, terms).map((d) => ({ value: String(d), label: paymentTermsLabel(d) }));
  const warnOptions: ChooserOption[] = withSaved(WARN, warn).map((d) => ({ value: String(d), label: `${d} days before` }));

  return (
    <Group heading="Payments and reminders">
      <Setting name="Payment terms">
        <Chooser
          className="st2-choose"
          aria-label="Payment terms"
          placeholder="Choose the terms"
          options={termOptions}
          value={terms == null ? null : String(terms)}
          disabled={pending === "payment_terms_days"}
          onChange={(v) =>
            void write("payment_terms_days", v, terms == null ? "" : String(terms), `Payment terms set to ${paymentTermsLabel(Number(v)).toLowerCase()}`)
          }
        />
      </Setting>
      <Setting name="Warn before papers run out">
        <Chooser
          className="st2-choose"
          aria-label="Warn before papers run out"
          options={warnOptions}
          value={String(warn)}
          disabled={pending === "expiry_warn_days"}
          onChange={(v) => void write("expiry_warn_days", v, String(warn), `Warning ${v} days before`)}
        />
      </Setting>
      <Setting name="Morning email">
        <Switch
          label={<span className="sr-only">Morning email</span>}
          checked={org.expiry_email}
          disabled={pending === "expiry_email"}
          onChange={(on) =>
            void write("expiry_email", on ? "Yes" : "No", org.expiry_email ? "Yes" : "No", on ? "Morning email on" : "Morning email off")
          }
        />
      </Setting>
      {error && <Wrong>{error}</Wrong>}
    </Group>
  );
}

/* Whose account this is, and the one thing to do about it: hand it over.
   Only the master owner may, so only they see the button; the server
   refuses everyone else too. */
function AccountGroup({
  account,
  candidates,
  onTransfer,
}: {
  account: OrgAccount;
  candidates: OwnerCandidate[];
  onTransfer?: OrgActions["onTransferOwnership"];
}) {
  const [handing, setHanding] = useState(false);
  const name = ownerLabel(account);
  return (
    <Group heading="Account">
      <Setting
        name="Owner"
        line={
          <span className="st2-who">
            <Initials name={name} size={24} />
            {account.ownerIsYou ? `${name} (you)` : name}
          </span>
        }
      >
        {account.ownerIsYou && onTransfer && (
          <Button kind="second" size={32} onClick={() => setHanding(true)}>
            Hand over the account
          </Button>
        )}
      </Setting>
      {handing && onTransfer && (
        <TransferOwnerModal candidates={candidates} currentOwnerLabel={name} onTransfer={onTransfer} onClose={() => setHanding(false)} />
      )}
    </Group>
  );
}
