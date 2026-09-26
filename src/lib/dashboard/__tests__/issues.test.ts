import { issueWhere } from "../issues";

describe("issueWhere", () => {
  it("leads with the job number when there is one", () => {
    expect(issueWhere({ jobNumber: "1042", clientName: "Bayview Apartments", label: "Quarterly" })).toBe(
      "Job 1042, Bayview Apartments",
    );
    expect(issueWhere({ jobNumber: "1042" })).toBe("Job 1042");
  });

  it("names the client and the work when there is no job number", () => {
    expect(issueWhere({ clientName: "Northgate Realty", label: "Annual clean" })).toBe(
      "Northgate Realty, Annual clean",
    );
    expect(issueWhere({ clientName: "Northgate Realty" })).toBe("Northgate Realty");
    expect(issueWhere({ label: "Fit-out" })).toBe("Fit-out");
  });

  it("has nothing to say for a target with no words", () => {
    expect(issueWhere({})).toBeNull();
    expect(issueWhere({ clientName: "  ", label: "" })).toBeNull();
  });
});
