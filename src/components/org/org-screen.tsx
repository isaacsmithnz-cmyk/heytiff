"use client";

import Link from "next/link";
import { useState } from "react";
import { flushSync } from "react-dom";
import { Icon } from "@/components/shell/icon";
import { ViewTabs } from "@/components/shell/view-tabs";
import { AddressField } from "@/components/address/address-field";
import { IdCard } from "@/components/cards/id-card";
import { CredentialCard } from "@/components/cards/credential-card";
import { SectionCard } from "@/components/profile/section-card";
import { Field, SelectInput, Seg, TextInput } from "@/components/profile/fields";
import { auDayOf, formatAuDate } from "@/lib/au-dates";
import { licenceStatus } from "@/lib/staff/licence";
import { orgCredBadge, type OrgCredential, type OrgCredentialInput } from "@/lib/org/credentials";
import { ownerLabel, planLabel, type OrgAccount } from "@/lib/org/account";
import type { OwnerCandidate } from "@/lib/org/ownership";
import {
  AU_STATES,
  formatAbn,
  formatAcn,
  preValidateOrg,
  type OrgSettings,
} from "@/lib/org/settings";
import { OrgCredentialModal } from "./org-credential-modal";
import { TransferOwnerModal } from "./transfer-owner-modal";
import { LogoUploader } from "./logo-uploader";
import { OverviewTab } from "./overview-tab";
import { ORG_TABS, orgTabFromParam, type OrgTabKey } from "./tabs";
import type { OrgActions, TransferResult } from "./types";

/* The Organisation screen — the company profile, on the Workboard's card.

   WHAT IT IS NOW. One row of tabs joined to ONE persistent white card, exactly
   the shape the Workboard and the staff card already wear: `.wb2-vtabs` above
   `.wb2-card`, with the thumb that IS the card's top edge for the width of the
   live tab. Switching tabs swaps the information; the surface stays put.

   It was five stacked `.card2`s — the whole company down one scroll, each
   section wearing its own frame, its own icon and its own headline. Nothing was
   wrong with any single card; there was just no altitude anywhere on the page.
   You could not glance at the business, and you could not get to the one field
   you came for without reading past four sections that were not it.

   SO OVERVIEW LEADS AND READS. It is the whole company at a glance and the only
   tab with nothing to save — one panel per tab below it, each one the tab's own
   name with the jump into it. Every tab after Overview edits exactly one thing.

   The strip, the measured thumb, the keyboard walk and the view transition are
   all `shell/view-tabs` and `.wb2-card` — borrowed, not copied. The staff card
   made the same borrow and its comment says why: fixing either one twice was
   the alternative.

   `?sec=` is written back with history.replaceState (not a router push) so a
   refresh or a shared link lands on the same tab without a navigation, and the
   server reads it from its own searchParams — no useSearchParams, so no
   Suspense boundary around the page.

   WHAT DID NOT CHANGE. The sections themselves: the same SectionCards saving
   the same two allowlisted groups, the same credential modal, the same logo
   uploader writing on drop. They wear `variant="section"` now — no frame, no
   repeated title, because the TAB is the title (see section-card).

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

export function OrgScreen({
  org,
  credentials,
  account,
  ownerCandidates = [],
  logoUrl,
  today,
  initialSec,
  addressLookup = false,
  actions,
}: {
  org: OrgSettings;
  credentials: OrgCredential[];
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
    return wanted && available.some((t) => t.key === wanted) ? wanted : "overview";
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

          <div className="orgcard2">
            <ViewTabs
              ariaLabel="Organisation sections"
              idPrefix="orgtab"
              panelPrefix="orgsec"
              active={tab}
              onGo={(k) => go(k as OrgTabKey)}
              items={available.map((t) => ({ key: t.key, label: t.label }))}
            />

            <div className="wb2-card">
              <div className="ppanel2">
                {/* keyed on the tab so the panel's entrance animation replays */}
                <section
                  key={`${tab}#${fallbackSwap}`}
                  id={`orgsec-${tab}`}
                  role="tabpanel"
                  aria-labelledby={`orgtab-${tab}`}
                  tabIndex={-1}
                  className="psec2"
                  data-sec={tab}
                >
                  {tab === "overview" && (
                    <OverviewTab
                      org={org}
                      credentials={credentials}
                      account={account}
                      logoUrl={logoUrl}
                      today={today}
                      onGo={go}
                    />
                  )}
                  {tab === "brand" && (
                    <BrandSection org={org} logoUrl={logoUrl} actions={actions} />
                  )}
                  {tab === "identity" && <IdentitySection org={org} actions={actions} />}
                  {tab === "contact" && (
                    <ContactSection org={org} addressLookup={addressLookup} actions={actions} />
                  )}
                  {tab === "credentials" && (
                    <CredentialsSection
                      credentials={credentials}
                      today={today}
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
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

/* Your business — the logo, and the thing the logo lands on.

   The two halves are one subject: the tile is the only control on the screen
   that changes what a customer sees, and the card beside it is what they see.
   Uploading and then hunting for the result on another tab was the arrangement
   this replaces.

   No Edit button, because there is nothing here to hold in a draft — the logo
   writes on drop, and the names it prints are edited on Company identity. Same
   bargain the credentials tab makes. */
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
    <div className="psec-body">
      <div className="psechd">
        <em>How the company appears to a customer</em>
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

/* Company identity — who the business is on paper.

   Read and edit name the same six things in the same order, which is what they
   did not do before: the read view was a piece of plastic and the edit view was
   these boxes, so pressing Edit moved everything. The plastic is on Your
   business now, where the logo that changes it is. */
function IdentitySection({ org, actions }: { org: OrgSettings; actions: OrgActions }) {
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
    </dl>
  );

  return (
    <SectionCard
      variant="section"
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
      <Row label="Address" value={values.address} small />
      <Row label="Suburb, state & postcode" value={place} small />
    </dl>
  );

  return (
    <SectionCard
      variant="section"
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

   There is no Edit / Save / Cancel on this tab because there is nothing on it
   to hold in a draft: each card opens its own modal and each write is its own
   action. That is the same bargain the staff Compliance tab makes. */
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
    <div className="psec-body" data-live>
      <div className="psechd">
        <em>What lets the business trade</em>
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
