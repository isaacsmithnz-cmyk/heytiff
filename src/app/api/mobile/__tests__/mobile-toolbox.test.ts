/**
 * @jest-environment node
 */

/* The phone's Toolbox works the web tools' own sums, so a figure is the same
   wherever it is looked at: R32 cooling at 30 °C outside and 24 °C inside
   runs at 912 / 2,631 kPa on both; a 4 × 5 m Sydney bedroom is the web
   calculator's load and unit class; the Fault Finder's trees go across whole,
   with the web tools' links turned into the phone's own screens. Behind the
   web's own `toolbox` gate, the code lookup offered only with Tiff and a
   Library with something in it. */

jest.mock("server-only", () => ({}));
let caps = new Set(["toolbox", "tiff"]);
jest.mock("@/lib/mobile/auth", () => ({
  requireMobile: async (r: Request, capability?: string) =>
    !r.headers.get("authorization") ? new Response(null, { status: 401 }) : capability && !caps.has(capability) ? new Response(null, { status: 403 }) : { userId: "auth0|isaac", orgId: "org", caps },
  ok: (b: unknown) => Response.json(b),
}));
let counts: Record<string, number> = { installation: 3 };
jest.mock("@/lib/tiff/query", () => ({ kbCategoryCounts: async () => counts }));

import { GET, POST } from "@/app/api/mobile/toolbox/route";
import { hlLoadKw, HL_DEFAULTS, suggestClassKw } from "@/lib/toolbox/heat-load";
import { estimatePressures } from "@/lib/toolbox/diagnose";
import { QUESTIONS } from "@/lib/toolbox/guided";

const req = (body?: unknown, auth = true) =>
  new Request("https://go.hey-tiff.com/api/mobile/toolbox", {
    method: body === undefined ? "GET" : "POST",
    headers: auth ? { authorization: "Bearer t" } : {},
    body: body === undefined ? undefined : JSON.stringify(body),
  });

beforeEach(() => {
  caps = new Set(["toolbox", "tiff"]);
  counts = { installation: 3 };
});

test("Running Pressures: what the web tool says it should run at", async () => {
  const res = await (await POST(req({ tool: "pressures", refrigerant: "R32", duty: "cooling", ambientC: 30, spaceC: 24 }))).json();
  const web = estimatePressures({ refrigerant: "R32", duty: "cooling", ambientC: 30, spaceC: 24 });
  expect(res.estimate.suction).toEqual({ kpa: 912, psi: 132 });
  expect(res.estimate.discharge).toEqual({ kpa: 2631, psi: 382 });
  expect(res.estimate.suction.kpa).toBe(Math.round(web.suctionKpa!));
  expect(res.diagnosis).toBeNull();
});

test("Running Pressures: the gauges as read, in psi, point where the web tool points", async () => {
  const res = await (await POST(req({ tool: "pressures", refrigerant: "R32", duty: "cooling", ambientC: 30, spaceC: 24, unit: "psi", suction: "90", discharge: "300" }))).json();
  expect(res.diagnosis).toEqual(expect.objectContaining({ headline: expect.any(String), checks: expect.any(Array) }));
  expect(res.diagnosis.suction.level).toBe("low");
  expect(res.diagnosis.discharge.level).toBe("low");
});

test("a duty the refrigerant doesn't do falls back to one it does", async () => {
  const res = await (await POST(req({ tool: "pressures", refrigerant: "R404A", duty: "heating" }))).json();
  expect(res.duty).toBe("refrigeration");
});

test("Heat Load: the web calculator's load and unit class for the same room", async () => {
  const res = await (await POST(req({ tool: "heat", lengthM: "4", widthM: "5", climateZone: 5 }))).json();
  const kw = hlLoadKw({ ...HL_DEFAULTS, lengthM: "4", widthM: "5" });
  expect(res).toEqual({ areaM2: 20, kw, classKw: suggestClassKw(kw!), wm2: 145 });
  expect((await (await POST(req({ tool: "heat", lengthM: "4" }))).json()).kw).toBeNull();
});

test("the Fault Finder's trees go whole, the web's tool links as the phone's screens", async () => {
  const res = await (await GET(req())).json();
  expect(res.trees.questions).toHaveLength(QUESTIONS.length);
  expect(res.trees.questions[0].remaining).toEqual(expect.any(String));
  const linked = res.trees.outcomes.filter((o: { tool?: unknown }) => o.tool);
  expect(linked.length).toBeGreaterThan(0);
  for (const o of linked) expect(["/tool-heat", "/tool-pressures"]).toContain(o.tool.path);
  expect(res.pressures.refrigerants.map((r: { key: string }) => r.key)).toContain("R32");
  expect(res.library).toBe("ready");
});

test("the code lookup: only with Tiff, and only with something in the Library", async () => {
  counts = {};
  expect((await (await GET(req())).json()).library).toBe("empty");
  caps = new Set(["toolbox"]);
  expect((await (await GET(req())).json()).library).toBe("off");
});

test("behind the web's own gate", async () => {
  expect((await GET(req(undefined, false))).status).toBe(401);
  caps = new Set(["tiff"]);
  expect((await GET(req())).status).toBe(403);
  expect((await POST(req({ tool: "heat" }))).status).toBe(403);
  caps = new Set(["toolbox"]);
  expect((await POST(req({ tool: "nothing" }))).status).toBe(400);
});
