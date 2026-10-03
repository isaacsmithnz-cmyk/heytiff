import { allowedFields, customerChanges, holds, roleWord, type CustomerForm } from "../sm8-customer-plan";

const J = "0b1e0b1e-0000-4000-8000-000000000001";
const C = "c0c0c0c0-0000-4000-8000-000000000001";
const P1 = "9e9e9e9e-0000-4000-8000-000000000001";
const P2 = "9e9e9e9e-0000-4000-8000-000000000002";
const jeff = { uuid: P1, first: "Jeff", last: "Fletcher", mobile: "0411 111 111", phone: "", email: "jeff@fletchbuilt.com.au", type: "JOB" };
const kim = { uuid: P2, first: "Kim", last: "Lee", mobile: "", phone: "", email: "", type: "BILLING" };
const base: CustomerForm = { jobUuid: J, company: { uuid: C, name: "Pagewood Hotel", address: "1 Pagewood Rd" }, billingAddress: "Cliff Rd, Watsons Bay", contacts: [jeff, kim] };

describe("a customer save's changes", () => {
  it("is nothing when nothing changed", () => {
    expect(customerChanges(base, { ...base })).toEqual({ ok: true, changes: [] });
  });

  it("names only the fields that changed, each to its own record", () => {
    const r = customerChanges(base, {
      ...base,
      company: { uuid: C, name: "Pagewood Hotel", address: "2 Pagewood Rd" },
      billingAddress: "1 Pagewood Rd",
      contacts: [{ ...jeff, type: "Site Contact" }, kim],
    });
    expect(r.ok && r.changes.map((c) => [c.object, c.op, c.uuid, c.fields])).toEqual([
      ["company", "update", C, { address: "2 Pagewood Rd" }],
      ["job", "update", J, { billing_address: "1 Pagewood Rd" }],
      ["jobcontact", "update", P1, { type: "Site Contact" }],
    ]);
  });

  it("adds a new contact as a job contact unless a role is chosen, and removes one taken off the list", () => {
    const r = customerChanges(base, { ...base, contacts: [jeff, { uuid: null, first: "Sam", last: "", mobile: "0400", phone: "", email: "", type: "" }] });
    expect(r.ok && r.changes.map((c) => [c.op, c.fields.type ?? null, c.label])).toEqual([
      ["create", "JOB", "Contact Sam added"],
      ["delete", null, "Contact Kim Lee removed"],
    ]);
  });

  it("refuses a bad email and a nameless customer, in words", () => {
    expect(customerChanges(base, { ...base, contacts: [{ ...jeff, email: "nope" }, kim] })).toEqual({ ok: false, error: "Jeff Fletcher's email address doesn't look right." });
    expect(customerChanges(base, { ...base, company: { uuid: C, name: " ", address: "" } })).toMatchObject({ ok: false });
  });

  it("sends only what each record may have changed", () => {
    expect(allowedFields("job", { billing_address: "x", status: "Completed" })).toEqual({ billing_address: "x" });
    expect(allowedFields("company", { name: "A", parent_company_uuid: "b" })).toEqual({ name: "A" });
  });

  it("reads a record back as holding what went, and says roles in words", () => {
    expect(holds({ type: "BILLING", first: "Kim " }, { type: "BILLING", first: "Kim" })).toBe(true);
    expect(holds({ type: "JOB" }, { type: "BILLING" })).toBe(false);
    expect(roleWord("Property Manager")).toBe("Property manager");
    expect(roleWord("BILLING")).toBe("Billing contact");
  });
});
