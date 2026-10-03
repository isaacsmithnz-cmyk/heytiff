/* Customer details in ServiceM8 — the decisions, pure (customer details to
   ServiceM8).

   The job card's customer dialog saves as a set of record changes, each its
   own queued row (kind "customer"), each to one ServiceM8 record:

     jobcontact  a person on the job, with their role: added (under a uuid
                 chosen when the row was queued), changed, or removed
     company     the client's (or site's) name and address, changed
     job         the job's billing address, changed

   Paths, fields and scopes read off ServiceM8's reference on 2026-10-03:
   jobcontact.json and jobcontact/{uuid}.json (manage_job_contacts; DELETE
   sets active to 0), company/{uuid}.json (manage_customers; `name`
   required on an update), job/{uuid}.json (manage_jobs; `status` required
   on an update, so the sender reads it live and sends it back unchanged).
   Updates change only the fields sent.

   ONE ROW PER RECORD PER SAVE (sm8_writes' dedupe_key):
   customer:<the dialog's press id>:<object>:<record uuid>. */

import { CUSTOMER_WORDS } from "./sm8-customer-words";

export { CUSTOMER_WORDS };

export type CustomerObject = "jobcontact" | "company" | "job";
export type CustomerOp = "create" | "update" | "delete";

/** A job contact's roles, as ServiceM8 stores them, and the words for each. */
export const CONTACT_ROLES = [
  { type: "JOB", word: "Job contact" },
  { type: "BILLING", word: "Billing contact" },
  { type: "Site Contact", word: "Site contact" },
  { type: "Property Manager", word: "Property manager" },
  { type: "Property Owner", word: "Property owner" },
  { type: "Tenant", word: "Tenant" },
] as const;

export const roleWord = (type: string | null | undefined): string =>
  CONTACT_ROLES.find((r) => r.type.toLowerCase() === (type ?? "").trim().toLowerCase())?.word ?? (type?.trim() || "Contact");

/** The fields each record may have changed by HeyTiff, and nothing else. */
export const CUSTOMER_FIELDS: Record<CustomerObject, readonly string[]> = {
  jobcontact: ["first", "last", "mobile", "phone", "email", "type"],
  company: ["name", "address"],
  job: ["billing_address"],
};

export const customerSubject = (pressId: string, object: CustomerObject, uuid: string) => `customer:${pressId}:${object}:${uuid.toLowerCase()}`;

export type FormContact = { uuid: string | null; first: string; last: string; mobile: string; phone: string; email: string; type: string };

/** What the dialog holds: the job, its client or site, the billing address
    and the job's contacts. */
export type CustomerForm = {
  jobUuid: string;
  company: { uuid: string; name: string; address: string } | null;
  billingAddress: string | null;
  contacts: FormContact[];
};

export type CustomerChange = {
  object: CustomerObject;
  op: CustomerOp;
  /** the record changed or removed; null for a contact to be added */
  uuid: string | null;
  fields: Record<string, string>;
  label: string;
};

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const MAX: Record<string, number> = { first: 60, last: 60, mobile: 40, phone: 40, email: 200, type: 40, name: 100, address: 500, billing_address: 500 };

const clean = (k: string, v: string) => {
  const t = k === "address" || k === "billing_address" ? v.replace(/\r\n/g, "\n").trim() : v.replace(/\s+/g, " ").trim();
  return t.slice(0, MAX[k] ?? 200);
};

const personName = (c: Pick<FormContact, "first" | "last">) => [c.first, c.last].map((s) => s.trim()).filter(Boolean).join(" ") || "Someone";
const fill = (s: string, name: string) => s.replace("{name}", name);

/** The changes between what the dialog opened with and what it saves, or
    why it can't be saved. */
export function customerChanges(before: CustomerForm, after: CustomerForm): { ok: true; changes: CustomerChange[] } | { ok: false; error: string } {
  if (before.jobUuid !== after.jobUuid || !UUID.test(after.jobUuid)) return { ok: false, error: CUSTOMER_WORDS.press.unqueued };
  const changes: CustomerChange[] = [];

  if (before.company && after.company && before.company.uuid === after.company.uuid) {
    const name = clean("name", after.company.name);
    const address = clean("address", after.company.address);
    if (!name) return { ok: false, error: "The customer needs a name." };
    const fields: Record<string, string> = {};
    if (name !== clean("name", before.company.name)) fields.name = name;
    if (address !== clean("address", before.company.address)) fields.address = address;
    if (Object.keys(fields).length > 0) changes.push({ object: "company", op: "update", uuid: after.company.uuid, fields, label: fill(CUSTOMER_WORDS.label.client, name) });
  }

  const billing = clean("billing_address", after.billingAddress ?? "");
  if (after.billingAddress !== null && billing !== clean("billing_address", before.billingAddress ?? "")) {
    changes.push({ object: "job", op: "update", uuid: after.jobUuid, fields: { billing_address: billing }, label: CUSTOMER_WORDS.label.billing });
  }

  const was = new Map(before.contacts.filter((c) => c.uuid).map((c) => [c.uuid!.toLowerCase(), c]));
  const kept = new Set<string>();
  for (const c of after.contacts) {
    const v = Object.fromEntries(CUSTOMER_FIELDS.jobcontact.map((k) => [k, clean(k, (c as unknown as Record<string, string>)[k] ?? "")]));
    if (v.email && !EMAIL.test(v.email)) return { ok: false, error: `${personName(c)}'s email address doesn't look right.` };
    const empty = !v.first && !v.last && !v.mobile && !v.phone && !v.email;
    if (!c.uuid) {
      if (!empty) changes.push({ object: "jobcontact", op: "create", uuid: null, fields: { ...v, type: v.type || "JOB" }, label: fill(CUSTOMER_WORDS.label.contactAdd, personName(c)) });
      continue;
    }
    const prior = was.get(c.uuid.toLowerCase());
    if (!prior) continue;
    kept.add(c.uuid.toLowerCase());
    if (empty) {
      changes.push({ object: "jobcontact", op: "delete", uuid: c.uuid, fields: {}, label: fill(CUSTOMER_WORDS.label.contactRemove, personName(prior)) });
      continue;
    }
    const fields: Record<string, string> = {};
    for (const k of CUSTOMER_FIELDS.jobcontact) if (v[k] !== clean(k, (prior as unknown as Record<string, string>)[k] ?? "")) fields[k] = v[k]!;
    if (Object.keys(fields).length > 0) changes.push({ object: "jobcontact", op: "update", uuid: c.uuid, fields, label: fill(CUSTOMER_WORDS.label.contactEdit, personName(c)) });
  }
  for (const [uuid, prior] of was) {
    if (!kept.has(uuid)) changes.push({ object: "jobcontact", op: "delete", uuid: prior.uuid!, fields: {}, label: fill(CUSTOMER_WORDS.label.contactRemove, personName(prior)) });
  }
  return { ok: true, changes };
}

/** Only the fields an object may have changed, from what a row carries. */
export function allowedFields(object: CustomerObject, fields: unknown): Record<string, string> {
  const f = fields && typeof fields === "object" && !Array.isArray(fields) ? (fields as Record<string, unknown>) : {};
  return Object.fromEntries(CUSTOMER_FIELDS[object].filter((k) => typeof f[k] === "string").map((k) => [k, f[k] as string]));
}

/** Whether a record read back holds what was sent. */
export function holds(record: Record<string, unknown>, fields: Record<string, string>): boolean {
  return Object.entries(fields).every(([k, v]) => String(record[k] ?? "").trim() === v.trim());
}
