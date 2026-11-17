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
jest.mock("@/app/actions/fleet", () => ({ addLog: async () => ({ ok: true }), editLog: async () => ({ ok: true }) }));
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

import { GET as LIST } from "../vehicles/route";
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
  expect(JSON.stringify(body)).not.toMatch(/OLD1|41000|52000|38000/);
});

test("one vehicle as Your vehicle reads, its driver named, nothing to correct, no money", async () => {
  const res = await ONE(req("vehicles/v-zucky", "auth0|isaac"), params("v-zucky"));
  expect(res.status).toBe(200);
  const { vehicle: v } = await res.json();
  expect(v).toMatchObject({ id: "v-zucky", title: "Toyota Hiace", plate: "EVD72G", head: "2022, ZUCKY", driver: "Isaac Smith" });
  expect(v.renewals[0]).toMatchObject({ label: "Rego", word: { word: "Due in 24 days", tone: "look" } });
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
