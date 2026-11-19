/**
 * @jest-environment node
 */

/* Every vehicle on the phone (lib/mobile/vehicles; Isaac, 17 November 2026,
   bug 8), behind the real token check: only for whoever sees the register
   (`assets_all`), the working fleet with what needs a look first, and one
   vehicle as Your vehicle reads, its driver named, nothing to correct and no
   money. Drawn on Diamond's: the trailer's rego lapsed, Zucky's due in 24
   days, the Hilux fine, an old Transit sold. The word helpers are the real
   ones; the register's reads are stand-ins. */

import { generateKeyPairSync, sign } from "node:crypto";

import type { Vehicle, VehicleLog } from "@/components/fleet/logic";

const { publicKey, privateKey } = generateKeyPairSync("rsa", { modulusLength: 2048 });
jest.mock("@/lib/mobile/token", () => ({
  ...jest.requireActual("@/lib/mobile/token"),
  tenantKeys: () => async (kid: string) => (kid === "k1" ? publicKey : null),
}));

type Row = { user_id: string; org_id: string; role: string | null; permissions: unknown };
let members: Row[] = [];
jest.mock("@/lib/supabase-server", () => ({
  supabaseAdmin: {
    from: () => {
      const f: Record<string, unknown> = {};
      const q = {
        select: () => q,
        eq: (c: string, v: unknown) => ((f[c] = v), q),
        order: () => q,
        then: (res: (v: unknown) => unknown) => res({ data: members.filter((m) => m.user_id === f.user_id), error: null }),
      };
      return q;
    },
  },
}));
jest.mock("server-only", () => ({}));
jest.mock("@/lib/auth0", () => ({ auth0: { getSession: async () => null } }));
const saveVehicle = jest.fn(async (..._a: unknown[]) => ({ ok: true, id: "v-new" }));
const recordRenewal = jest.fn(async (..._a: unknown[]) => ({ ok: true }));
const addLog = jest.fn(async (..._a: unknown[]) => ({ ok: true }));
jest.mock("@/app/actions/fleet", () => ({
  addLog: (...a: unknown[]) => addLog(...a),
  editLog: async () => ({ ok: true }),
  saveVehicle: (...a: unknown[]) => saveVehicle(...a),
  recordRenewal: (...a: unknown[]) => recordRenewal(...a),
}));
jest.mock("@/app/actions/fleet-ai", () => ({
  readRegoCertificate: async () => ({ ok: true, plate: "FUB21K", plateState: "NSW", make: "Toyota", model: "Hiace", year: 2022, expiresOn: "2027-08-14", vin: "JTFHT02P000004417" }),
  readRenewalDocument: async (_d: string, _m: string, kind: string) => (kind === "insurance" ? { ok: true, provider: "NRMA", expiresOn: "2027-03-03", cover: "comprehensive" } : { ok: false, reason: "no-key" }),
  readServiceRecord: async () => ({ ok: true, workshop: "Ultra Tune Penrith", servicedOn: "2026-09-02", odometer: 84120, workDone: ["Oil and filter", "Brake pads"] }),
}));
jest.mock("@/lib/documents/upload-slots", () => ({
  openSlot: async (_o: string, _s: string, kind: string) => ({ ok: true, documentId: `doc-${kind}`, signedUrl: "https://up.example/slot" }),
  landSlot: async () => ({ ok: true }),
}));
const doc = (id: string, kind: string, createdAt: string) => ({ id, kind, fileName: `${id}.jpg`, mimeType: "image/jpeg", sizeBytes: 1, uploadedById: null, createdAt, url: `https://signed/${id}`, image: true, policyId: null, financeId: null });
jest.mock("@/lib/documents/query", () => ({
  documentsForVehicles: async () =>
    new Map([["v-zucky", [doc("d-rego", "rego_notice", "2025-12-01T00:00:00Z"), doc("d-fuel", "fuel_receipt", "2026-11-04T00:00:00Z"), doc("d-svc", "service_record", "2026-09-02T00:00:00Z")]]]),
}));
jest.mock("@/lib/au-dates", () => ({ ...jest.requireActual("@/lib/au-dates"), todayInAu: () => "2026-11-17" }));
jest.mock("@/lib/org/query", () => ({ orgExpiryWindow: async () => ({ warnDays: 30, email: false }) }));

const vehicle = (over: Partial<Vehicle>): Vehicle =>
  ({
    name: "",
    make: "Toyota",
    model: "Hiace",
    year: 0,
    plate: "",
    plateState: "NSW",
    status: "active",
    odometer: 0,
    regoDays: 200,
    insuranceDays: 200,
    ctpDays: null,
    serviceIntervalKm: null,
    lastServiceOdo: 0,
    serviceIntervalMonths: null,
    serviceDays: null,
    motorised: true,
    assignedTo: null,
    value: 41000,
    purchasePrice: 52000,
    ...over,
  }) as unknown as Vehicle;
const FLEET: Vehicle[] = [
  vehicle({ id: "v-zucky", name: "ZUCKY", year: 2022, plate: "EVD72G", regoDays: 24, assignedTo: "card-isaac", odometer: 57000 }),
  vehicle({ id: "v-hilux", name: "TOYOTA HILUX", model: "Hilux", plate: "DH06VY" }),
  vehicle({ id: "v-trailer", name: "TRAILER", make: "LG", model: "Chiv Trailer", plate: "TC22BJ", regoDays: -28, insuranceDays: null, motorised: false }),
  vehicle({ id: "v-old", name: "OLD", make: "Ford", model: "Transit", plate: "OLD1", regoDays: -400, status: "sold" }),
];
const log = (over: Partial<VehicleLog>): VehicleLog => ({ id: "l", vehicleId: "v-zucky", staffId: "card-isaac", staffName: "Isaac Smith", kind: "fuel", when: "Tue 4 Nov", ago: 13, ...over });
jest.mock("@/lib/fleet/query", () => ({
  listVehicles: async () => ({ vehicles: FLEET, aiValues: { "v-zucky": { low: 38000, high: 44000 } } }),
  listFleetStaff: async () => [{ id: "card-isaac", name: "Isaac Smith", status: "Active" }],
  listLogs: async (_o: string, { vehicleId }: { vehicleId: string }) =>
    vehicleId === "v-zucky" ? [log({ id: "f1", litres: 70, cost: 140, station: "Coles Express Park Holme" }), log({ id: "i1", kind: "issue", note: "Sliding door won't latch", status: "open", ago: 2, when: "Sat 15 Nov" })] : [],
  staffProfileIdFor: async () => "card-isaac",
  getOwnVehicle: async () => null,
  listVehiclePicker: async () => [],
}));

import { GET as LIST, POST } from "../vehicles/route";
import { GET as ONE } from "../vehicles/[id]/route";
import { MOBILE_AUDIENCE } from "@/lib/mobile/token";

const DOMAIN = "tenant.example.auth0.com";
const b64 = (o: unknown) => Buffer.from(JSON.stringify(o)).toString("base64url");
const mint = (sub: string) => {
  const h = b64({ alg: "RS256", kid: "k1" });
  const p = b64({ iss: `https://${DOMAIN}/`, aud: MOBILE_AUDIENCE, sub, exp: Math.floor(Date.now() / 1000) + 3600 });
  return `${h}.${p}.${sign("RSA-SHA256", Buffer.from(`${h}.${p}`), privateKey).toString("base64url")}`;
};
const req = (path: string, sub: string | null) =>
  new Request(`https://go.hey-tiff.com/api/mobile/${path}`, { headers: sub ? { authorization: `Bearer ${mint(sub)}` } : {} });
const post = (sub: string | null, body: unknown) =>
  new Request("https://go.hey-tiff.com/api/mobile/vehicles", {
    method: "POST",
    headers: { "content-type": "application/json", ...(sub ? { authorization: `Bearer ${mint(sub)}` } : {}) },
    body: JSON.stringify(body),
  });
const params = (id: string) => ({ params: Promise.resolve({ id }) });

const env = process.env;
beforeEach(() => {
  process.env = { ...env, AUTH0_DOMAIN: DOMAIN };
  members = [
    { user_id: "auth0|isaac", org_id: "org-diamond", role: "owner", permissions: {} },
    { user_id: "auth0|lyle", org_id: "org-diamond", role: "staff", permissions: {} },
  ];
});
afterAll(() => {
  process.env = env;
});

test("without a token, nothing", async () => {
  expect((await LIST(req("vehicles", null))).status).toBe(401);
  expect((await ONE(req("vehicles/v-zucky", null), params("v-zucky"))).status).toBe(401);
});

test("without the register, nothing", async () => {
  expect((await LIST(req("vehicles", "auth0|lyle"))).status).toBe(403);
  expect((await ONE(req("vehicles/v-zucky", "auth0|lyle"), params("v-zucky"))).status).toBe(403);
});

test("the working fleet: what needs a look first, worst first, then the rest; sold ones never", async () => {
  const res = await LIST(req("vehicles", "auth0|isaac"));
  expect(res.status).toBe(200);
  const body = await res.json();
  expect(body.look).toEqual([
    { id: "v-trailer", title: "TRAILER", sub: "LG Chiv Trailer · TC22BJ · No driver", word: { word: "Rego overdue", tone: "wrong" } },
    { id: "v-zucky", title: "ZUCKY", sub: "Toyota Hiace · EVD72G · Isaac Smith", word: { word: "Rego in 24 days", tone: "look" } },
  ]);
  expect(body.rest).toEqual([{ id: "v-hilux", title: "TOYOTA HILUX", sub: "Toyota Hilux · DH06VY · No driver", word: null }]);
  expect(body.drivers).toEqual([{ id: "card-isaac", name: "Isaac Smith" }]);
  expect(JSON.stringify(body)).not.toMatch(/OLD1|41000|52000|38000/);
});

test("one vehicle as Your vehicle reads, its driver named, nothing to correct, no money", async () => {
  const res = await ONE(req("vehicles/v-zucky", "auth0|isaac"), params("v-zucky"));
  expect(res.status).toBe(200);
  const { vehicle: v } = await res.json();
  expect(v).toMatchObject({ id: "v-zucky", title: "Toyota Hiace", plate: "EVD72G", head: "2022, ZUCKY", driver: "Isaac Smith" });
  expect(v.renewals[0]).toMatchObject({ kind: "rego", label: "Rego", word: { word: "Due in 24 days", tone: "look" } });
  /* its own papers, newest first; a fuel docket stays with its fill */
  expect(v.papers.map((p: { id: string; word: string }) => [p.id, p.word])).toEqual([
    ["d-svc", "Service record"],
    ["d-rego", "Rego certificate"],
  ]);
  expect(v.papers[0]).toMatchObject({ url: "https://signed/d-svc", image: true, sub: "Added 2 Sept 2026 · d-svc.jpg" });
  expect(v.issues).toEqual([{ id: "i1", name: "Sliding door won't latch", line: "Isaac Smith, Sat 15 Nov" }]);
  expect(v.entries.every((e: { mine: boolean }) => !e.mine)).toBe(true);
  expect(JSON.stringify(v)).not.toMatch(/41000|52000|38000|assignedTo|purchase/);
  /* no driver on file; a sold one and an unknown id aren't in the fleet */
  expect((await (await ONE(req("vehicles/v-trailer", "auth0|isaac"), params("v-trailer"))).json()).vehicle).toMatchObject({ driver: null, lastFuel: null });
  expect((await ONE(req("vehicles/v-old", "auth0|isaac"), params("v-old"))).status).toBe(404);
  expect((await ONE(req("vehicles/nope", "auth0|isaac"), params("nope"))).status).toBe(404);
});

test("a service needs a look too, by the limit that comes first; a lapse outranks one coming up", async () => {
  const { lookWord } = await import("@/lib/mobile/vehicles");
  const svc = { serviceIntervalKm: 10000, lastServiceOdo: 50000 };
  expect(lookWord(vehicle({ ...svc, odometer: 59000 }), 30)?.word).toEqual({ word: "Service in 1,000 km", tone: "look" });
  expect(lookWord(vehicle({ ...svc, odometer: 61000 }), 30)?.word).toEqual({ word: "Service overdue", tone: "wrong" });
  expect(lookWord(vehicle({ serviceIntervalMonths: 6, serviceDays: 12 }), 30)?.word).toEqual({ word: "Service in 12 days", tone: "look" });
  expect(lookWord(vehicle({ regoDays: 10, insuranceDays: -3 }), 30)?.word).toEqual({ word: "Insurance overdue", tone: "wrong" });
  expect(lookWord(vehicle({ ctpDays: 5, regoDays: 20 }), 30)?.word).toEqual({ word: "Green slip in 5 days", tone: "look" });
  expect(lookWord(vehicle({}), 30)).toBeNull();
});

describe("the register's papers from the phone (18 November 2026)", () => {
  beforeEach(() => {
    saveVehicle.mockClear();
    recordRenewal.mockClear();
    addLog.mockClear();
  });

  test("only for the register, and only a step it knows", async () => {
    expect((await POST(post(null, { do: "add" }))).status).toBe(401);
    expect((await POST(post("auth0|lyle", { do: "add", plate: "X" }))).status).toBe(403);
    expect((await POST(post("auth0|isaac", { do: "constructor" }))).status).toBe(400);
    expect(saveVehicle).not.toHaveBeenCalled();
  });

  test("a paper's slot is of the kind its record adopts", async () => {
    const res = await POST(post("auth0|isaac", { do: "slot", paper: "ctp", fileName: "slip.jpg", mimeType: "image/jpeg", sizeBytes: 900 }));
    expect(await res.json()).toEqual({ documentId: "doc-green_slip", uploadUrl: "https://up.example/slot" });
    expect((await POST(post("auth0|isaac", { do: "slot", paper: "photo" }))).status).toBe(400);
  });

  test("Tiff reads the certificate, a renewal and a service; a failed read is an empty draft", async () => {
    const read = async (what: string) => (await POST(post("auth0|isaac", { do: "read", what, data: "AAAA", mediaType: "image/jpeg" }))).json();
    expect(await read("new")).toMatchObject({ read: true, fields: { plate: "FUB21K", make: "Toyota", expiresOn: "2027-08-14" } });
    expect(await read("insurance")).toMatchObject({ read: true, fields: { provider: "NRMA", cover: "comprehensive" } });
    expect(await read("service")).toMatchObject({ read: true, fields: { workshop: "Ultra Tune Penrith", odometer: 84120, workDone: "Oil and filter\nBrake pads" } });
    expect(await read("rego")).toEqual({ read: false, fields: {} });
  });

  test("Add a vehicle is the web's save, with its first rego filed and the certificate under it", async () => {
    const res = await POST(
      post("auth0|isaac", { do: "add", plate: "fub 21k", plateState: "nsw", make: "Toyota", model: "Hiace LWB", year: 2022, vin: "jtfht02p000004417", regoExpiry: "2027-08-14", documentId: "doc-rego_notice", scanned: true, assignedTo: "card-isaac" }),
    );
    expect(await res.json()).toEqual({ id: "v-new" });
    const [v, invoice, rego] = saveVehicle.mock.calls[0] as [Record<string, unknown>, unknown, Record<string, unknown>];
    expect(v).toMatchObject({ id: "", plate: "FUB21K", plateState: "NSW", make: "Toyota", model: "Hiace LWB", year: 2022, vin: "JTFHT02P000004417", status: "active", assignedTo: "card-isaac", motorised: true, value: 0 });
    expect(v.regoDays).toBe(270); // 17 Nov 2026 to 14 Aug 2027
    expect(invoice).toBeUndefined();
    expect(rego).toMatchObject({ kind: "rego", expiresOn: "2027-08-14", documentId: "doc-rego_notice", source: "scan" });
    /* the certificate needs the rego it's filed under; a plate is a must */
    expect((await POST(post("auth0|isaac", { do: "add", plate: "AB1", make: "Toyota", documentId: "d" }))).status).toBe(400);
    expect((await POST(post("auth0|isaac", { do: "add", make: "Toyota" }))).status).toBe(400);
  });

  test("a renewal is the web's Renew; a service is its Log service, the record adopted", async () => {
    await POST(post("auth0|isaac", { do: "renew", vehicleId: "v-zucky", kind: "insurance", expiresOn: "2027-03-03", provider: "NRMA", cover: "comprehensive", excess: 1000, documentId: "doc-insurance_policy", scanned: true }));
    expect(recordRenewal.mock.calls[0][0]).toMatchObject({ vehicleId: "v-zucky", kind: "insurance", expiresOn: "2027-03-03", provider: "NRMA", cover: "comprehensive", excess: 1000, termMonths: null, documentId: "doc-insurance_policy", source: "scan" });
    expect((await POST(post("auth0|isaac", { do: "renew", vehicleId: "v-zucky", kind: "insurance", expiresOn: "2027-03-03" }))).status).toBe(400);
    expect((await POST(post("auth0|isaac", { do: "renew", vehicleId: "v-zucky", kind: "rego" }))).status).toBe(400);

    await POST(post("auth0|isaac", { do: "service", vehicleId: "v-zucky", odo: 84120, workshop: "Ultra Tune Penrith", servicedOn: "2026-09-02", workDone: "Oil and filter", documentId: "doc-service_record", scanned: true }));
    expect(addLog.mock.calls[0][0]).toMatchObject({ vehicleId: "v-zucky", kind: "service", odo: 84120, station: "Ultra Tune Penrith", purchasedOn: "2026-09-02", workDone: "Oil and filter", receiptDocumentId: "doc-service_record", source: "scan" });
  });
});
