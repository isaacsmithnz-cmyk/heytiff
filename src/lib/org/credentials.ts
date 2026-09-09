import { parseAuDate } from "@/lib/au-dates";
import { credBadgeCode, type CredBadge } from "@/lib/staff/licence";

/* The BUSINESS's licences and insurance policies — pure rules.

   Deliberately the same shape as lib/staff/licence.ts, because it is the same
   problem one level up: a thing with a number, an issuer and an expiry, which
   the dashboard warns about before it lapses. What changed is that these used
   to be five flat columns on `organizations` — one ARC authorisation, one
   contractor licence, one insurance policy, and nowhere to put a second one.
   They are rows now (docs/migrations/org_credentials.sql), so a business can
   hold three policies and four licences without the schema arguing.

   Pure module: no I/O, client-importable, so the modal runs the very same
   validator the action runs and a bad date never leaves the browser. */

export const ORG_CRED_KINDS = ["licence", "insurance"] as const;
export type OrgCredKind = (typeof ORG_CRED_KINDS)[number];

export function isCredKind(v: unknown): v is OrgCredKind {
  return typeof v === "string" && (ORG_CRED_KINDS as readonly string[]).includes(v);
}

/** One row, as the screen reads it. */
export type OrgCredential = {
  id: string;
  kind: OrgCredKind;
  name: string;
  number: string | null;
  issuer: string | null;
  /** ISO yyyy-mm-dd, or null for something that doesn't expire */
  expiryDate: string | null;
  color: string | null;
};

/* The types worth NAMING — the ones nearly every HVAC business holds, so they
   arrive spelled and coloured consistently instead of as four spellings of
   "ARC". Everything else is free text: the registry is a set of suggestions and
   a badge lookup, never an allowlist. */
/* WHICH OF A TERM'S OPTIONAL FACTS THIS PAPER ACTUALLY CARRIES.

   `issuer`, `number`, `startsOn` and `expiresOn` are on every certificate ever
   printed, so they are not listed — these are the four that are NOT universal,
   and showing one the document cannot have is worse than a blank box. It tells
   a person the paper in their hand is missing something.

   A workers compensation policy is the case that proved it: the cover is
   statutory and uncapped, so "Limit of liability" and "Excess" sat empty on
   every one of them, on a screen where an empty limit on a PUBLIC LIABILITY
   policy means the business cannot prove what a head contractor asked for. */
export type TermField = "cover" | "sumInsured" | "premium" | "excess" | "workers" | "wages";

const KIND_FIELDS: Record<OrgCredKind, readonly TermField[]> = {
  /* An unnamed policy could be anything, so it is offered the general set —
     but NOT the two workers compensation facts. Those are not "insurance"
     facts a broad policy might happen to print; they are the two numbers the
     scheme rates a workers comp premium on, and offering them on a public
     liability certificate would be the same mistake as a limit on a workers
     comp one, pointing the other way. */
  insurance: ["cover", "sumInsured", "premium", "excess"],
  // a licence has no sum insured and no excess; a fee is a real thing to keep
  licence: ["cover", "premium"],
};

export type OrgCredType = {
  kind: OrgCredKind;
  name: string;
  /** the 2–3 letter stamp on the card */
  code: string;
  color: string;
  sub?: string;
  /** Narrows the kind's default set. Absent = the kind's own. */
  fields?: readonly TermField[];
  /** What THIS paper calls a field, where its own word beats the kind's. */
  labels?: Partial<Record<TermField, string>>;
};

export const ORG_CRED_TYPES: readonly OrgCredType[] = [
  {
    kind: "licence",
    name: "ARC refrigerant trading authorisation",
    code: "ARC",
    color: "#00A389",
    sub: "The business authorisation — staff ARC licences live on their own cards",
  },
  {
    kind: "licence",
    name: "Contractor licence",
    code: "CL",
    color: "#F0A431",
    sub: "State-issued trade licence",
  },
  { kind: "insurance", name: "Public liability", code: "INS", color: "#2E68FF" },
  { kind: "insurance", name: "Professional indemnity", code: "INS", color: "#2E68FF" },
  {
    kind: "insurance",
    name: "Workers compensation",
    code: "INS",
    color: "#2E68FF",
    /* No limit and no excess. The employer's liability under the state Act is
       the full amount and is not capped, so a certificate of currency prints
       neither — icare's does not, and nor does any other scheme insurer's.

       What it DOES print, and what a head contractor is told on the
       certificate itself to check, is the worker count and the declared wages
       (docs/migrations/org_credential_workers_comp.sql quotes the wording). */
    fields: ["cover", "workers", "wages", "premium"],
    /* "Cover" is boilerplate here — every NSW certificate covers the same
       statutory liability — and the line that actually varies is the industry
       classification the premium is rated under, which the certificate also
       tells principals to confirm. So the box keeps the column and changes
       its name to the thing worth typing into it. */
    labels: { cover: "Industry classification" },
  },
];

const INSURANCE_BADGE: CredBadge = { code: "INS", color: "#2E68FF" };

const HEX = /^#[0-9a-fA-F]{3,8}$/;

/** The names offered under the name box — suggestions, not a closed list. */
export function credSuggestions(kind: OrgCredKind): string[] {
  return ORG_CRED_TYPES.filter((t) => t.kind === kind).map((t) => t.name);
}

function typeFor(kind: OrgCredKind, name: string): OrgCredType | undefined {
  const wanted = name.trim().toLowerCase();
  return ORG_CRED_TYPES.find((t) => t.kind === kind && t.name.toLowerCase() === wanted);
}

/* The badge in a card's top-right corner.

   A registry hit wins, then the kind's default (every insurance reads INS in
   the same blue, so a wall of policies is scannable), then the staff card's own
   initialling rule — which already knows "ARC" and "CL" and gives anything
   custom its initials. A stored colour always beats the derived one: it is the
   only cosmetic choice the modal offers, so it has to stick. */
export function orgCredBadge(cred: {
  kind: OrgCredKind;
  name: string;
  color?: string | null;
}): CredBadge {
  const stored = (cred.color ?? "").trim();
  const base =
    typeFor(cred.kind, cred.name) ??
    (cred.kind === "insurance" ? INSURANCE_BADGE : credBadgeCode(cred.name));
  const badge: CredBadge = { code: base.code, color: base.color };
  return HEX.test(stored) ? { ...badge, color: stored } : badge;
}

/** The facts this particular paper carries, narrowed by name where the
    registry knows better than the kind. A name it does not know keeps the
    kind's full set — a guess that hides a box is worse than one that shows an
    empty one. */
export function termFieldsFor(kind: OrgCredKind, name: string): readonly TermField[] {
  return typeFor(kind, name)?.fields ?? KIND_FIELDS[kind];
}

/** This paper's own word for a field, where it has one. */
export function termLabelFor(kind: OrgCredKind, name: string, field: TermField): string | null {
  return typeFor(kind, name)?.labels?.[field] ?? null;
}

/** The colour a newly-picked name suggests, or "" for a custom one. */
export function defaultColorFor(kind: OrgCredKind, name: string): string {
  return typeFor(kind, name)?.color ?? (kind === "insurance" ? INSURANCE_BADGE.color : "");
}

export type OrgCredentialInput = {
  kind: string;
  name: string;
  number?: string;
  issuer?: string;
  /** dd/mm/yyyy, or the ISO a picker emits; blank for no expiry. */
  expiryDate?: string;
  color?: string;
};

/** What actually goes in the table. */
export type OrgCredentialRow = {
  kind: OrgCredKind;
  name: string;
  number: string | null;
  issuer: string | null;
  expiry_date: string | null;
  color: string | null;
};

/** Validate + normalise one credential for insert/update, or say why not.
    Mirrors buildLicenceRow — same caps, same date rule, same colour rule. */
export function buildOrgCredentialRow(
  input: OrgCredentialInput
): { row: OrgCredentialRow } | { error: string } {
  if (!isCredKind(input.kind)) {
    return { error: "Choose whether this is a licence or an insurance policy." };
  }

  const name = (input.name ?? "").trim();
  if (!name) return { error: "Give this licence or policy a name." };

  let expiry: string | null = null;
  const rawExpiry = (input.expiryDate ?? "").trim();
  if (rawExpiry) {
    const iso = parseAuDate(rawExpiry);
    if (!iso) return { error: "Check the expiry date — use dd/mm/yyyy." };
    expiry = iso;
  }

  const number = (input.number ?? "").trim();
  const issuer = (input.issuer ?? "").trim();
  const color = (input.color ?? "").trim();

  return {
    row: {
      kind: input.kind,
      name: name.slice(0, 120),
      number: number ? number.slice(0, 80) : null,
      issuer: issuer ? issuer.slice(0, 120) : null,
      expiry_date: expiry,
      color: HEX.test(color) ? color : null,
    },
  };
}

/* Licences before insurance, then soonest expiry, then name. The order is
   decided here rather than in SQL so the grid is the same wherever the rows
   come from, and so it can be tested without a database. */
export function sortOrgCredentials(rows: readonly OrgCredential[]): OrgCredential[] {
  const rank = (k: OrgCredKind) => (k === "licence" ? 0 : 1);
  return [...rows].sort((a, b) => {
    if (a.kind !== b.kind) return rank(a.kind) - rank(b.kind);
    // no expiry sorts last: it is never the thing about to lapse
    if (a.expiryDate !== b.expiryDate) {
      if (!a.expiryDate) return 1;
      if (!b.expiryDate) return -1;
      return a.expiryDate < b.expiryDate ? -1 : 1;
    }
    return a.name.localeCompare(b.name);
  });
}
