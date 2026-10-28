import "server-only";

import { todayInAu } from "@/lib/au-dates";
import { documentsForOrgCredentials, type StoredDocument } from "@/lib/documents/query";
import { fmtDay } from "@/lib/format/day";
import { termFieldsFor, termLabelFor, type OrgCredential } from "@/lib/org/credentials";
import {
  credentialDays,
  credentialState,
  credentialStatusText,
  currentRecord,
  fmtCredMoney,
  looseDocuments,
  recordDocuments,
  type OrgCredentialRecord,
} from "@/lib/org/credential-records";
import { listOrgCredentialRecords, listOrgCredentials, orgExpiryWindow } from "@/lib/org/query";
import { staffProfileIdFor } from "@/lib/fleet/query";
import { licenceStatus } from "@/lib/staff/licence";
import { displayNameOf, fullNameOf } from "@/lib/staff/name";
import { listLicences } from "@/lib/staff/query";
import type { StaffLicence } from "@/lib/staff/types";
import type { MobileCtx } from "@/lib/mobile/auth";
import { supabaseAdmin } from "@/lib/supabase-server";

/* DOCUMENTS ON THE PHONE (Isaac, 29 October 2026, "Yes, build it" on
   https://claude.ai/artifact/Rgp6GfsHjWE6LwQKYVMdgL): what a person is asked
   for on site. The company's papers are Settings › Organisation's licences
   and insurance, each as its term in force reads (lib/org/credential-records),
   with the certificate filed under it; everyone on the team may see and share
   them, as they are handed to builders anyway. What a paper carries is what
   the certificate prints for a builder: who it's with, its number, its cover
   and the day it runs to. Never the premium or the wages. Your licences are
   the ones on your own card in Team, and only yours. The words for a paper or
   licence close to running out are the web's own, on the web's warning days. */

export type PhoneWord = { text: string; tone: "look" | "wrong" };

export type PhonePaper = {
  id: string;
  name: string;
  /** "QBE Insurance (Australia) Ltd, to 10 Nov 2026" */
  line: string;
  word: PhoneWord | null;
  facts: { label: string; value: string }[];
  file: { name: string; url: string; image: boolean; mime: string } | null;
};

export type PhoneLicence = {
  id: string;
  name: string;
  number: string | null;
  color: string | null;
  /** "Runs to 16 Aug 2027", or null for one that doesn't run out */
  runsTo: string | null;
  word: PhoneWord | null;
};

export type PhoneDocuments = {
  company: PhonePaper[];
  licences: PhoneLicence[];
  /** whose licences: the name on the card, and the company's */
  me: string | null;
  org: string | null;
};

const TONE = { warn: "look", bad: "wrong" } as const;

/** The certificate to open: the term's own paper, a PDF before a photo, else
    one filed against the card itself. */
function paperFile(docs: readonly StoredDocument[], records: readonly OrgCredentialRecord[], current: OrgCredentialRecord | null) {
  const pick = (xs: StoredDocument[]) => xs.filter((d) => d.url).sort((a, b) => Number(a.image) - Number(b.image))[0];
  const d = (current && pick(recordDocuments(docs, current))) || pick(looseDocuments(docs, records));
  return d && d.url ? { name: d.fileName, url: d.url, image: d.image, mime: d.mimeType } : null;
}

/** One company paper as the phone reads it. */
export function phonePaper(
  c: OrgCredential,
  records: readonly OrgCredentialRecord[],
  docs: readonly StoredDocument[],
  today: string,
  warnDays: number,
): PhonePaper {
  const r = currentRecord(records);
  const expiry = r?.expiresOn ?? c.expiryDate;
  const state = credentialState(expiry, today, warnDays);
  const word = state === "warn" || state === "bad" ? { text: credentialStatusText(credentialDays(expiry, today)), tone: TONE[state] } : null;
  const issuer = r?.issuer ?? c.issuer;
  const number = r?.number ?? c.number;
  const fields = termFieldsFor(c.kind, c.name);
  const insurance = c.kind === "insurance";
  /* the sum insured is part of what it covers, as the builder asks it */
  const cover = [fields.includes("sumInsured") && r?.sumInsured != null ? fmtCredMoney(r.sumInsured) : null, r?.cover]
    .filter(Boolean)
    .join(", ");
  const facts = [
    issuer && { label: insurance ? "Insurer" : "Issued by", value: issuer },
    number && { label: insurance ? "Policy" : "Licence", value: number },
    cover && { label: termLabelFor(c.kind, c.name, "cover") ?? (insurance ? "Cover" : "Classes"), value: cover },
    fields.includes("workers") && r?.workersCount != null && { label: "Workers", value: String(r.workersCount) },
    expiry && { label: "Runs to", value: fmtDay(expiry) },
  ].filter((f): f is { label: string; value: string } => !!f);
  return {
    id: c.id,
    name: c.name,
    line: [issuer, expiry ? `to ${fmtDay(expiry)}` : null].filter(Boolean).join(", "),
    word,
    facts,
    file: paperFile(docs, records, r),
  };
}

/** One of your licences as the phone shows it. */
export function phoneLicence(l: StaffLicence, today: string, warnDays: number): PhoneLicence {
  const s = licenceStatus(l.expiryDate, today, warnDays);
  return {
    id: l.id,
    name: l.typeName,
    number: l.licenceNumber,
    color: l.color,
    runsTo: l.expiryDate ? `Runs to ${fmtDay(l.expiryDate)}` : null,
    word: s.tone === "warn" || s.tone === "bad" ? { text: s.label, tone: TONE[s.tone] } : null,
  };
}

/** Soonest to run out first; one that never does, last. */
const byExpiry = (a: StaffLicence, b: StaffLicence) =>
  a.expiryDate === b.expiryDate
    ? a.typeName.localeCompare(b.typeName)
    : !a.expiryDate
      ? 1
      : !b.expiryDate
        ? -1
        : a.expiryDate.localeCompare(b.expiryDate);

export async function readPhoneDocuments(ctx: MobileCtx): Promise<PhoneDocuments> {
  const today = todayInAu();
  const [{ warnDays }, creds, records, staffId, { data: org }] = await Promise.all([
    orgExpiryWindow(ctx.orgId),
    listOrgCredentials(ctx.orgId),
    listOrgCredentialRecords(ctx.orgId),
    staffProfileIdFor(ctx.orgId, ctx.userId),
    supabaseAdmin.from("organizations").select("name").eq("id", ctx.orgId).maybeSingle(),
  ]);
  const [docs, licences, { data: card }] = await Promise.all([
    documentsForOrgCredentials(ctx.orgId, creds.map((c) => c.id)),
    staffId ? listLicences(ctx.orgId, staffId) : Promise.resolve([] as StaffLicence[]),
    staffId
      ? supabaseAdmin.from("staff_profiles").select("first_name, last_name, full_name, preferred_name").eq("org_id", ctx.orgId).eq("id", staffId).maybeSingle()
      : Promise.resolve({ data: null }),
  ]);
  /* the name on a licence is the person's own, not what we call them */
  const me = card ? fullNameOf(card) || displayNameOf(card, "") || null : null;
  return {
    /* insurance first: it's what a builder asks for */
    company: [...creds.filter((c) => c.kind === "insurance"), ...creds.filter((c) => c.kind === "licence")].map((c) =>
      phonePaper(c, records[c.id] ?? [], docs.get(c.id) ?? [], today, warnDays),
    ),
    licences: [...licences].sort(byExpiry).map((l) => phoneLicence(l, today, warnDays)),
    me,
    org: (org?.name as string | undefined)?.trim() || null,
  };
}
