/**
 * @jest-environment node
 */

/* sm8VendorOf — the account's clock, and whether the workspace has a
   ServiceM8 copy at all. The second answer decides whether Home's day may
   say anything about ServiceM8, so an unreadable row must not pass for an
   absent one: that would call a day complete that nobody could read. */

let answer: { data: unknown; error: unknown } = { data: null, error: null };
const asked: { table: string; cols: string; eq: [string, unknown][] }[] = [];
jest.mock("@/lib/supabase-server", () => ({
  supabaseAdmin: {
    from: (table: string) => {
      const call = { table, cols: "", eq: [] as [string, unknown][] };
      asked.push(call);
      const chain = {
        select: (cols: string) => {
          call.cols = cols;
          return chain;
        },
        eq: (col: string, v: unknown) => {
          call.eq.push([col, v]);
          return chain;
        },
        maybeSingle: async () => answer,
      };
      return chain;
    },
  },
}));

import { sm8VendorOf } from "../query";

beforeEach(() => {
  asked.length = 0;
  jest.spyOn(console, "error").mockImplementation(() => {});
});
afterEach(() => jest.restoreAllMocks());

it("reads the one sm8_vendor row for the workspace", async () => {
  answer = { data: { timezone_name: "Australia/Brisbane" }, error: null };
  expect(await sm8VendorOf("org-1")).toEqual({ tz: "Australia/Brisbane", connected: true });
  expect(asked).toEqual([{ table: "sm8_vendor", cols: "timezone_name", eq: [["org_id", "org-1"]] }]);
});

it("is connected with no zone when the row names none", async () => {
  answer = { data: { timezone_name: null }, error: null };
  expect(await sm8VendorOf("org-1")).toEqual({ tz: null, connected: true });
});

it("is not connected when the workspace has no row — it never had ServiceM8", async () => {
  answer = { data: null, error: null };
  expect(await sm8VendorOf("org-1")).toEqual({ tz: null, connected: false });
});

it("stays connected when the read fails, so nothing claims a day it could not see", async () => {
  answer = { data: null, error: { message: "timeout" } };
  expect(await sm8VendorOf("org-1")).toEqual({ tz: null, connected: true });
  expect(console.error).toHaveBeenCalled();
});
