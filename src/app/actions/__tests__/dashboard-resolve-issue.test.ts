/* Resolving an issue closes the row without removing it — the "this keeps
   happening" memory is the point of the table — under the same gate as the
   note that raised it. */

const update = jest.fn();
let issueRow: Record<string, unknown> | null = { resolved: false };
let allowed = true;

const table = () => {
  const chain: Record<string, unknown> = {};
  chain.select = () => chain;
  chain.eq = () => chain;
  chain.maybeSingle = async () => ({ data: issueRow });
  chain.update = (patch: Record<string, unknown>) => {
    update(patch);
    const done: Record<string, unknown> = {};
    done.eq = () => done;
    done.then = (res: (v: { error: null }) => unknown) => Promise.resolve({ error: null }).then(res);
    return done;
  };
  return chain;
};

jest.mock("@/lib/supabase-server", () => ({ supabaseAdmin: { from: () => table() } }));
jest.mock("@/lib/auth0", () => ({
  auth0: { getSession: jest.fn().mockResolvedValue({ user: { sub: "auth0|me" }, orgId: "org-1" }) },
}));
jest.mock("@/lib/permissions-server", () => ({ can: jest.fn(async () => allowed) }));
jest.mock("@/lib/fleet/query", () => ({ staffProfileIdFor: jest.fn(async () => "staff-1") }));
jest.mock("@/lib/workboard/query", () => ({ getSm8Timezone: jest.fn(async () => null) }));
jest.mock("next/cache", () => ({ revalidatePath: jest.fn() }));

import { resolveIssue } from "../dashboard";

beforeEach(() => {
  update.mockClear();
  issueRow = { resolved: false };
  allowed = true;
});

it("marks the row resolved and leaves it standing", async () => {
  expect(await resolveIssue("i1")).toEqual({ ok: true });
  expect(update).toHaveBeenCalledWith({ resolved: true });
});

it("needs the workboard — the gate the note that raised it applied under", async () => {
  allowed = false;
  expect(await resolveIssue("i1")).toEqual({ ok: false, error: "Issues need the workboard." });
  expect(update).not.toHaveBeenCalled();
});

it("says so when the issue is gone, or already closed", async () => {
  issueRow = null;
  expect(await resolveIssue("i1")).toEqual({ ok: false, error: "That issue no longer exists." });
  issueRow = { resolved: true };
  expect(await resolveIssue("i1")).toEqual({ ok: false, error: "That issue is already resolved." });
  expect(update).not.toHaveBeenCalled();
});
