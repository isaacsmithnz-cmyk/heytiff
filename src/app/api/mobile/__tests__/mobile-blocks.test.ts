/**
 * @jest-environment node
 */

/* Block out time from the phone (Isaac, 6 November 2026, "Build it" on the
   phone's New, Block out time): straight onto a person's day. Anyone blocks
   out their own time; someone who runs the board blocks out anyone's. */

jest.mock("server-only", () => ({}));

const staff = [
  { uuid: "S-LUKE", first: "Luke", last: "Ingold" },
  { uuid: "S-ALEX", first: "Alex", last: "Lorenz" },
];
jest.mock("@/lib/supabase-server", () => ({
  supabaseAdmin: {
    from: () => {
      const q: Record<string, unknown> = {};
      q.select = () => q;
      q.eq = () => q;
      q.then = (res: (v: { data: unknown[] }) => unknown) => Promise.resolve({ data: staff }).then(res);
      return q;
    },
  },
}));
let ctx: Record<string, unknown>;
jest.mock("@/lib/mobile/auth", () => ({
  requireMobile: async () => ctx,
  ok: (body: unknown) => Response.json(body),
}));
jest.mock("@/lib/integrations/sm8-press", () => ({ sm8PressFromMobile: async () => null }));
jest.mock("@/lib/integrations/sm8-kinds", () => ({ sm8LeaveAllowed: () => false }));
jest.mock("@/lib/integrations/sm8-writes", () => ({ readSm8WriteState: async () => ({ tenantId: "t1" }) }));
jest.mock("@/lib/mobile/clock", () => ({ staffUuidOf: async () => "s-luke" }));
jest.mock("@/lib/fleet/query", () => ({ staffProfileIdFor: async () => "card-luke" }));
const createBlock = jest.fn();
jest.mock("@/lib/schedule/blocks-store", () => ({ createBlock: (...a: unknown[]) => createBlock(...a) }));

import { GET, POST } from "../blocks/route";

const req = (body?: unknown) => new Request("https://x/api/mobile/blocks", body ? { method: "POST", body: JSON.stringify(body) } : undefined);
const DOCTOR = { what: "Doctor", where: "Mona Vale", day: "2026-11-06", from: "15:00", to: "16:30" };

beforeEach(() => {
  createBlock.mockReset();
  createBlock.mockResolvedValue({ ok: true, id: "b1", note: null });
});

describe("the phone's block out", () => {
  it("offers a tech only themselves, and someone who runs the board everyone", async () => {
    ctx = { orgId: "org-1", userId: "u1", role: "staff", caps: new Set(["workboard"]) };
    expect(await (await GET(req())).json()).toEqual({ people: [{ uuid: "S-LUKE", name: "Luke Ingold" }], me: "s-luke" });
    ctx = { ...ctx, caps: new Set(["workboard", "workboard_manage"]) };
    expect((await (await GET(req())).json()).people.map((p: { name: string }) => p.name)).toEqual(["Alex Lorenz", "Luke Ingold"]);
  });

  it("puts a tech's own block on their day, from and to as its start and length", async () => {
    ctx = { orgId: "org-1", userId: "u1", role: "staff", caps: new Set(["workboard"]) };
    const res = await POST(req({ ...DOCTOR, staff: "S-LUKE" }));
    expect(res.status).toBe(200);
    expect(createBlock).toHaveBeenCalledWith(
      "org-1",
      "card-luke",
      { what: "Doctor", where: "Mona Vale", minutes: 90, place: { staffUuid: "S-LUKE", day: "2026-11-06", startMin: 900 } },
      null,
    );
  });

  it("refuses a tech someone else's day", async () => {
    ctx = { orgId: "org-1", userId: "u1", role: "staff", caps: new Set(["workboard"]) };
    const res = await POST(req({ ...DOCTOR, staff: "S-ALEX" }));
    expect(res.status).toBe(403);
    expect(createBlock).not.toHaveBeenCalled();
  });

  it("lets someone who runs the board block out anyone's time", async () => {
    ctx = { orgId: "org-1", userId: "u1", role: "manager", caps: new Set(["workboard", "workboard_manage"]) };
    expect((await POST(req({ ...DOCTOR, staff: "S-ALEX" }))).status).toBe(200);
  });

  it("asks for an end after the start", async () => {
    ctx = { orgId: "org-1", userId: "u1", role: "staff", caps: new Set(["workboard"]) };
    const res = await POST(req({ ...DOCTOR, staff: "S-LUKE", from: "16:30", to: "15:00" }));
    expect(res.status).toBe(400);
    expect((await res.json()).error).toBe("It has to end after it starts.");
  });
});
