/* THE PHONE'S CONTACT SHEET, its one change at a time — pure (Isaac, 17
   November 2026, bug 26: "Contact and address should be editable, billing
   address, agent etc, tenant etc.").

   The web's dialog saves the whole customer at once; the phone saves one
   thing: a person (changed or added), a person taken off, the site's
   address, or the billing address. Each is turned here into the whole
   CustomerForm the web would have saved, against the job AS IT STANDS NOW
   (read by the server, never the phone's copy), so the one diff and the one
   queue door (sm8-customer-plan's customerChanges, the customer queue) do
   the rest, as they do for the web.

   A person's landline isn't on the phone's sheet, so it is kept as it is. A
   site address moved while the bills went to the same place moves the
   billing address with it, so "Same as the site" stays true. */

import { CONTACT_ROLES, CUSTOMER_WORDS, type CustomerForm, type FormContact } from "@/lib/integrations/sm8-customer-plan";

export type PhoneCustomerEdit =
  | { kind: "person"; id: string | null; first: string; last: string; mobile: string; email: string; type: string }
  | { kind: "remove"; id: string }
  | { kind: "site"; address: string }
  | { kind: "billing"; address: string; same: boolean };

const str = (v: unknown, max: number): string | null => (typeof v === "string" ? v.slice(0, max) : null);
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** The edit a phone's body asks for, or null when it asks for nothing this
    sheet makes. */
export function parsePhoneEdit(body: unknown): PhoneCustomerEdit | null {
  const b = body && typeof body === "object" && !Array.isArray(body) ? (body as Record<string, unknown>) : {};
  const e = b.edit && typeof b.edit === "object" && !Array.isArray(b.edit) ? (b.edit as Record<string, unknown>) : null;
  if (!e) return null;
  switch (e.kind) {
    case "person": {
      const id = e.id === null || e.id === undefined ? null : typeof e.id === "string" && UUID.test(e.id) ? e.id : undefined;
      const first = str(e.first ?? "", 200);
      const last = str(e.last ?? "", 200);
      const mobile = str(e.mobile ?? "", 200);
      const email = str(e.email ?? "", 400);
      const type = str(e.type ?? "", 80);
      if (id === undefined || first === null || last === null || mobile === null || email === null || type === null) return null;
      return { kind: "person", id, first, last, mobile, email, type };
    }
    case "remove":
      return typeof e.id === "string" && UUID.test(e.id) ? { kind: "remove", id: e.id } : null;
    case "site": {
      const address = str(e.address, 1000);
      return address === null ? null : { kind: "site", address };
    }
    case "billing": {
      const same = e.same === true;
      const address = same ? "" : str(e.address, 1000);
      return address === null ? null : { kind: "billing", address, same };
    }
    default:
      return null;
  }
}

/** Two addresses that say the same place: case, spaces and how the lines
    are broken aside (ServiceM8 often holds a billing address over two). */
export function sameAddress(a: string | null | undefined, b: string | null | undefined): boolean {
  const n = (s: string | null | undefined) =>
    (s ?? "")
      .toLowerCase()
      .replace(/\r?\n/g, ", ")
      .replace(/\s*,\s*/g, ", ")
      .replace(/\s+/g, " ")
      .replace(/(, )+/g, ", ")
      .replace(/^, |, $/g, "")
      .trim();
  return n(a) !== "" && n(a) === n(b);
}

const ROLE_TYPES = new Set<string>(CONTACT_ROLES.map((r) => r.type));
const lower = (s: string | null) => (s ?? "").toLowerCase();

export const PHONE_EDIT_WORDS = {
  empty: "Give them a name, a mobile or an email.",
  role: "Choose one of the roles.",
  billingUnread: "HeyTiff couldn't read the billing address from ServiceM8, so it can't be changed now.",
  noSite: "The site has no address yet, so the bills can't go to the same place.",
} as const;

/** The whole form to save for one phone edit, against `before`, the job as
    it stands now. */
export function applyPhoneEdit(before: CustomerForm, edit: PhoneCustomerEdit): { ok: true; after: CustomerForm } | { ok: false; error: string } {
  const after: CustomerForm = { ...before, contacts: before.contacts.map((c) => ({ ...c })) };
  switch (edit.kind) {
    case "person": {
      const prior = edit.id ? before.contacts.find((c) => lower(c.uuid) === lower(edit.id)) : null;
      if (edit.id && !prior) return { ok: false, error: CUSTOMER_WORDS.row.gone };
      /* a role ServiceM8 holds that isn't one of the six may stay as it is */
      if (!ROLE_TYPES.has(edit.type) && !(prior && prior.type === edit.type)) return { ok: false, error: PHONE_EDIT_WORDS.role };
      const person: FormContact = {
        uuid: prior?.uuid ?? null,
        first: edit.first,
        last: edit.last,
        mobile: edit.mobile,
        phone: prior?.phone ?? "",
        email: edit.email,
        type: edit.type,
      };
      if (![person.first, person.last, person.mobile, person.phone, person.email].some((v) => v.trim())) return { ok: false, error: PHONE_EDIT_WORDS.empty };
      after.contacts = prior ? after.contacts.map((c) => (c.uuid === prior.uuid ? person : c)) : [...after.contacts, person];
      return { ok: true, after };
    }
    case "remove": {
      if (!before.contacts.some((c) => lower(c.uuid) === lower(edit.id))) return { ok: false, error: CUSTOMER_WORDS.row.gone };
      after.contacts = after.contacts.filter((c) => lower(c.uuid) !== lower(edit.id));
      return { ok: true, after };
    }
    case "site": {
      after.siteAddress = edit.address;
      /* the bills followed the site: they still do */
      if (before.billingAddress !== null && sameAddress(before.billingAddress, before.siteAddress)) after.billingAddress = edit.address;
      return { ok: true, after };
    }
    case "billing": {
      if (before.billingAddress === null) return { ok: false, error: PHONE_EDIT_WORDS.billingUnread };
      if (edit.same && !(before.siteAddress ?? "").trim()) return { ok: false, error: PHONE_EDIT_WORDS.noSite };
      after.billingAddress = edit.same ? (before.siteAddress ?? "") : edit.address;
      return { ok: true, after };
    }
  }
}
