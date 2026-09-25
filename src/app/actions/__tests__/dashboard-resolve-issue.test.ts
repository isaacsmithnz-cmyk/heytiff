/* Resolving an issue closes the row without removing it — the "this keeps
   happening" memory is the point of the table — under the same gate as the
   note that raised it. */

const update = jest.fn();
let issueRow: Record<string, unknown> | null = { resolved: false };
let allowed = true;
let writeError: { message: string } | null = null;

/* Every filter each query was narrowed by, the read and the write kept apart.
   supabaseAdmin passes RLS by, so `org_id` on BOTH is the only thing that
   keeps one workspace's press off another's row: a mock that swallowed its
   arguments would pass with either filter gone. */
let tables: string[] = [];
let readFilters: [string, unknown][] = [];
let writeFilters: [string, unknown][] = [];

const table = (name: string) => {
  tables.push(name);
  const chain: Record<string, unknown> = {};
  chain.select = () => chain;
  chain.eq = (col: string, val: unknown) => {
    readFilters.push([col, val]);
    return chain;
  };
  chain.maybeSingle = async () => ({ data: issueRow });
  chain.update = (patch: Record<string, unknown>) => {
    update(patch);
    const done: Record<string, unknown> = {};
    done.eq = (col: string, val: unknown) => {
      writeFilters.push([col, val]);
      return done;
    };
    done.then = (res: (v: { error: typeof writeError }) => unknown) =>
      Promise.resolve({ error: writeError }).then(res);
    return done;
  };
  return chain;
};

jest.mock("@/lib/supabase-server", () => ({
  supabaseAdmin: { from: (name: string) => table(name) },
}));
jest.mock("@/lib/auth0", () => ({
  auth0: { getSession: jest.fn().mockResolvedValue({ user: { sub: "auth0|me" }, orgId: "org-1" }) },
}));
jest.mock("@/lib/permissions-server", () => ({ can: jest.fn(async () => allowed) }));
jest.mock("@/lib/fleet/query", () => ({ staffProfileIdFor: jest.fn(async () => "staff-1") }));
jest.mock("@/lib/workboard/query", () => ({ getSm8Timezone: jest.fn(async () => null) }));
jest.mock("next/cache", () => ({ revalidatePath: jest.fn() }));

import { reopenIssue, resolveIssue } from "../dashboard";
import { can } from "@/lib/permissions-server";

beforeEach(() => {
  update.mockClear();
  (can as jest.Mock).mockClear();
  issueRow = { resolved: false };
  allowed = true;
  writeError = null;
  tables = [];
  readFilters = [];
  writeFilters = [];
});

it("marks the row resolved and leaves it standing", async () => {
  expect(await resolveIssue("i1")).toEqual({ ok: true });
  expect(update).toHaveBeenCalledWith({ resolved: true });
});

it("reads and writes only this workspace's row", async () => {
  await resolveIssue("i1");
  expect(tables).toEqual(["workboard_issues", "workboard_issues"]);
  expect(readFilters).toEqual(expect.arrayContaining([["org_id", "org-1"], ["id", "i1"]]));
  expect(writeFilters).toEqual(expect.arrayContaining([["org_id", "org-1"], ["id", "i1"]]));
});

it("says so when the write fails", async () => {
  writeError = { message: "boom" };
  expect(await resolveIssue("i1")).toEqual({ ok: false, error: "Couldn't resolve that issue." });
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

/* Undo on Home's list. Mark resolved is one press, so it has to come back,
   under the same gate: whoever may close it may take the close back. */
describe("reopenIssue", () => {
  beforeEach(() => {
    issueRow = { resolved: true };
  });

  it("opens the row again, as it was", async () => {
    expect(await reopenIssue("i1")).toEqual({ ok: true });
    expect(update).toHaveBeenCalledWith({ resolved: false });
  });

  /* Undo reaches a row by its id alone, so the workspace has to ride on the
     read that checks it AND the write that flips it: an id from another
     workspace must find nothing and change nothing. */
  it("reads and writes only this workspace's row", async () => {
    await reopenIssue("i1");
    expect(tables).toEqual(["workboard_issues", "workboard_issues"]);
    expect(readFilters).toEqual(expect.arrayContaining([["org_id", "org-1"], ["id", "i1"]]));
    expect(writeFilters).toEqual(expect.arrayContaining([["org_id", "org-1"], ["id", "i1"]]));
  });

  it("says so when the write fails", async () => {
    writeError = { message: "boom" };
    expect(await reopenIssue("i1")).toEqual({ ok: false, error: "Couldn't reopen that issue." });
  });

  it("asks for the workboard, the gate resolving it asks for", async () => {
    allowed = false;
    expect(await reopenIssue("i1")).toEqual({ ok: false, error: "Issues need the workboard." });
    expect(can).toHaveBeenCalledWith("workboard");
    expect(update).not.toHaveBeenCalled();
  });

  it("refuses an issue that is gone, or already open", async () => {
    issueRow = null;
    expect(await reopenIssue("i1")).toEqual({ ok: false, error: "That issue no longer exists." });
    issueRow = { resolved: false };
    expect(await reopenIssue("i1")).toEqual({ ok: false, error: "That issue is already open." });
    expect(update).not.toHaveBeenCalled();
  });
});
