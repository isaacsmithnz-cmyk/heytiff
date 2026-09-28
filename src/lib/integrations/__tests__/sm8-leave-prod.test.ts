/**
 * @jest-environment node
 */

/* THE QUESTION THAT KEEPS PRODUCTION AS IT IS (leave to ServiceM8): with
   SM8_WRITES not naming `leave` — production today names files, notes and
   bookings — nothing about leave changes. Neither door reads or writes
   anything, the run reads what it always read, and the owner's counts make
   the queries they always made. */

import { makeFakeDb } from "./fixtures/sm8-fake-db";

const fake = makeFakeDb();
jest.mock("@/lib/supabase-server", () => ({
  supabaseAdmin: {
    from: (t: string) => fake.from(t),
    rpc: (n: string, a: Record<string, unknown>) => fake.rpc(n, a),
    storage: { from: () => ({ download: async () => ({ data: null, error: { message: "none" } }) }) },
  },
}));
jest.mock("../sm8-store", () => ({
  sm8AccessResult: jest.fn(async () => ({ ok: true, access: { accessToken: "t", tenantId: "vendor-1", grant: "g", meter: "vendor-1" } })),
  renewSm8Access: jest.fn(),
  markSm8NeedsReauth: jest.fn(),
}));
const getSession = jest.fn();
jest.mock("@/lib/auth0", () => ({ auth0: { getSession: (...a: unknown[]) => getSession(...a) } }));
jest.mock("@/lib/fleet/query", () => ({ staffProfileIdFor: jest.fn(async () => "staff-boss") }));
jest.mock("next/server", () => ({ after: () => {} }));
jest.mock("@/lib/workboard/job-notes-query", () => ({ staffDisplayNames: jest.fn(async () => new Map()) }));

import { sm8PressFromSession } from "../sm8-press";
import { runSm8Writes } from "../sm8-writes";
import { countWaitingSm8WritesByKind } from "../sm8-write-cancel";
import { sm8LeaveAllowed } from "../sm8-kinds";
import { queueLeaveOffBoard, queueLeaveOnBoard } from "@/app/actions/sm8-leave-queue";

const ORG = "org-1";

beforeEach(() => {
  fake.reset();
  fake.db.integration_connections = [
    {
      org_id: ORG,
      provider: "servicem8",
      status: "connected",
      tenant_id: "vendor-1",
      tenants: [],
      scopes: "vendor manage_attachments publish_job_notes manage_schedule manage_jobs",
      write_mode: "live",
      paused_reason: null,
      paused_at: null,
      write_scope_refused: {},
      connected_at: "2026-09-01T00:00:00.000Z",
      /* even an owner switch naming leave changes nothing without the
         deployment's */
      write_kinds: ["attachment", "booking", "leave", "note"],
    },
  ];
  fake.db.sm8_writes = [];
  getSession.mockResolvedValue({ orgId: ORG, user: { sub: "auth0|boss" } });
  jest.spyOn(console, "error").mockImplementation(() => {});
});

afterEach(() => jest.restoreAllMocks());
afterAll(() => {
  delete process.env.SM8_WRITES;
});

describe.each(["1", "attachment,note", "attachment,note,booking"])("with SM8_WRITES=%s (no leave)", (setting) => {
  beforeEach(() => {
    process.env.SM8_WRITES = setting;
  });

  it("allows no leave", () => {
    expect(sm8LeaveAllowed()).toBe(false);
  });

  it("the doors read and write nothing at all", async () => {
    const press = (await sm8PressFromSession())!;
    fake.log.length = 0;
    const on = await queueLeaveOnBoard(press, { source: "leave", id: "r1", staffProfileId: "s", kind: "annual", from: "2026-10-05", to: "2026-10-05" });
    const off = await queueLeaveOffBoard(press, { source: "leave", id: "r1" });
    expect(on).toEqual({ queued: [], note: null });
    expect(off).toEqual({ queued: [], note: null });
    expect(fake.log).toEqual([]);
  });

  it("the run reads no leave column and no leave row", async () => {
    fake.log.length = 0;
    await runSm8Writes(ORG, "kick", { clock: Date.now });
    const reads = fake.on("sm8_writes").filter((s) => s.op === "select");
    for (const r of reads) expect(r.columns ?? "").not.toMatch(/leave_/);
  });

  it("the owner's counts make no leave query", async () => {
    fake.log.length = 0;
    const kinds = await countWaitingSm8WritesByKind(ORG, Date.now());
    expect(kinds.leave).toBe(0);
    expect(fake.on("sm8_writes").filter((s) => s.filters.includes("kind=leave"))).toEqual([]);
  });
});

describe("the leave and day-off actions", () => {
  it("load none of the board's modules without leave allowed", () => {
    /* read as text: the queue and the press are imported only inside
       sm8Board, behind sm8LeaveAllowed() */
    const { readFileSync } = jest.requireActual<typeof import("node:fs")>("node:fs");
    for (const file of ["src/app/actions/leave.ts", "src/app/actions/timepay.ts"]) {
      const text = readFileSync(file, "utf8");
      expect(text).not.toMatch(/^import[^;]*sm8-leave-queue/m);
      expect(text).not.toMatch(/^import[^;]*sm8-press/m);
      expect(text).toMatch(/async function sm8Board\(\) \{\n\s+if \(!sm8LeaveAllowed\(\)\) return null;/);
    }
  });
});
