import { fmtDay } from "../day";

describe("fmtDay", () => {
  it("prints a real date as itself", () => {
    expect(fmtDay("2027-09-29")).toBe("29 Sep 2027");
  });

  it("prints a timestamp on the AU day it fell on, not its UTC day", () => {
    // 21:30 UTC on the 12th is 8:30am on the 13th in Sydney
    expect(fmtDay("2026-10-12T21:30:00+00:00")).toBe("13 Oct 2026");
    expect(fmtDay("2026-10-12T21:30:00.000Z")).toBe("13 Oct 2026");
    expect(fmtDay("2026-10-12T21:30:00.123456+00:00")).toBe("13 Oct 2026");
  });

  it("leaves a naive local stamp on its own day", () => {
    // ServiceM8's wall clock, already the business's own day
    expect(fmtDay("2026-10-12 21:30:00")).toBe("12 Oct 2026");
  });
});
