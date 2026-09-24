/* One renewal per refused call, and a flag only for a second refusal under
   the renewed token. The store is a fake here: what is under test is the
   decision, and the store's own suite proves the refresh behind it. */

const renewSm8Access = jest.fn();
const markSm8NeedsReauth = jest.fn();
jest.mock("../sm8-store", () => ({
  renewSm8Access: (...a: unknown[]) => renewSm8Access(...a),
  markSm8NeedsReauth: (...a: unknown[]) => markSm8NeedsReauth(...a),
}));

import { withSm8Renewal } from "../sm8-renew";
import { SM8_REVOKED } from "../sm8-sync-plan";

const first = { accessToken: "tok-1", tenantId: "v-1", grant: "g1", meter: "v-1" };
const renewed = { accessToken: "tok-2", tenantId: "v-1", grant: "g2", meter: "v-1" };

type Answer = { status: number };
const refused = (a: Answer) => a.status === 401;

beforeEach(() => {
  renewSm8Access.mockReset().mockResolvedValue({ ok: true, access: renewed });
  markSm8NeedsReauth.mockReset().mockResolvedValue(true);
});

describe("withSm8Renewal", () => {
  it("an answer that wasn't refused is the answer: one call, no renewal", async () => {
    const call = jest.fn(async () => ({ status: 200 }));
    const out = await withSm8Renewal("org-1", first, call, refused);
    expect(out).toEqual({ result: { status: 200 }, access: first, tries: 1, verdict: "ok" });
    expect(renewSm8Access).not.toHaveBeenCalled();
  });

  it("a 401 cured by one renewal is ok, with the new access, and flags nothing", async () => {
    const call = jest.fn(async (a: { accessToken: string }) => ({ status: a.accessToken === "tok-1" ? 401 : 200 }));
    const out = await withSm8Renewal("org-1", first, call, refused);
    expect(out).toEqual({ result: { status: 200 }, access: renewed, tries: 2, verdict: "ok" });
    expect(renewSm8Access).toHaveBeenCalledWith("org-1", first);
    // the second call carried the whole renewed access, not just a string
    expect(call).toHaveBeenLastCalledWith(renewed);
    expect(markSm8NeedsReauth).not.toHaveBeenCalled();
  });

  it("a second 401 flags the RENEWED grant, once", async () => {
    const call = jest.fn(async () => ({ status: 401 }));
    const out = await withSm8Renewal("org-1", first, call, refused);
    expect(out.verdict).toBe("dead");
    expect(out.tries).toBe(2);
    expect(markSm8NeedsReauth).toHaveBeenCalledTimes(1);
    expect(markSm8NeedsReauth).toHaveBeenCalledWith("org-1", SM8_REVOKED, renewed);
  });

  it("at most one renewal per call", async () => {
    const call = jest.fn(async () => ({ status: 401 }));
    await withSm8Renewal("org-1", first, call, refused);
    expect(renewSm8Access).toHaveBeenCalledTimes(1);
    expect(call).toHaveBeenCalledTimes(2);
  });

  it("a renewal that couldn't reach ServiceM8 is unreachable, and flags nothing", async () => {
    renewSm8Access.mockResolvedValue({ ok: false, reason: "unreachable" });
    const call = jest.fn(async () => ({ status: 401 }));
    const out = await withSm8Renewal("org-1", first, call, refused);
    expect(out).toMatchObject({ verdict: "unreachable", tries: 1, access: first });
    expect(call).toHaveBeenCalledTimes(1);
    expect(markSm8NeedsReauth).not.toHaveBeenCalled();
  });

  it("a renewal that found the grant dead is dead, without a second flag", async () => {
    // the store flagged it when the refresh was refused
    renewSm8Access.mockResolvedValue({ ok: false, reason: "reauth" });
    const out = await withSm8Renewal("org-1", first, jest.fn(async () => ({ status: 401 })), refused);
    expect(out.verdict).toBe("dead");
    expect(markSm8NeedsReauth).not.toHaveBeenCalled();
  });

  it("no connection is gone", async () => {
    renewSm8Access.mockResolvedValue({ ok: false, reason: "not_connected" });
    const out = await withSm8Renewal("org-1", first, jest.fn(async () => ({ status: 401 })), refused);
    expect(out.verdict).toBe("gone");
  });

  it("renewed too late to try again hands the new access back without a second call", async () => {
    const call = jest.fn(async () => ({ status: 401 }));
    const out = await withSm8Renewal("org-1", first, call, refused, { retry: () => false });
    expect(out).toMatchObject({ verdict: "late", tries: 1, access: renewed });
    expect(call).toHaveBeenCalledTimes(1);
    expect(markSm8NeedsReauth).not.toHaveBeenCalled();
  });
});
