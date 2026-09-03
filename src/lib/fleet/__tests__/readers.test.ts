import { parseRegoCertificate, parseRenewalRead, renewalPrompt } from "../readers";

/* The model's answer is INPUT. These pin what we believe of it, field by
   field, against the two real documents that drove the work: the Triton's
   QBE green slip and its Transport for NSW Certificate of Registration. */

const TRITON_CERT = {
  plate: "YLI59V",
  plateState: "NSW",
  make: "Mitsubishi",
  model: "Triton",
  variant: "MR4W30-",
  year: 2022,
  bodyType: "ute",
  colour: null,
  vin: "MMAWLKL10NH035826",
  engineNumber: "4N15ULB0443",
  engineCapacityCc: 2442.0,
  seating: 4,
  tareKg: 2180,
  gvmKg: 2900,
  atmKg: null,
  expiresOn: "2027-09-29",
  renewalAmount: 1008,
  customerNo: "21970756",
  issuer: "Transport for NSW",
};

describe("parseRegoCertificate", () => {
  it("reads the Triton's certificate as the form will receive it", () => {
    expect(parseRegoCertificate(TRITON_CERT)).toEqual({
      ...TRITON_CERT,
      engineCapacityCc: 2442, // 2442.0 cc is an integer measurement
      renewalAmount: 1008,
    });
  });

  it("expands the abbreviation NSW prints and lands on the make picker's own name", () => {
    expect(parseRegoCertificate({ ...TRITON_CERT, make: "MIT" }).make).toBe("Mitsubishi");
    expect(parseRegoCertificate({ ...TRITON_CERT, make: "TOYT" }).make).toBe("Toyota");
    // a make the picker doesn't know is kept as printed, for the "not listed" path
    expect(parseRegoCertificate({ ...TRITON_CERT, make: "Bucher Municipal" }).make).toBe("Bucher Municipal");
  });

  it("normalises the plate the way a person would type it", () => {
    expect(parseRegoCertificate({ ...TRITON_CERT, plate: "yli 59v" }).plate).toBe("YLI59V");
    expect(parseRegoCertificate({ ...TRITON_CERT, plate: "YLI-59V" }).plate).toBe("YLI59V");
    expect(parseRegoCertificate({ ...TRITON_CERT, plate: "X" }).plate).toBeNull();
    expect(parseRegoCertificate({ ...TRITON_CERT, plate: "TOOLONGPLATE" }).plate).toBeNull();
  });

  it("only accepts a state code we have a constraint for", () => {
    expect(parseRegoCertificate({ ...TRITON_CERT, plateState: "nsw" }).plateState).toBe("NSW");
    expect(parseRegoCertificate({ ...TRITON_CERT, plateState: "New South Wales" }).plateState).toBeNull();
  });

  it("shape-checks the VIN without length-locking it — the field is 'VIN / chassis number'", () => {
    expect(parseRegoCertificate({ ...TRITON_CERT, vin: "mmawlkl10nh035826" }).vin).toBe("MMAWLKL10NH035826");
    expect(parseRegoCertificate({ ...TRITON_CERT, vin: "TR 1234" }).vin).toBe("TR1234"); // an old trailer
    expect(parseRegoCertificate({ ...TRITON_CERT, vin: "ABC" }).vin).toBeNull();
    expect(parseRegoCertificate({ ...TRITON_CERT, vin: "MMAWLKL10NH035826EXTRA" }).vin).toBeNull();
  });

  /* Zero is never a measurement here. `0 kg` on a form is a figure somebody
     will save, and the tare of a real vehicle is not zero. */
  it("turns a missing or nonsense measurement into null, never 0", () => {
    const r = parseRegoCertificate({ ...TRITON_CERT, tareKg: 0, gvmKg: -5, seating: "four", engineCapacityCc: NaN });
    expect(r.tareKg).toBeNull();
    expect(r.gvmKg).toBeNull();
    expect(r.seating).toBeNull();
    expect(r.engineCapacityCc).toBeNull();
  });

  it("keeps a plausible year and drops an impossible one", () => {
    const now = new Date("2026-09-02");
    expect(parseRegoCertificate({ ...TRITON_CERT, year: 2022 }, now).year).toBe(2022);
    expect(parseRegoCertificate({ ...TRITON_CERT, year: 2027 }, now).year).toBe(2027); // next year's plate
    expect(parseRegoCertificate({ ...TRITON_CERT, year: 2040 }, now).year).toBeNull();
    expect(parseRegoCertificate({ ...TRITON_CERT, year: 1850 }, now).year).toBeNull();
  });

  it("refuses a date that isn't a date and a body type that isn't ours", () => {
    const r = parseRegoCertificate({ ...TRITON_CERT, expiresOn: "29/09/2027", bodyType: "spaceship" });
    expect(r.expiresOn).toBeNull();
    expect(r.bodyType).toBeNull();
  });

  it("reads garbage as nothing recorded, not as a crash", () => {
    const r = parseRegoCertificate("not even an object");
    expect(Object.values(r).every((v) => v === null)).toBe(true);
  });
});

/* The green slip, as the same reader now returns it with the extras. */
const GREEN_SLIP = {
  provider: "QBE",
  premium: 945.54,
  startsOn: "2026-09-30",
  expiresOn: "2027-09-29",
  policyNumber: "36-01023321955",
  cover: null,
  excess: null,
  termMonths: 12,
  garagingPostcode: "2031",
  inspectionOn: null,
};

describe("parseRenewalRead", () => {
  it("reads the Triton's green slip, extras included", () => {
    expect(parseRenewalRead(GREEN_SLIP, "ctp")).toEqual(GREEN_SLIP);
  });

  /* Which extras a kind can even HAVE is enforced here, not trusted to the
     prompt: a rego notice has no policy number, and a green slip has no
     excess. A model offering one has misread something, and the wrong field
     filled is worse than the right one blank. */
  it("keeps only the extras that belong to the kind", () => {
    const everything = { ...GREEN_SLIP, cover: "comprehensive", excess: 800, inspectionOn: "2026-08-30" };
    const rego = parseRenewalRead(everything, "rego");
    expect(rego.policyNumber).toBeNull();
    expect(rego.cover).toBeNull();
    expect(rego.excess).toBeNull();
    expect(rego.garagingPostcode).toBeNull();
    expect(rego.inspectionOn).toBe("2026-08-30");
    expect(rego.termMonths).toBe(12);

    const ins = parseRenewalRead(everything, "insurance");
    expect(ins.cover).toBe("comprehensive");
    expect(ins.excess).toBe(800);
    expect(ins.policyNumber).toBe("36-01023321955");
    expect(ins.garagingPostcode).toBeNull();
    expect(ins.inspectionOn).toBeNull();

    const ctp = parseRenewalRead(everything, "ctp");
    expect(ctp.cover).toBeNull();
    expect(ctp.excess).toBeNull();
    expect(ctp.garagingPostcode).toBe("2031");
  });

  it("only believes a cover that is one of ours, and a postcode that is four digits", () => {
    expect(parseRenewalRead({ ...GREEN_SLIP, cover: "gold plated" }, "insurance").cover).toBeNull();
    expect(parseRenewalRead({ ...GREEN_SLIP, garagingPostcode: "Randwick" }, "ctp").garagingPostcode).toBeNull();
    expect(parseRenewalRead({ ...GREEN_SLIP, garagingPostcode: "20311" }, "ctp").garagingPostcode).toBeNull();
  });

  it("drops a negative premium, a zero term, and a date in the wrong shape", () => {
    const r = parseRenewalRead({ ...GREEN_SLIP, premium: -3, termMonths: 0, expiresOn: "29/09/2027" }, "ctp");
    expect(r.premium).toBeNull();
    expect(r.termMonths).toBeNull();
    expect(r.expiresOn).toBeNull();
  });

  it("rounds money to cents rather than carrying float noise into a numeric(10,2)", () => {
    expect(parseRenewalRead({ ...GREEN_SLIP, premium: 945.5400000001 }, "ctp").premium).toBe(945.54);
  });
});

describe("renewalPrompt", () => {
  it("asks each kind for its own paper and its own provider", () => {
    expect(renewalPrompt("ctp")).toMatch(/Green Slip/);
    expect(renewalPrompt("ctp")).toMatch(/CTP insurer/);
    expect(renewalPrompt("ctp")).toMatch(/take the TOTAL, not the premium line/);
    expect(renewalPrompt("rego")).toMatch(/road authority/);
    expect(renewalPrompt("rego")).toMatch(/safety check/);
    expect(renewalPrompt("insurance")).toMatch(/third_party_fire_theft/);
    // the one rule every kind shares
    for (const k of ["rego", "insurance", "ctp"] as const)
      expect(renewalPrompt(k)).toMatch(/the LATER date is expiresOn/);
  });
});
