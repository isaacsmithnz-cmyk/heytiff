import { companyBody, draftOf, jobBody, jobContactBody, jobLine, jobSubject, parseJobSubject, stepsLeft, stepsOf, validNewJob } from "../sm8-job-plan";

const U = (n: number) => `0b1e0b1e-0000-4000-8000-${String(n).padStart(12, "0")}`;
const none = { first: "", last: "", mobile: "", phone: "", email: "" };

describe("a new job's plan", () => {
  it("names one row per press", () => {
    expect(jobSubject("p-1")).toBe("job:p-1");
    expect(parseJobSubject("job:p-1")).toBe("p-1");
    expect(parseJobSubject("leave:x")).toBeNull();
  });

  it("takes an existing client as it is, and a contact only when something was given", () => {
    const v = validNewJob({ client: { kind: "existing", uuid: U(1) }, jobAddress: " 14 Raglan St\nMosman ", description: "Quote a 7 kW ducted", categoryUuid: null, contact: none });
    expect(v).toEqual({ ok: true, job: { companyNew: null, existingUuid: U(1), parentUuid: null, categoryUuid: null, draft: { companyName: null, companyAddress: null, address: "14 Raglan St\nMosman", description: "Quote a 7 kW ducted", contact: null } } });
  });

  it("makes a new client, its address the job's when none is given", () => {
    const v = validNewJob({ client: { kind: "new", name: "  Sarah  Jones ", address: "" }, jobAddress: "1 Bay St", description: "Split", categoryUuid: U(9), contact: { ...none, mobile: "0426 719 412" } });
    expect(v.ok && v.job).toMatchObject({ companyNew: "client", categoryUuid: U(9), draft: { companyName: "Sarah Jones", companyAddress: "1 Bay St", contact: { mobile: "0426 719 412" } } });
  });

  it("names a new site under a builder by its address", () => {
    const v = validNewJob({ client: { kind: "site", parentUuid: U(2), address: "41 Waverley St, Bondi Junction" }, jobAddress: "41 Waverley St, Bondi Junction", description: "Split", categoryUuid: null, contact: null });
    expect(v.ok && v.job).toMatchObject({ companyNew: "site", parentUuid: U(2), draft: { companyName: "41 Waverley St, Bondi Junction" } });
  });

  it("refuses what can't be sent, in words", () => {
    expect(validNewJob({ client: { kind: "existing", uuid: U(1) }, jobAddress: "", description: "x", categoryUuid: null, contact: null })).toMatchObject({ ok: false });
    expect(validNewJob({ client: { kind: "new", name: " ", address: "" }, jobAddress: "a", description: "x", categoryUuid: null, contact: null })).toMatchObject({ ok: false });
    expect(validNewJob({ client: { kind: "existing", uuid: U(1) }, jobAddress: "a", description: "x", categoryUuid: null, contact: { ...none, email: "nope" } })).toMatchObject({ ok: false });
  });

  it("orders the steps, and knows which are left", () => {
    expect(stepsOf({ job_company_new: "client", job_contact_uuid: U(3) })).toEqual(["company", "job", "contact"]);
    expect(stepsOf({ job_company_new: null, job_contact_uuid: null })).toEqual(["job"]);
    expect(stepsLeft({ job_company_new: "site", job_contact_uuid: U(3), job_done: ["company"] })).toEqual(["job", "contact"]);
  });

  it("sends exactly these fields", () => {
    expect(companyBody({ uuid: U(1), name: "Sarah Jones", address: "1 Bay St" })).toEqual({ uuid: U(1), name: "Sarah Jones", address: "1 Bay St" });
    expect(companyBody({ uuid: U(1), name: "41 Waverley St", address: "41 Waverley St", parentUuid: U(2) })).toEqual({ uuid: U(1), name: "41 Waverley St", address: "41 Waverley St", parent_company_uuid: U(2) });
    expect(jobBody({ uuid: U(4), companyUuid: U(1), address: "1 Bay St", description: "Split" })).toEqual({ uuid: U(4), status: "Quote", company_uuid: U(1), job_address: "1 Bay St", job_description: "Split" });
    expect(jobBody({ uuid: U(4), companyUuid: U(1), address: "a", description: "b", categoryUuid: U(9) })).toHaveProperty("category_uuid", U(9));
    expect(jobContactBody({ uuid: U(5), jobUuid: U(4), ...none, first: "Sarah", mobile: "0426" })).toEqual({ uuid: U(5), job_uuid: U(4), type: "JOB", first: "Sarah", mobile: "0426" });
  });

  it("reads its words back off the row, refusing a row without them", () => {
    expect(draftOf({ job_draft: { address: "a", description: "b", companyName: "C", contact: { first: "S" } } })).toMatchObject({ address: "a", contact: { first: "S", last: "" } });
    expect(draftOf({ job_draft: { address: "a" } })).toBeNull();
  });

  it("says where a row is up to", () => {
    expect(jobLine({ status: "sent", job_number: "3401" }).words).toBe("In ServiceM8 as #3401.");
    expect(jobLine({ status: "failed", job_done: ["job"], job_number: "3401", last_error: "It refused the contact." }).state).toBe("partial");
    expect(jobLine({ status: "queued" }).state).toBe("waiting");
  });
});
