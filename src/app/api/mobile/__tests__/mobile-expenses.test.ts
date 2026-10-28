/**
 * @jest-environment node
 */

/* Expense claims on the phone (lib/mobile/expenses): the web's own actions,
   run as the phone's person. Your own claims and what you're owed; a read
   that fills a draft (and the fuel log's reader for a fuel docket); Send
   claim naming a ServiceM8 job in the claim's words, as the web's form does;
   fuel only ever on the vehicle; the photo's slot of the kind its record
   adopts. The actions are stand-ins that record what they were asked. */

import type { Claim } from "@/lib/expenses/claim";

const asked: string[] = [];
jest.mock("server-only", () => ({}));
jest.mock("@/lib/mobile/auth", () => ({
  actAsPhoneUser: async (ctx: { userId: string }, fn: () => Promise<unknown>) => {
    asked.push(`as ${ctx.userId}`);
    return fn();
  },
}));
let staffId: string | null = "card-alex";
jest.mock("@/lib/fleet/query", () => ({
  staffProfileIdFor: async () => staffId,
  listVehiclePicker: async () => [
    { id: "v-pool", name: "Pool ute", plate: "EZ12AB", make: "Toyota", model: "Hilux", status: "active", odometer: 81200 },
    { id: "v-alex", name: "", plate: "DA04", make: "Isuzu", model: "D-Max", status: "active", odometer: 40210 },
  ],
  getOwnVehicle: async () => ({ id: "v-alex" }),
}));
const claim = (over: Partial<Claim>): Claim => ({
  id: "c",
  staffProfileId: "card-alex",
  expenseDate: "2026-10-27",
  description: "Copper fittings",
  category: "materials",
  amount: 96.8,
  gstAmount: 8.8,
  supplier: "Reece",
  paidWith: "own",
  job: null,
  status: "pending",
  reviewNote: null,
  createdAt: "2026-10-27T22:10:00Z",
  ...over,
});
jest.mock("@/lib/expenses/query", () => ({
  myClaims: async (orgId: string, staff: string) => {
    asked.push(`claims ${orgId} ${staff}`);
    return [
      claim({ id: "a" }),
      claim({ id: "b", amount: 28, status: "approved", description: "Parking" }),
      claim({ id: "c", amount: 300, status: "recorded", paidWith: "company", description: "Copper coil" }),
      claim({ id: "d", amount: 50, status: "reimbursed", description: "Drill bits" }),
    ];
  },
}));
jest.mock("@/lib/au-dates", () => ({ ...jest.requireActual("@/lib/au-dates"), todayInAu: () => "2026-10-28" }));
let readCategory: string | null = "materials";
jest.mock("@/app/actions/expense-ai", () => ({
  readExpenseReceipt: async (data: string, type: string) => {
    asked.push(`read ${data.length} ${type}`);
    return readCategory === "fail"
      ? { ok: false, reason: "Tiff couldn't read that receipt." }
      : { ok: true, total: 96.8, gst: 8.8, supplier: "Reece", date: "2026-10-27", description: "Copper fittings, flux and silfos", category: readCategory };
  },
}));
jest.mock("@/app/actions/fleet-ai", () => ({
  readFuelReceipt: async () => {
    asked.push("read fuel");
    return { ok: true, litres: 62.4, cost: 121.5, station: "Ampol Alexandria", date: "2026-10-27", gst: 11.05, abn: "40004201307" };
  },
}));
jest.mock("@/app/actions/expenses", () => ({
  submitClaim: async (input: Record<string, unknown>) => {
    asked.push(`submit ${JSON.stringify(input)}`);
    return { ok: true, id: "new-claim" };
  },
  cancelClaim: async (id: string) => {
    asked.push(`cancel ${id}`);
    return { ok: true };
  },
}));
jest.mock("@/app/actions/fleet", () => ({
  addLog: async (log: Record<string, unknown>) => {
    asked.push(`log ${JSON.stringify(log)}`);
    return { ok: true };
  },
}));
jest.mock("@/lib/documents/upload-slots", () => ({
  openSlot: async (orgId: string, staff: string, kind: string, file: { fileName: string; mimeType: string; sizeBytes: number }) => {
    asked.push(`slot ${orgId} ${staff} ${kind} ${file.fileName} ${file.mimeType} ${file.sizeBytes}`);
    return { ok: true, documentId: "doc-1", ref: "r", token: "t", bucket: "documents", signedUrl: "https://signed/put" };
  },
  landSlot: async (orgId: string, staff: string, id: string) => {
    asked.push(`land ${orgId} ${staff} ${id}`);
    return { ok: true };
  },
}));

import { fileClaim, landReceipt, logFuel, readPhoneExpenses, readPhoneReceipt, receiptSlot, undoClaim } from "@/lib/mobile/expenses";

const ctx = { userId: "auth0|alex", orgId: "org-diamond", role: "member", caps: new Set(), orgIds: ["org-diamond"] } as never;

beforeEach(() => {
  asked.length = 0;
  staffId = "card-alex";
  readCategory = "materials";
});

describe("the phone's expense claims", () => {
  it("lists your own claims, what you're owed, and your vehicle first", async () => {
    const out = await readPhoneExpenses(ctx);
    expect(asked).toEqual(["claims org-diamond card-alex"]);
    expect(out.claims.map((c) => `${c.id} ${c.statusLabel}`)).toEqual([
      "a Waiting on approval",
      "b Approved, awaiting payment",
      "c On the company card",
      "d Reimbursed",
    ]);
    /* pending and approved, never the card's or a paid one */
    expect(out.owed).toBe(124.8);
    expect(out.vehicles.map((v) => v.name)).toEqual(["DA04, Isuzu D-Max", "EZ12AB, Toyota Hilux"]);
    expect(out).toMatchObject({ ownVehicleId: "v-alex", canFile: true, today: "2026-10-28" });
  });

  it("files nothing for someone with no staff card", async () => {
    staffId = null;
    const out = await readPhoneExpenses(ctx);
    expect(out).toMatchObject({ claims: [], owed: 0, canFile: false });
    expect(await receiptSlot(ctx, { fileName: "r.jpg" })).toMatchObject({ ok: false, status: 403 });
  });

  it("reads the receipt into a draft, as the phone's person", async () => {
    const r = await readPhoneReceipt(ctx, { data: "aGVsbG8=", mediaType: "image/jpeg" });
    expect(asked).toEqual(["as auth0|alex", "read 8 image/jpeg"]);
    expect(r).toEqual({
      ok: true,
      value: { read: true, description: "Copper fittings, flux and silfos", supplier: "Reece", date: "2026-10-27", category: "materials", total: 96.8, gst: 8.8, litres: null, abn: null },
    });
  });

  it("reads a fuel docket with the fuel log's reader too, for the litres and the ABN", async () => {
    readCategory = "fuel";
    const r = await readPhoneReceipt(ctx, { data: "aGVsbG8=" });
    expect(asked).toContain("read fuel");
    expect(r.ok && r.value).toMatchObject({ category: "fuel", litres: 62.4, abn: "40004201307" });
  });

  it("reads with the fuel log's reader too when Your vehicle logs fuel, whatever the docket reads as", async () => {
    await readPhoneReceipt(ctx, { data: "aGVsbG8=", fuel: true });
    expect(asked).toContain("read fuel");
  });

  it("leaves an empty draft when the read fails", async () => {
    readCategory = "fail";
    expect(await readPhoneReceipt(ctx, { data: "aGVsbG8=" })).toMatchObject({ ok: true, value: { read: false, total: null } });
    expect(await readPhoneReceipt(ctx, {})).toMatchObject({ ok: false });
  });

  it("names the ServiceM8 job in the claim's words, as the web's form does", async () => {
    const r = await fileClaim(ctx, {
      description: "Copper fittings, flux and silfos",
      supplier: "Reece",
      jobLabel: "#3215, Jay Matthews",
      category: "materials",
      amount: "96.80",
      gstAmount: 8.8,
      expenseDate: "2026-10-27",
      paidWith: "own",
      documentIds: ["doc-1"],
    });
    expect(r).toEqual({ ok: true, value: { id: "new-claim" } });
    expect(asked).toEqual([
      "as auth0|alex",
      `submit ${JSON.stringify({
        job: null,
        expenseDate: "2026-10-27",
        description: "Copper fittings, flux and silfos, for #3215, Jay Matthews",
        category: "materials",
        amount: 96.8,
        gstAmount: 8.8,
        supplier: "Reece",
        paidWith: "own",
        documentIds: ["doc-1"],
      })}`,
    ]);
  });

  it("never files fuel as a claim: it goes on the vehicle", async () => {
    expect(await fileClaim(ctx, { description: "Fuel", category: "fuel", amount: 121.5 })).toMatchObject({ ok: false });
    expect(asked).toEqual([]);
    await logFuel(ctx, {
      vehicleId: "v-alex",
      odo: "40388",
      litres: 62.4,
      cost: 121.5,
      gst: 11.05,
      abn: "40 004 201 307",
      supplier: "Ampol Alexandria",
      purchasedOn: "2026-10-27",
      paidWith: "own",
      receiptDocumentId: "doc-1",
    });
    expect(asked[1]).toBe(
      `log ${JSON.stringify({
        vehicleId: "v-alex",
        kind: "fuel",
        source: "scan",
        odo: 40388,
        litres: 62.4,
        cost: 121.5,
        gst: 11.05,
        abn: "40004201307",
        station: "Ampol Alexandria",
        purchasedOn: "2026-10-27",
        receiptDocumentId: "doc-1",
        paidWith: "own",
      })}`,
    );
  });

  /* the review of 29 October 2026: "57,912" was dropped without a word */
  it("reads a figure typed with a comma or a dollar sign", async () => {
    await logFuel(ctx, { vehicleId: "v-alex", odo: "40,388", cost: "$1,121.50", paidWith: "company" });
    expect(asked[1]).toContain('"odo":40388');
    expect(asked[1]).toContain('"cost":1121.5');
  });

  it("opens the photo's slot as the kind its record adopts, and lands it", async () => {
    await receiptSlot(ctx, { kind: "receipt", fileName: "receipt.jpg", mimeType: "image/jpeg", sizeBytes: 412000 });
    await receiptSlot(ctx, { kind: "fuel_receipt", fileName: "docket.jpg", mimeType: "image/jpeg", sizeBytes: 300000 });
    await receiptSlot(ctx, { kind: "service_record", fileName: "x.jpg", mimeType: "image/jpeg", sizeBytes: 1 });
    await landReceipt(ctx, { documentId: "doc-1" });
    expect(asked).toEqual([
      "slot org-diamond card-alex receipt receipt.jpg image/jpeg 412000",
      "slot org-diamond card-alex fuel_receipt docket.jpg image/jpeg 300000",
      "slot org-diamond card-alex receipt x.jpg image/jpeg 1",
      "land org-diamond card-alex doc-1",
    ]);
  });

  it("undoes a claim as the phone's person", async () => {
    expect(await undoClaim(ctx, { id: "new-claim" })).toEqual({ ok: true, value: null });
    expect(asked).toEqual(["as auth0|alex", "cancel new-claim"]);
  });
});
