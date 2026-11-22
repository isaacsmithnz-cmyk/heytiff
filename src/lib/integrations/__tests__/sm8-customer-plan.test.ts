import { allowedFields, customerChanges, holds, type CustomerForm } from "../sm8-customer-plan";

const J = "0b1e0b1e-0000-4000-8000-000000000001";
const C = "c0c0c0c0-0000-4000-8000-000000000001";
const P1 = "9e9e9e9e-0000-4000-8000-000000000001";
const P2 = "9e9e9e9e-0000-4000-8000-000000000002";
const jeff = { uuid: P1, first: "Jeff", last: "Ashby", mobile: "0411 111 111", phone: "", email: "jeff@ashbybuilt.example", type: "JOB" };
const kim = { uuid: P2, first: "Kim", last: "Lee", mobile: "", phone: "", email: "", type: "BILLING" };
const base: CustomerForm = { jobUuid: J, company: { uuid: C, name: "Placewood Hotel", address: "1 Placewood Rd" }, billingAddress: "Cliff Rd, Watsons Bay", contacts: [jeff, kim] };

describe("a customer save's changes", () => {
  it("is nothing when nothing changed", () => {
    expect(customerChanges(base, { ...base })).toEqual({ ok: true, changes: [] });
  });

  it("names only the fields that changed, each to its own record", () => {
    const r = customerChanges(base, {
      ...base,
      company: { uuid: C, name: "Placewood Hotel", address: "2 Placewood Rd" },
      billingAddress: "1 Placewood Rd",
      contacts: [{ ...jeff, type: "Site Contact" }, kim],
    });
    expect(r.ok && r.changes.map((c) => [c.object, c.op, c.uuid, c.fields])).toEqual([
      ["company", "update", C, { address: "2 Placewood Rd" }],
      ["job", "update", J, { billing_address: "1 Placewood Rd" }],
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
    expect(customerChanges(base, { ...base, contacts: [{ ...jeff, email: "nope" }, kim] })).toEqual({ ok: false, error: "Jeff Ashby's email address doesn't look right." });
    expect(customerChanges(base, { ...base, company: { uuid: C, name: " ", address: "" } })).toMatchObject({ ok: false });
  });

  it("sends only what each record may have changed", () => {
    expect(allowedFields("job", { billing_address: "x", status: "Completed" })).toEqual({ billing_address: "x" });
    expect(allowedFields("company", { name: "A", parent_company_uuid: "b" })).toEqual({ name: "A" });
  });

  it("reads a record back as holding what went, and says roles in words", () => {
    expect(holds({ type: "BILLING", first: "Kim " }, { type: "BILLING", first: "Kim" })).toBe(true);
    expect(holds({ type: "JOB" }, { type: "BILLING" })).toBe(false);
  });
});

describe("the job's site address (bug 26)", () => {
  const sited: CustomerForm = { ...base, siteAddress: "Cliff Rd, Watsons Bay" };

  it("goes as job_address, on the job's one row", () => {
    const r = customerChanges(sited, { ...sited, siteAddress: "6/40 Lorem St, Sampleton NSW 2088" });
    expect(r.ok && r.changes.map((c) => [c.object, c.op, c.uuid, c.fields, c.label])).toEqual([["job", "update", J, { job_address: "6/40 Lorem St, Sampleton NSW 2088" }, "Site address changed"]]);
  });

  it("goes with the billing address as one change to the job, when both move", () => {
    const r = customerChanges(sited, { ...sited, siteAddress: "6/40 Lorem St, Sampleton", billingAddress: "6/40 Lorem St, Sampleton" });
    expect(r.ok && r.changes.map((c) => [c.object, c.fields, c.label])).toEqual([["job", { billing_address: "6/40 Lorem St, Sampleton", job_address: "6/40 Lorem St, Sampleton" }, "Site and billing addresses changed"]]);
  });

  it("is left alone when the form doesn't carry it, or the job's couldn't be known", () => {
    expect(customerChanges(sited, { ...sited, siteAddress: undefined })).toEqual({ ok: true, changes: [] });
    expect(customerChanges(base, { ...base, siteAddress: "6/40 Lorem St" })).toEqual({ ok: true, changes: [] });
    expect(customerChanges({ ...sited, siteAddress: null }, { ...sited, siteAddress: "6/40 Lorem St" })).toEqual({ ok: true, changes: [] });
  });

  it("can't be emptied, and spaces round it are no change", () => {
    expect(customerChanges(sited, { ...sited, siteAddress: "  " })).toEqual({ ok: false, error: "The site needs an address." });
    expect(customerChanges(sited, { ...sited, siteAddress: " Cliff Rd, Watsons Bay " })).toEqual({ ok: true, changes: [] });
  });

  it("is a field the sender may send for a job, beside the billing address and never the status", () => {
    expect(allowedFields("job", { job_address: "x", billing_address: "y", status: "Completed", job_description: "z" })).toEqual({ billing_address: "y", job_address: "x" });
  });
});
