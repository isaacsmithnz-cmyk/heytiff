import type { StoredDocument } from "@/lib/documents/query";
import type { Vehicle, VehicleLog, VehiclePolicy } from "../../logic";
import {
  complianceRows,
  currentPolicy,
  historyEvents,
  historyLine,
  historyTabs,
  logKinds,
  photoSrc,
  policyDocuments,
  previousPolicies,
  regoAlert,
  renewalStatusText,
  specRows,
} from "../derive";

/* The reasoning behind the five screens, tested without a DOM. The rule under
   most of these: nothing here invents a value. */

const van: Vehicle = {
  id: "v1",
  name: "HIACE VAN",
  make: "Toyota",
  model: "Hiace",
  year: 2021,
  plate: "CU99PY",
  plateState: "NSW",
  status: "active",
  odometer: 84120,
  regoDays: 200,
  insuranceDays: null,
  ctpDays: 200,
  serviceIntervalKm: 10000,
  lastServiceOdo: 80000,
  serviceIntervalMonths: null,
  serviceDays: null,
  motorised: true,
  assignedTo: null,
  value: 30000,
  purchasePrice: 0,
  purchaseDateDays: 0,
  lastServiceDays: null,
};

const policy = (over: Partial<VehiclePolicy>): VehiclePolicy => ({
  id: "p",
  kind: "ctp",
  provider: "QBE",
  premium: 945.54,
  startsOn: "2026-09-30",
  expiresOn: "2027-09-29",
  documentId: null,
  ...over,
});

const doc = (over: Partial<StoredDocument>): StoredDocument => ({
  id: "d",
  kind: "green_slip",
  fileName: "slip.jpg",
  mimeType: "image/jpeg",
  sizeBytes: 10,
  uploadedById: "s1",
  createdAt: "2026-09-01T00:00:00Z",
  url: "https://x/y",
  image: true,
  policyId: null,
  financeId: null,
  ...over,
});

const log = (over: Partial<VehicleLog>): VehicleLog => ({
  id: "l",
  vehicleId: "v1",
  staffId: null,
  kind: "fuel",
  when: "Mon 1 Sep",
  ago: 1,
  ...over,
});

describe("renewalStatusText", () => {
  it("speaks the way a person would, in both tenses, and says Not set for nothing", () => {
    expect(renewalStatusText(null)).toBe("Not set");
    expect(renewalStatusText(-4)).toBe("Expired 4 days ago");
    expect(renewalStatusText(0)).toBe("Expires today");
    expect(renewalStatusText(1)).toBe("Renews tomorrow");
    expect(renewalStatusText(21)).toBe("Renews in 3 weeks");
  });
});

describe("complianceRows", () => {
  it("names the provider and date when a policy is filed and nothing is due", () => {
    const rows = complianceRows(van, [policy({})]);
    expect(rows.find((r) => r.kind === "ctp")).toMatchObject({
      label: "GREEN SLIP",
      value: "QBE · 29 Sep 2027",
      state: "ok",
      unset: false,
    });
  });

  it("switches to the countdown once inside the warning window, whatever is filed", () => {
    const rows = complianceRows({ ...van, ctpDays: 9 }, [policy({})]);
    expect(rows.find((r) => r.kind === "ctp")).toMatchObject({ value: "Renews in 9 days", state: "warn" });
  });

  it("offers Add, not a chevron, where nothing at all is recorded", () => {
    const ins = complianceRows(van, []).find((r) => r.kind === "insurance");
    expect(ins).toMatchObject({ value: "Not set", unset: true, state: "ok" });
  });

  it("reads a cached date with no policy row behind it as a countdown, not as unset", () => {
    // the eleven vehicles that predate the policy table: a date, no row
    const rego = complianceRows(van, []).find((r) => r.kind === "rego");
    expect(rego).toMatchObject({ value: "Renews in 6 months", unset: false });
  });
});

describe("currentPolicy / previousPolicies / policyDocuments", () => {
  const older = policy({ id: "old", expiresOn: "2026-09-29", documentId: "d-old" });
  const newer = policy({ id: "new", expiresOn: "2027-09-29" });
  const insurance = policy({ id: "ins", kind: "insurance", expiresOn: "2028-01-01" });

  it("picks the LATEST EXPIRY as current, not the newest upload", () => {
    expect(currentPolicy([older, newer, insurance], "ctp")?.id).toBe("new");
    expect(currentPolicy([newer, older], "ctp")?.id).toBe("new");
    expect(currentPolicy([insurance], "ctp")).toBeNull();
  });

  it("lists everything else of the kind as history, newest first", () => {
    const third = policy({ id: "third", expiresOn: "2025-09-29" });
    expect(previousPolicies([third, newer, older, insurance], "ctp").map((p) => p.id)).toEqual(["old", "third"]);
  });

  it("files a document under a policy from either side of the link", () => {
    const filed = doc({ id: "f", policyId: "old" });
    const readFrom = doc({ id: "d-old" }); // predates the filing column: linked only from the policy
    const stranger = doc({ id: "z", policyId: "new" });
    expect(policyDocuments([filed, readFrom, stranger], older).map((d) => d.id)).toEqual(["f", "d-old"]);
  });
});

describe("regoAlert", () => {
  it("rides the same 30-day rule as the chip, in both tenses", () => {
    expect(regoAlert({ ...van, regoDays: 31 })).toBeNull();
    expect(regoAlert({ ...van, regoDays: 30 })).toBe("Rego expires in 4 weeks");
    expect(regoAlert({ ...van, regoDays: 0 })).toBe("Rego expires today");
    expect(regoAlert({ ...van, regoDays: -2 })).toBe("Rego has expired");
    expect(regoAlert({ ...van, regoDays: null })).toBeNull();
  });
});

describe("specRows", () => {
  it("shows only what has been recorded, the VIN across two columns", () => {
    expect(specRows(van)).toEqual([]);
    const rows = specRows({ ...van, vin: "MMAWLKL10NH035826", gvmKg: 2900, engineCapacityCc: 2442 });
    expect(rows).toEqual([
      { label: "VIN", value: "MMAWLKL10NH035826", wide: true },
      { label: "ENGINE CAPACITY", value: "2,442 cc" },
      { label: "GVM", value: "2,900 kg" },
    ]);
  });
});

describe("photoSrc", () => {
  it("uses the vehicle's own photo when it is set and its link could be signed", () => {
    const docs = [doc({ id: "ph", kind: "vehicle_photo", url: "https://signed/ph.jpg" })];
    expect(photoSrc({ ...van, photoDocumentId: "ph" }, docs)).toEqual({ src: "https://signed/ph.jpg", own: true });
  });

  it("falls back to the body type's drawing, and to a van for an engine of unknown shape", () => {
    expect(photoSrc({ ...van, bodyType: "ute" }, [])).toEqual({ src: "/fleet/ute.svg", own: false });
    expect(photoSrc(van, [])).toEqual({ src: "/fleet/van.svg", own: false });
    expect(photoSrc({ ...van, motorised: false }, [])).toEqual({ src: "/fleet/trailer.svg", own: false });
    // a pointer to a photo whose link couldn't be signed is not a photo
    expect(photoSrc({ ...van, photoDocumentId: "ph" }, [doc({ id: "ph", url: null })]).own).toBe(false);
  });
});

describe("history", () => {
  const logs = [
    log({ id: "a", kind: "fuel", ago: 3, litres: 62, cost: 118.4 }),
    log({ id: "b", kind: "issue", ago: 1, note: "wiper blade", status: "open" }),
    log({ id: "c", kind: "service", ago: 9, note: "10,000 km" }),
    log({ id: "d", kind: "odo", ago: 0, odo: 108375 }),
  ];

  it("has no Fuel tab and no fuel log for something with no tank", () => {
    expect(historyTabs(van).map((t) => t.key)).toEqual(["all", "fuel", "service", "issue"]);
    expect(historyTabs({ ...van, motorised: false }).map((t) => t.key)).toEqual(["all", "service", "issue"]);
    expect(logKinds({ ...van, motorised: false })).toEqual(["issue", "service"]);
  });

  it("filters by tab, newest first, capped", () => {
    expect(historyEvents(logs, "all").map((l) => l.id)).toEqual(["d", "b", "a", "c"]);
    expect(historyEvents(logs, "issue").map((l) => l.id)).toEqual(["b"]);
    expect(historyEvents(logs, "all", 2).map((l) => l.id)).toEqual(["d", "b"]);
  });

  it("says each event the way a person would", () => {
    expect(historyLine(logs[0])).toBe("Fuel logged — 62 L, $118.40");
    expect(historyLine(logs[1])).toBe("Issue reported — wiper blade");
    expect(historyLine(logs[2])).toBe("Service — 10,000 km");
    expect(historyLine(logs[3])).toBe("Odometer updated — 108,375 km");
  });
});
