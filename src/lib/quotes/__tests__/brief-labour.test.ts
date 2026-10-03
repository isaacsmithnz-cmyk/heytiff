import { labourFromBrief } from "../brief-labour";

/* Every phrasing below is one the office wrote into a real job (Isaac,
   2026-10-04: "number one source is the brief"), read for a business whose
   working day is 8 hours. */
const DAY = 8;
const pd = (text: string) => {
  const l = labourFromBrief(text, DAY);
  return l ? l.visits.map((v) => `${v.stage} ${v.people}x${v.days}`) : null;
};
const hours = (text: string) => labourFromBrief(text, DAY)?.personHours ?? null;

describe("labour read from the brief", () => {
  it("reads a crew and its days, and a named person's patch-up as a Return", () => {
    expect(pd("Electrical circuit to switchboard\n3 x pax for 1 day\n$1800materials\nDave for 4 hrs for patching following day")).toEqual([
      "Install 3x1",
      "Return 1x0.5",
    ]);
    expect(hours("3 x pax for 1 day\nDave for 4 hrs for patching following day")).toBe(28);
  });

  it("reads the office's other ways of saying it", () => {
    expect(hours("2 x Ducted AC For service - Allowance 3 HRS x 1 PAX")).toBe(3);
    expect(hours("1 Pax - 8hrs Paper Filters Required ANNUAL MAINTENANCE SERVICE")).toBe(8);
    expect(hours("2 PAX - Full Day (8 hours) ANNUAL MAINTENANCE SERVICE")).toBe(16);
    expect(hours("Annual Maintenance Allow 2 x Trade 3hrs Clean Grill and Service AC")).toBe(6);
    expect(hours("Allow: 4 hrs and 1 x Trade ANNUAL MAINTENANCE SERVICE")).toBe(4);
    expect(hours("Annual Maintenance (allow 5hrs 1 PAX) 8 or 9 bulkhead units")).toBe(5);
    expect(hours("150 silent fan x 3 Supply grills x 3 flexi duct to suit 8hrs x 2men")).toBe(16);
    expect(hours("Option Servicing of existing ac 1 men x 8hrs $1000 plus gst")).toBe(8);
    expect(hours("Supply and install mits elec 10kw multi outdoor 3 x 2.5kw bulkhead indoors 3 x men x 2 days 1 x 5kw bulkhead indoor")).toBe(48);
    expect(hours("Labour: 2 PAX Trade + TA for 1 day")).toBe(16);
  });

  it("reads a crew 'for the day', and a second clause joined by also", () => {
    expect(pd("Rope access guys $2100 plus GST Allow 4 x trades men for the day plus $2500 in materials Also allow for Dave for 1 day for patch repairs")).toEqual([
      "Install 4x1",
      "Return 1x1",
    ]);
  });

  it("reads stages with days before and after the crew", () => {
    expect(hours("Unit - 5 days for 3 x PAX ($1340,00 per trade day rate)")).toBe(120);
    expect(hours("Stage.2 - 2.5 Pax 2 days Platform deconstruction for crane")).toBe(40);
  });

  it("reads half-day return trips as a person each", () => {
    expect(pd("4 guys x 3 days, plus two half day return trips")).toEqual(["Install 4x3", "Return 1x0.5", "Return 1x0.5"]);
    expect(hours("4 guys x 3 days, plus two half day return trips")).toBe(104);
  });

  it("guesses nothing: a crew with no time, a time with nobody, or no labour at all", () => {
    expect(labourFromBrief("2 x trades + TA", DAY)).toBeNull();
    expect(labourFromBrief("Install within 2 days of the strata meeting", DAY)).toBeNull();
    expect(labourFromBrief("5.2kW multi, 2 x 600 x 100mm linear bar grilles, 3 x 2.5kw heads", DAY)).toBeNull();
    expect(labourFromBrief("", DAY)).toBeNull();
    expect(labourFromBrief(null, DAY)).toBeNull();
  });

  it("turns days into hours only by the business's own working day", () => {
    const brief = "3 x pax for 1 day\nDave for 4 hrs for patching following day";
    expect(labourFromBrief(brief, 7.5)).toMatchObject({ personHours: 26.5 });
    /* no working day set: days stay days, hours stay hours, no total in either */
    const unset = labourFromBrief(brief, null)!;
    expect(unset.visits).toEqual([
      { stage: "Install", people: 3, days: 1, hours: null },
      { stage: "Return", people: 1, days: null, hours: 4 },
    ]);
    expect(unset.personHours).toBeNull();
    expect(unset.personDays).toBeNull();
    expect(labourFromBrief("3 x pax for 1 day", null)).toMatchObject({ personDays: 3, personHours: null });
    expect(labourFromBrief("Allowance 3 HRS x 1 PAX", null)).toMatchObject({ personDays: null, personHours: 3 });
  });
});
