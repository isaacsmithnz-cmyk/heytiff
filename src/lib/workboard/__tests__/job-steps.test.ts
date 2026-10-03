import type { FamilyClaim, FamilyMoney } from "../job-family";
import { currentStep, jobSteps, type StepInput } from "../job-steps";

const base: StepInput = {
  status: "Quote",
  date: "2026-08-20",
  quoteSentOn: null,
  workOrderDate: null,
  completionDate: null,
  visitDays: [],
  nextBookingDay: null,
  materials: null,
  family: null,
};

const claim = (over: Partial<FamilyClaim>): FamilyClaim => ({
  remoteId: "c",
  jobNumber: "1",
  index: 1,
  stage: "Deposit",
  amountCents: 100000,
  basis: "inc",
  percent: 30,
  raisedOn: "2026-08-28",
  paidCents: 0,
  paidOn: null,
  state: "awaiting",
  dueOn: null,
  overdueDays: null,
  ...over,
});
const family = (claims: FamilyClaim[], over: Partial<FamilyMoney> = {}): FamilyMoney => ({
  memberCount: claims.length,
  isFamily: claims.length > 1,
  claims,
  valueCents: 300000,
  basis: "inc",
  mixedBasis: false,
  unknownClaim: false,
  invoicedCents: 100000,
  toComeCents: 200000,
  paidCents: 0,
  awaitingCents: 100000,
  ...over,
});

const line = (j: Partial<StepInput>, money = true) => jobSteps({ ...base, ...j }, money).map((s) => `${s.key}:${s.state}${s.fact ? `:${s.fact}` : ""}`);

describe("where a job is up to", () => {
  it("a new enquiry is at Quoted, with nothing after it", () => {
    expect(line({}, false)).toEqual(["enquiry:done:20 Aug", "quoted:now", "accepted:next", "materials:next", "installation:next"]);
  });

  it("a quote that's gone out is waiting on Accepted", () => {
    expect(line({ quoteSentOn: "2026-08-27" }, false)).toEqual([
      "enquiry:done:20 Aug",
      "quoted:done:Sent 27 Aug",
      "accepted:now",
      "materials:next",
      "installation:next",
    ]);
  });

  it("an accepted job with its deposit invoiced shows the deposit as the warning", () => {
    const s = jobSteps({ ...base, status: "Work Order", quoteSentOn: "2026-08-27", workOrderDate: "2026-08-28", family: family([claim({}), claim({ index: 2, stage: "Final", state: "not_invoiced", raisedOn: null })]) }, true);
    expect(s.find((x) => x.key === "deposit")).toMatchObject({ state: "warn", fact: "Invoiced 28 Aug" });
    expect(currentStep(s)?.key).toBe("deposit");
  });

  it("a job on site is at Installation, counting its days, whatever is still open behind it", () => {
    const s = jobSteps(
      {
        ...base,
        status: "Work Order",
        quoteSentOn: "2026-08-27",
        workOrderDate: "2026-08-28",
        visitDays: ["2026-09-01", "2026-08-31", "2026-09-01"],
        materials: { total: 4, in: 2 },
        family: family([claim({ state: "paid", paidCents: 100000, paidOn: "2026-08-30" }), claim({ index: 2, stage: "Final", state: "not_invoiced" })]),
      },
      true
    );
    expect(s.map((x) => `${x.key}:${x.state}:${x.fact}`)).toEqual([
      "enquiry:done:20 Aug",
      "quoted:done:Sent 27 Aug",
      "accepted:done:28 Aug",
      "deposit:done:Paid 30 Aug",
      "materials:skip:2 of 4 in",
      "installation:now:Day 2",
      "paid:next:",
    ]);
    expect(currentStep(s)?.key).toBe("installation");
  });

  /* Isaac, 2026-10-03: "if no deposit required make that as an option so it
     can get ticked off" — none invoiced is asked, not guessed */
  it("an accepted job with no deposit invoiced waits at Deposit until it's ticked", () => {
    const one = { status: "Work Order", workOrderDate: "2026-08-28", family: family([claim({ stage: "Final", state: "not_invoiced" })]) };
    expect(line(one)).toContain("deposit:now");
    expect(line({ ...one, noDeposit: true })).toContain("deposit:done:Not needed");
    expect(currentStep(jobSteps({ ...base, ...one, noDeposit: true }, true))?.key).toBe("installation");
  });

  it("the tick shows before the claims are read", () => {
    expect(line({ status: "Work Order", workOrderDate: "2026-08-28", noDeposit: true })).toContain("deposit:done:Not needed");
  });

  it("once the work has started, no deposit invoiced means there wasn't one", () => {
    expect(
      line({ status: "Work Order", workOrderDate: "2026-08-28", visitDays: ["2026-09-01"], family: family([claim({ stage: "Final", state: "not_invoiced" })]) })
    ).toContain("deposit:skip:No deposit");
  });

  it("a deposit that was invoiced beats the tick", () => {
    expect(line({ status: "Work Order", workOrderDate: "2026-08-28", noDeposit: true, family: family([claim({})]) })).toContain("deposit:warn:Invoiced 28 Aug");
  });

  it("a completed job paid in full is done all the way along", () => {
    const s = jobSteps(
      {
        ...base,
        status: "Completed",
        quoteSentOn: "2026-08-27",
        workOrderDate: "2026-08-28",
        completionDate: "2026-09-12",
        visitDays: ["2026-09-12"],
        materials: { total: 2, in: 2 },
        family: family([claim({ stage: "Final", state: "paid", paidCents: 300000, paidOn: "2026-09-20" })], { paidCents: 300000, awaitingCents: 0, toComeCents: 0 }),
      },
      true
    );
    expect(s.every((x) => x.state === "done" || x.state === "skip")).toBe(true);
    expect(s.at(-1)).toMatchObject({ key: "paid", fact: "Paid 20 Sept" });
    expect(currentStep(s)).toBeNull();
  });

  it("a completed job still owed money is at Paid, as a warning", () => {
    const s = jobSteps({ ...base, status: "Completed", workOrderDate: "2026-08-28", completionDate: "2026-09-12", family: family([claim({ stage: "Final", state: "awaiting" })], { awaitingCents: 300000, toComeCents: 0 }) }, true);
    expect(currentStep(s)).toMatchObject({ key: "paid", state: "warn", fact: "Invoiced, not paid" });
  });

  it("a declined quote stops the line at Accepted", () => {
    expect(line({ status: "Unsuccessful", quoteSentOn: "2026-08-27" }, false)).toEqual([
      "enquiry:done:20 Aug",
      "quoted:done:Sent 27 Aug",
      "accepted:bad:Declined",
      "materials:next",
      "installation:next",
    ]);
  });

  it("without the money grant the two money steps are absent", () => {
    const keys = jobSteps({ ...base, family: family([claim({})]) }, false).map((s) => s.key);
    expect(keys).not.toContain("deposit");
    expect(keys).not.toContain("paid");
  });

  it("with the grant the money steps are there before the claims are read", () => {
    expect(line({}, true)).toEqual(["enquiry:done:20 Aug", "quoted:now", "accepted:next", "deposit:next", "materials:next", "installation:next", "paid:next"]);
  });

  it("a booked first day shows on Installation before anyone has been", () => {
    expect(line({ status: "Work Order", workOrderDate: "2026-08-28", nextBookingDay: "2026-09-04" }, false)).toContain("installation:now:Booked 4 Sept");
  });
});
