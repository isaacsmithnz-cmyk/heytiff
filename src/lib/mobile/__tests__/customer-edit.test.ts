import { applyPhoneEdit, parsePhoneEdit, PHONE_EDIT_WORDS, sameAddress } from "../customer-edit";
import { CUSTOMER_WORDS, customerChanges, type CustomerForm } from "@/lib/integrations/sm8-customer-plan";

/* The phone's Contact sheet saves one thing at a time; each becomes the
   whole form the web would have saved, against the job as it stands, and
   the one diff turns that into the rows that go. */

const J = "0b1e0b1e-0000-4000-8000-000000000001";
const LISA = "9e9e9e9e-0000-4000-8000-000000000001";
const RAY = "9e9e9e9e-0000-4000-8000-000000000002";
const lisa = { uuid: LISA, first: "Lisa", last: "Ashdown", mobile: "0412 345 678", phone: "", email: "", type: "JOB" };
const ray = { uuid: RAY, first: "Ray", last: "Ashdown", mobile: "0400 111 222", phone: "02 9960 0000", email: "", type: "BILLING" };
const job: CustomerForm = {
  jobUuid: J,
  company: { uuid: "c0c0c0c0-0000-4000-8000-000000000001", name: "Lisa Ashdown", address: "6/40 Lorem St, Sampleton" },
  billingAddress: "6/40 Lorem St\nSampleton",
  siteAddress: "6/40 Lorem St, Sampleton",
  contacts: [lisa, ray],
};

const rows = (edit: Parameters<typeof applyPhoneEdit>[1], before: CustomerForm = job) => {
  const a = applyPhoneEdit(before, edit);
  if (!a.ok) return a;
  const d = customerChanges(before, a.after);
  return d.ok ? d.changes.map((c) => [c.object, c.op, c.uuid, c.fields]) : d;
};

describe("a phone's one change, as rows", () => {
  it("a person changed: only what changed goes, and their landline stays as it is", () => {
    expect(rows({ kind: "person", id: RAY, first: "Ray", last: "Ashdown", mobile: "0400 999 888", email: "ray@example.com", type: "Tenant" })).toEqual([
      ["jobcontact", "update", RAY, { mobile: "0400 999 888", email: "ray@example.com", type: "Tenant" }],
    ]);
  });

  it("a person added, under the role chosen", () => {
    expect(rows({ kind: "person", id: null, first: "Dana", last: "", mobile: "02 9960 1234", email: "", type: "Property Manager" })).toEqual([
      ["jobcontact", "create", null, { first: "Dana", last: "", mobile: "02 9960 1234", phone: "", email: "", type: "Property Manager" }],
    ]);
  });

  it("a person taken off the job", () => {
    expect(rows({ kind: "remove", id: LISA })).toEqual([["jobcontact", "delete", LISA, {}]]);
  });

  it("the site's address, and the bills that went to the same place follow it", () => {
    expect(rows({ kind: "site", address: "8 Lorem St, Sampleton NSW 2088" })).toEqual([["job", "update", J, { billing_address: "8 Lorem St, Sampleton NSW 2088", job_address: "8 Lorem St, Sampleton NSW 2088" }]]);
  });

  it("the site's address alone when the bills go elsewhere", () => {
    expect(rows({ kind: "site", address: "8 Lorem St, Sampleton NSW 2088" }, { ...job, billingAddress: "PO Box 412, Sampleton NSW 2088" })).toEqual([["job", "update", J, { job_address: "8 Lorem St, Sampleton NSW 2088" }]]);
  });

  it("the billing address: its own, or the site's", () => {
    expect(rows({ kind: "billing", address: "PO Box 412, Sampleton NSW 2088", same: false })).toEqual([["job", "update", J, { billing_address: "PO Box 412, Sampleton NSW 2088" }]]);
    expect(rows({ kind: "billing", address: "", same: true }, { ...job, billingAddress: "PO Box 412" })).toEqual([["job", "update", J, { billing_address: "6/40 Lorem St, Sampleton" }]]);
  });
});

describe("what a phone's change can't do", () => {
  it("changes or takes off only this job's own people", () => {
    const stranger = "9e9e9e9e-0000-4000-8000-0000000000ff";
    expect(applyPhoneEdit(job, { kind: "remove", id: stranger })).toEqual({ ok: false, error: CUSTOMER_WORDS.row.gone });
    expect(applyPhoneEdit(job, { kind: "person", id: stranger, first: "X", last: "", mobile: "", email: "", type: "JOB" })).toEqual({ ok: false, error: CUSTOMER_WORDS.row.gone });
  });

  it("gives a role from the six, or keeps the one ServiceM8 already holds", () => {
    expect(applyPhoneEdit(job, { kind: "person", id: null, first: "Dana", last: "", mobile: "", email: "", type: "Agent" })).toEqual({ ok: false, error: PHONE_EDIT_WORDS.role });
    const odd = { ...job, contacts: [{ ...lisa, type: "Strata" }] };
    expect(applyPhoneEdit(odd, { kind: "person", id: LISA, first: "Lisa", last: "W", mobile: "0412 345 678", email: "", type: "Strata" }).ok).toBe(true);
  });

  it("never empties a person into a removal, nor adds no one", () => {
    expect(applyPhoneEdit(job, { kind: "person", id: LISA, first: "", last: "", mobile: "", email: "", type: "JOB" })).toEqual({ ok: false, error: PHONE_EDIT_WORDS.empty });
    expect(applyPhoneEdit(job, { kind: "person", id: null, first: " ", last: "", mobile: "", email: "", type: "JOB" })).toEqual({ ok: false, error: PHONE_EDIT_WORDS.empty });
  });

  it("changes no billing address it couldn't read, and sends none to a site with no address", () => {
    expect(applyPhoneEdit({ ...job, billingAddress: null }, { kind: "billing", address: "x", same: false })).toEqual({ ok: false, error: PHONE_EDIT_WORDS.billingUnread });
    expect(applyPhoneEdit({ ...job, siteAddress: "" }, { kind: "billing", address: "", same: true })).toEqual({ ok: false, error: PHONE_EDIT_WORDS.noSite });
  });
});

describe("reading a phone's body", () => {
  it("takes the four edits and nothing else", () => {
    expect(parsePhoneEdit({ edit: { kind: "site", address: "8 Lorem St" } })).toEqual({ kind: "site", address: "8 Lorem St" });
    expect(parsePhoneEdit({ edit: { kind: "billing", same: true, address: "ignored" } })).toEqual({ kind: "billing", address: "", same: true });
    expect(parsePhoneEdit({ edit: { kind: "remove", id: RAY } })).toEqual({ kind: "remove", id: RAY });
    expect(parsePhoneEdit({ edit: { kind: "person", id: null, first: "Dana", type: "Tenant" } })).toEqual({ kind: "person", id: null, first: "Dana", last: "", mobile: "", email: "", type: "Tenant" });
    expect(parsePhoneEdit({ edit: { kind: "company", name: "x" } })).toBeNull();
    expect(parsePhoneEdit({ edit: { kind: "remove", id: "not-a-uuid" } })).toBeNull();
    expect(parsePhoneEdit({ edit: { kind: "person", id: "not-a-uuid", first: "x" } })).toBeNull();
    expect(parsePhoneEdit({ edit: { kind: "site", address: 4 } })).toBeNull();
    expect(parsePhoneEdit(null)).toBeNull();
  });
});

describe("the same address", () => {
  it("whatever the case, the spaces or how the lines break", () => {
    expect(sameAddress("6/40 Lorem St\nSampleton", "6/40 lorem st,  Sampleton")).toBe(true);
    expect(sameAddress("6/40 Lorem St, Sampleton", "PO Box 412, Sampleton")).toBe(false);
    expect(sameAddress("", "")).toBe(false);
  });
});
