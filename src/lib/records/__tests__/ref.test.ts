import { decodeRecord, encodeRecord, openParamOf, recordHref, recordOfHref, withOpenParam } from "../ref";

/* WHAT A DOOR ASKS THE RECORD HOST FOR, AND HOW IT RIDES IN THE ADDRESS.
   The tokens are read back off an address anyone can type, so a bad one
   must read as nothing rather than open a card on rubbish. */

describe("the token", () => {
  it("is the kind, a dot and the id, and reads back as the same record", () => {
    const ref = { kind: "job", id: "8d1c-44" } as const;
    expect(encodeRecord(ref)).toBe("job.8d1c-44");
    expect(decodeRecord("job.8d1c-44")).toEqual(ref);
  });

  it.each([
    ["nothing", null],
    ["empty", ""],
    ["no dot", "job8d1c"],
    ["no kind", ".8d1c"],
    ["no id", "job."],
    ["a kind the host cannot open", "project.p-1"],
    ["a slash", "job.a/b"],
    ["a space", "job.a b"],
    ["a query", "job.a?b"],
    ["a hash", "job.a#b"],
    ["an ampersand", "job.a&b"],
    ["too long", `job.${"x".repeat(81)}`],
  ])("reads %s as no record", (_, token) => {
    expect(decodeRecord(token)).toBeNull();
  });
});

describe("the kinds", () => {
  it("reads a visit and an agreement as well as a job", () => {
    expect(decodeRecord("visit.v-1")).toEqual({ kind: "visit", id: "v-1" });
    expect(decodeRecord("agreement.a-1")).toEqual({ kind: "agreement", id: "a-1" });
  });

  it("gives each its own address to send", () => {
    expect(recordHref({ kind: "job", id: "j-1" })).toBe("/dashboard/jobs/j-1");
    expect(recordHref({ kind: "visit", id: "v-1" })).toBe("/dashboard/jobs?open=visit.v-1");
    expect(recordHref({ kind: "agreement", id: "a-1" })).toBe("/dashboard/jobs?open=agreement.a-1");
  });
});

describe("a link that names a visit", () => {
  it("is a record", () => {
    expect(recordOfHref("/dashboard/workboard?visit=v-7")).toEqual({ ref: { kind: "visit", id: "v-7" } });
    /* a record opened over a page by its own parameter (the old-code audit, 23 October 2026) */
    expect(recordOfHref("/dashboard/jobs?open=visit.v-7")).toEqual({ ref: { kind: "visit", id: "v-7" } });
    expect(recordOfHref("/dashboard/jobs?open=agreement.a-1")).toEqual({ ref: { kind: "agreement", id: "a-1" } });
    expect(recordOfHref("/dashboard/jobs?open=visit.v-7&view=projects")).toBeNull();
    expect(recordOfHref("/elsewhere?open=visit.v-7")).toBeNull();
  });

  it("is not a record beside anything else", () => {
    expect(recordOfHref("/dashboard/workboard?visit=v-7&side=maintenance")).toBeNull();
  });
});

describe("a link that names a job", () => {
  it("is a record, with the face it asked for", () => {
    expect(recordOfHref("/dashboard/workboard?job=j-1")).toEqual({ ref: { kind: "job", id: "j-1" } });
    expect(recordOfHref("/dashboard/workboard?job=j-1&face=quote")).toEqual({
      ref: { kind: "job", id: "j-1" },
      face: "quote",
    });
  });

  it("reads an encoded id back", () => {
    expect(recordOfHref("/dashboard/workboard?job=8d1c%2D44")?.ref.id).toBe("8d1c-44");
  });

  it("drops a face the card does not have, and keeps the record", () => {
    expect(recordOfHref("/dashboard/workboard?job=j-1&face=nowhere")).toEqual({ ref: { kind: "job", id: "j-1" } });
  });

  it.each([
    ["another screen", "/dashboard/assets?v=v1"],
    ["the Workboard on its own", "/dashboard/workboard"],
    ["a job and a search", "/dashboard/workboard?job=j-1&q=pump"],
    ["a job on a side", "/dashboard/workboard?job=j-1&side=jobs"],
    ["a job's quote screen", "/dashboard/workboard/quotes/j-1"],
    ["an id the host would refuse", "/dashboard/workboard?job=a%2Fb"],
  ])("is not a record when it is %s", (_, href) => {
    expect(recordOfHref(href)).toBeNull();
  });
});

describe("the address", () => {
  it("takes the open record and keeps everything else", () => {
    expect(withOpenParam("https://app.test/dashboard/assets?v=v1#rego", { kind: "job", id: "j-1" })).toBe(
      "/dashboard/assets?v=v1&open=job.j-1#rego",
    );
  });

  it("swaps one open record for another rather than carrying two", () => {
    expect(withOpenParam("https://app.test/dashboard?open=job.j-1", { kind: "job", id: "j-2" })).toBe(
      "/dashboard?open=job.j-2",
    );
  });

  it("gives the record back up, and nothing else", () => {
    expect(withOpenParam("https://app.test/dashboard/assets?v=v1&open=job.j-1", null)).toBe("/dashboard/assets?v=v1");
  });

  it("says which record it names, or none", () => {
    expect(openParamOf("https://app.test/dashboard?open=job.j-1")).toEqual({ kind: "job", id: "j-1" });
    expect(openParamOf("https://app.test/dashboard?open=visit.v-1")).toEqual({ kind: "visit", id: "v-1" });
    expect(openParamOf("https://app.test/dashboard?open=project.p-1")).toBeNull();
    expect(openParamOf("https://app.test/dashboard")).toBeNull();
    expect(openParamOf("not an address")).toBeNull();
  });
});
