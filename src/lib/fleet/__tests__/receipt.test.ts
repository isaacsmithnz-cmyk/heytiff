import { formatAbn, fuelTaxColumns, normaliseAbn } from "../receipt";

const TODAY = "2026-08-04";

describe("normaliseAbn", () => {
  it("takes eleven digits however they were typed", () => {
    expect(normaliseAbn("51 824 753 556")).toBe("51824753556");
    expect(normaliseAbn("51-824-753-556")).toBe("51824753556");
  });

  it("refuses anything that isn't eleven digits", () => {
    // A nine-digit ACN is the near miss this exists for.
    expect(normaliseAbn("004 085 616")).toBeNull();
    expect(normaliseAbn("518247535567")).toBeNull();
    expect(normaliseAbn("")).toBeNull();
  });
});

describe("formatAbn", () => {
  it("groups it the way the ATO prints it", () => {
    expect(formatAbn("51824753556")).toBe("51 824 753 556");
  });

  it("leaves anything else alone rather than mangling it", () => {
    expect(formatAbn("12345")).toBe("12345");
    expect(formatAbn(null)).toBe("");
  });
});

describe("fuelTaxColumns — the date", () => {
  it("defaults to today when the docket date is absent", () => {
    const r = fuelTaxColumns({}, TODAY);
    expect(r).toEqual({ ok: true, columns: { gst: null, supplier_abn: null, logged_on: TODAY } });
  });

  it("uses the docket's date, not today's", () => {
    // The whole point: Friday's fill filed on Monday is Friday's purchase.
    const r = fuelTaxColumns({ purchasedOn: "2026-07-31" }, TODAY);
    expect(r.ok && r.columns.logged_on).toBe("2026-07-31");
  });

  it("refuses a future date instead of quietly correcting it", () => {
    const r = fuelTaxColumns({ purchasedOn: "2026-08-05" }, TODAY);
    expect(r).toEqual({ ok: false, error: "That receipt is dated in the future — check the date." });
  });

  it("accepts today itself", () => {
    expect(fuelTaxColumns({ purchasedOn: TODAY }, TODAY).ok).toBe(true);
  });

  it("refuses a date more than a year back — usually a mistyped year", () => {
    const r = fuelTaxColumns({ purchasedOn: "2025-01-01" }, TODAY);
    expect(r).toEqual({ ok: false, error: "That receipt is more than a year old — check the date." });
  });

  it("refuses a date that isn't real", () => {
    expect(fuelTaxColumns({ purchasedOn: "2026-02-31" }, TODAY).ok).toBe(false);
    expect(fuelTaxColumns({ purchasedOn: "04/08/2026" }, TODAY).ok).toBe(false);
  });

  it("lets a date span the financial-year boundary", () => {
    // 30 June is a legitimate docket date in August, and it belongs to the
    // year that just closed — the rule must not push it into the new one.
    const r = fuelTaxColumns({ purchasedOn: "2026-06-30" }, TODAY);
    expect(r.ok && r.columns.logged_on).toBe("2026-06-30");
  });
});

describe("fuelTaxColumns — GST", () => {
  it("keeps a GST figure that fits the total", () => {
    const r = fuelTaxColumns({ cost: 158.4, gst: 14.4 }, TODAY);
    expect(r.ok && r.columns.gst).toBe(14.4);
  });

  it("allows exactly one eleventh", () => {
    const r = fuelTaxColumns({ cost: 110, gst: 10 }, TODAY);
    expect(r.ok && r.columns.gst).toBe(10);
  });

  it("refuses more than an eleventh — that came off the wrong line", () => {
    const r = fuelTaxColumns({ cost: 158.4, gst: 40 }, TODAY);
    expect(r.ok).toBe(false);
  });

  it("refuses GST with no total to check it against", () => {
    const r = fuelTaxColumns({ gst: 14.4 }, TODAY);
    expect(r).toEqual({ ok: false, error: "Enter the total cost before the GST." });
  });

  it("treats a zero GST as no GST rather than as a figure", () => {
    const r = fuelTaxColumns({ cost: 158.4, gst: 0 }, TODAY);
    expect(r.ok && r.columns.gst).toBeNull();
  });

  it("never derives a GST that wasn't given", () => {
    // The rule the whole feature rests on: a blank GST stays blank.
    const r = fuelTaxColumns({ cost: 158.4 }, TODAY);
    expect(r.ok && r.columns.gst).toBeNull();
  });
});

describe("fuelTaxColumns — ABN", () => {
  it("stores it as digits", () => {
    const r = fuelTaxColumns({ abn: "51 824 753 556" }, TODAY);
    expect(r.ok && r.columns.supplier_abn).toBe("51824753556");
  });

  it("refuses a partial ABN rather than storing half of one", () => {
    expect(fuelTaxColumns({ abn: "51 824" }, TODAY)).toEqual({
      ok: false,
      error: "An ABN is eleven digits — check that one.",
    });
  });

  it("treats blank as absent", () => {
    const r = fuelTaxColumns({ abn: "   " }, TODAY);
    expect(r.ok && r.columns.supplier_abn).toBeNull();
  });
});
