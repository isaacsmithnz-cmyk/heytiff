jest.mock("@/lib/supabase-server", () => ({ supabaseAdmin: {} }));
jest.mock("@/lib/quotes/lines-server", () => ({ namesBySignIn: async () => ({}) }));

import { readyOf } from "@/lib/quotes/ready-to-send-server";

const draft = (job: string, proposal: Record<string, unknown> | null, sent: unknown = null) => ({ sm8_job_uuid: job, proposal, sent });

describe("which quotes are ready to send", () => {
  it("keeps one whose approval stands, and leaves out one changed since, one sent, and one never marked", () => {
    const ready = readyOf(
      [
        draft("stands", { approvedAt: "2026-11-05T03:31:25.534Z", approvedBy: "auth0|lyle", updatedAt: "2026-11-05T03:14:40.184Z" }),
        draft("changed", { approvedAt: "2026-10-21T01:16:52.603Z", approvedBy: "auth0|lyle", updatedAt: "2026-10-21T01:10:00.000Z" }),
        draft("sent", { approvedAt: "2026-11-05T03:31:25.534Z", updatedAt: "2026-11-05T03:14:40.184Z" }, { at: "2026-11-05T04:00:00Z", by: "auth0|lyle", trial: false }),
        draft("trial", { approvedAt: "2026-11-05T03:31:25.534Z", updatedAt: "2026-11-05T03:14:40.184Z" }, { at: "2026-11-05T04:00:00Z", by: "auth0|lyle", trial: true }),
        draft("never", { approvedAt: null, updatedAt: "2026-11-05T03:14:40.184Z" }),
      ],
      new Map([
        ["stands", ["2026-11-05T03:31:14.036Z"]],
        ["changed", ["2026-10-21T01:22:18.258Z"]],
      ])
    );
    expect([...ready.keys()]).toEqual(["stands", "trial"]);
    expect(ready.get("stands")).toEqual({ at: "2026-11-05T03:31:25.534Z", by: "auth0|lyle" });
  });
});
