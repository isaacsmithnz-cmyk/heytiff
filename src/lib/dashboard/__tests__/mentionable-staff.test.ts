/* One name resolver, one answer.

   `mentionableStaff` used to read `preferred_name || full_name` by hand, and
   didn't even select first_name/last_name. Since #122 made first/last the
   source of truth and full_name merely derived, a card whose full_name had
   fallen out of step was mentionable under a different name from the one the
   board printed on that person's own comments — and with full_name empty, only
   as "Unnamed", which nobody can type. It goes through displayNameOf now, like
   every other name in the app. */

let rows: Record<string, unknown>[] = [];
const selected = jest.fn();

const table = () => {
  const chain: Record<string, unknown> = {};
  chain.eq = () => chain;
  chain.select = (cols: string) => {
    selected(cols);
    return chain;
  };
  chain.then = (res: (v: { data: unknown }) => unknown) =>
    Promise.resolve({ data: rows }).then(res);
  return chain;
};

jest.mock("@/lib/supabase-server", () => ({ supabaseAdmin: { from: () => table() } }));

import { mentionableStaff } from "../tasks-query";
import { displayNameOf } from "@/lib/staff/name";

beforeEach(() => {
  selected.mockClear();
  rows = [];
});

describe("mentionableStaff", () => {
  it("selects the name parts, not just full_name", async () => {
    await mentionableStaff("org-1");
    const cols = selected.mock.calls[0][0] as string;
    expect(cols).toContain("first_name");
    expect(cols).toContain("last_name");
    expect(cols).toContain("preferred_name");
  });

  it("names people the way displayNameOf does", async () => {
    rows = [
      { id: "a", first_name: "Dave", last_name: "Jones", full_name: "Dave Jones", preferred_name: null },
      { id: "b", first_name: "Susan", last_name: "Reed", full_name: "Susan Reed", preferred_name: "Sue" },
    ];
    const out = await mentionableStaff("org-1");
    expect(out).toEqual([
      { id: "a", name: "Dave Jones" },
      { id: "b", name: "Sue" },
    ]);
    for (const [i, r] of rows.entries()) expect(out[i].name).toBe(displayNameOf(r));
  });

  it("uses the name parts when full_name has gone stale", async () => {
    // the case the old hand-rolled resolver got wrong
    rows = [{ id: "a", first_name: "Dave", last_name: "Jones", full_name: "Dave Smith", preferred_name: null }];
    const [target] = await mentionableStaff("org-1");
    expect(target.name).toBe("Dave Jones");
  });

  it("still resolves a name when full_name is empty", async () => {
    rows = [{ id: "a", first_name: "Dave", last_name: "Jones", full_name: null, preferred_name: null }];
    const [target] = await mentionableStaff("org-1");
    expect(target.name).toBe("Dave Jones");
  });

  it("falls back to Unnamed only when there is genuinely nothing", async () => {
    rows = [{ id: "a", first_name: null, last_name: null, full_name: null, preferred_name: null }];
    const [target] = await mentionableStaff("org-1");
    expect(target.name).toBe("Unnamed");
  });
});
