/* Starting a design from a ServiceM8 job — the naming rules, against the
   shapes the live mirror actually holds. Every address here is copied from a
   real `sm8_jobs.job_address`, newlines and stray commas included, because
   that formatting is the whole reason this module exists. */

import {
  flatAddress,
  jobSubtitle,
  prefillFromJob,
  streetLine,
  type StudioJobHit,
} from "../job-link";

const hit = (over: Partial<StudioJobHit> = {}): StudioJobHit => ({
  remoteId: "job-1",
  jobNumber: "3151",
  clientName: "Diamond Air",
  status: "Work Order",
  address: "12/3 Wallace St\nWaverley NSW 2024",
  suburb: "Waverley",
  description: "Supply and installation of a 12.5kW ducted system",
  ...over,
});

describe("streetLine", () => {
  it("takes the first line and nothing else", () => {
    expect(streetLine("12/3 Wallace St\nWaverley NSW 2024")).toBe("12/3 Wallace St");
  });

  it("drops ServiceM8's trailing comma", () => {
    // a real row: "260 Birrell St,\nBondi Junction NSW 2022"
    expect(streetLine("260 Birrell St,\nBondi Junction NSW 2022")).toBe("260 Birrell St");
  });

  it("skips a leading blank line rather than returning empty", () => {
    expect(streetLine("\n  \n7 Dans Avenue\nCoogee NSW 2034")).toBe("7 Dans Avenue");
  });

  it("is empty for no address at all", () => {
    expect(streetLine(null)).toBe("");
    expect(streetLine("   ")).toBe("");
  });
});

describe("flatAddress", () => {
  it("joins the lines with commas for a one-line field", () => {
    expect(flatAddress("2 Spring St\nPaddington NSW 2021")).toBe(
      "2 Spring St, Paddington NSW 2021"
    );
  });

  it("never doubles a comma ServiceM8 already left", () => {
    expect(flatAddress("260 Birrell St,\nBondi Junction NSW 2022")).toBe(
      "260 Birrell St, Bondi Junction NSW 2022"
    );
  });

  it("is empty for no address", () => {
    expect(flatAddress(null)).toBe("");
  });
});

describe("jobSubtitle", () => {
  it("says who, where and what state — never the number", () => {
    expect(jobSubtitle(hit())).toBe("Diamond Air · Waverley · Work Order");
  });

  it("closes the gaps rather than printing empty separators", () => {
    expect(jobSubtitle(hit({ clientName: null, suburb: "" }))).toBe("Work Order");
  });
});

describe("prefillFromJob", () => {
  it("names the design after the street and carries the three meta fields", () => {
    expect(prefillFromJob(hit())).toEqual({
      name: "12/3 Wallace St",
      jobNumber: "3151",
      client: "Diamond Air",
      site: "12/3 Wallace St, Waverley NSW 2024",
    });
  });

  it("falls back to the client when the job has no address", () => {
    const fill = prefillFromJob(hit({ address: null, suburb: "Bondi" }));
    expect(fill.name).toBe("Diamond Air");
    // the suburb is all the site there is, but it is not nothing
    expect(fill.site).toBe("Bondi");
  });

  it("falls back to the job number when there is neither", () => {
    expect(
      prefillFromJob(hit({ address: null, suburb: null, clientName: null })).name
    ).toBe("Job 3151");
  });

  it("gives an empty name — not a blank one — when nothing identifies the job", () => {
    // the caller's own default ("Untitled design") has to survive this
    expect(
      prefillFromJob(
        hit({ address: null, suburb: null, clientName: null, jobNumber: null })
      )
    ).toEqual({ name: "", jobNumber: "", client: "", site: "" });
  });

  it("keeps a letter-suffixed job number as text", () => {
    // a real row: "3077A" — job numbers are NOT integers
    expect(prefillFromJob(hit({ jobNumber: "3077A" })).jobNumber).toBe("3077A");
  });
});
