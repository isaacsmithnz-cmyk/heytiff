/**
 * @jest-environment node
 */

/* Push to a person's phones: only to the phones of the staff named, in
   their own workspace; one POST to Expo in its own format; a phone Expo
   says is gone is deleted; and nothing it does can fail the work that
   asked for it. */

jest.mock("server-only", () => ({}));
type Row = Record<string, unknown>;
let staff: Row[] = [];
let devices: Row[] = [];
const deleted: string[][] = [];
jest.mock("@/lib/supabase-server", () => ({
  supabaseAdmin: {
    from: (table: string) => {
      const f: Record<string, unknown> = {};
      const q: Record<string, unknown> = {
        select: () => q,
        eq: (c: string, v: unknown) => ((f[c] = v), q),
        in: (c: string, v: unknown) => {
          if (table === "mobile_push_devices" && f.deleting) {
            deleted.push(v as string[]);
            return Promise.resolve({ error: null });
          }
          f[c] = v;
          return q;
        },
        delete: () => ((f.deleting = true), q),
        then: (res: (v: unknown) => unknown) => {
          if (table === "staff_profiles")
            return res({ data: staff.filter((s) => s.org_id === f.org_id && (f.id as string[]).includes(s.id as string)), error: null });
          if (table === "mobile_push_devices")
            return res({ data: devices.filter((d) => d.org_id === f.org_id && (f.user_sub as string[]).includes(d.user_sub as string)), error: null });
          return res({ data: [], error: null });
        },
      };
      return q;
    },
  },
}));

import { EXPO_PUSH_URL, pushToStaff } from "../push";

const sent: { url: string; body: unknown }[] = [];
const expo = (tickets: unknown[], status = 200) =>
  jest.fn(async (url: string, init?: RequestInit) => {
    sent.push({ url, body: JSON.parse(String(init?.body)) });
    return new Response(JSON.stringify({ data: tickets }), { status });
  }) as unknown as typeof fetch;

beforeEach(() => {
  sent.length = 0;
  deleted.length = 0;
  staff = [
    { id: "s-lyle", org_id: "org-1", user_id: "auth0|lyle" },
    { id: "s-otto", org_id: "org-2", user_id: "auth0|otto" },
  ];
  devices = [
    { token: "ExponentPushToken[lyle-phone-0001]", org_id: "org-1", user_sub: "auth0|lyle" },
    { token: "ExponentPushToken[lyle-tablet-001]", org_id: "org-1", user_sub: "auth0|lyle" },
    { token: "ExponentPushToken[otto-phone-0001]", org_id: "org-2", user_sub: "auth0|otto" },
  ];
});

it("sends to every phone the person is on, in Expo's own format, opening the screen it names", async () => {
  const f = expo([{ status: "ok", id: "r1" }, { status: "ok", id: "r2" }]);
  const n = await pushToStaff("org-1", ["s-lyle"], { title: "Michael gave you a task", body: "Grab a 15 m coil", path: "/job?id=j-2935" }, f);
  expect(n).toBe(2);
  expect(sent).toHaveLength(1);
  expect(sent[0]!.url).toBe(EXPO_PUSH_URL);
  expect(sent[0]!.body).toEqual([
    { to: "ExponentPushToken[lyle-phone-0001]", title: "Michael gave you a task", body: "Grab a 15 m coil", data: { path: "/job?id=j-2935" }, sound: "default", channelId: "heytiff", priority: "high" },
    { to: "ExponentPushToken[lyle-tablet-001]", title: "Michael gave you a task", body: "Grab a 15 m coil", data: { path: "/job?id=j-2935" }, sound: "default", channelId: "heytiff", priority: "high" },
  ]);
});

it("never reaches another workspace's phones, even for a staff id it names", async () => {
  const f = expo([]);
  expect(await pushToStaff("org-1", ["s-otto"], { title: "x" }, f)).toBe(0);
  expect(sent).toHaveLength(0);
});

it("deletes a phone Expo says is gone", async () => {
  const f = expo([{ status: "error", details: { error: "DeviceNotRegistered" } }, { status: "ok", id: "r2" }]);
  expect(await pushToStaff("org-1", ["s-lyle"], { title: "x" }, f)).toBe(1);
  expect(deleted).toEqual([["ExponentPushToken[lyle-phone-0001]"]]);
});

it("opens the list when it names no screen", async () => {
  const f = expo([{ status: "ok" }, { status: "ok" }]);
  await pushToStaff("org-1", ["s-lyle"], { title: "A task for you" }, f);
  expect((sent[0]!.body as { data: unknown }[])[0]!.data).toEqual({ path: "/notifications" });
});

it("never throws: Expo down or a network failure sends nothing and says so in the log", async () => {
  const err = jest.spyOn(console, "error").mockImplementation(() => {});
  expect(await pushToStaff("org-1", ["s-lyle"], { title: "x" }, expo([], 503))).toBe(0);
  const boom = jest.fn(async () => {
    throw new Error("socket hang up");
  }) as unknown as typeof fetch;
  expect(await pushToStaff("org-1", ["s-lyle"], { title: "x" }, boom)).toBe(0);
  expect(err).toHaveBeenCalled();
  err.mockRestore();
});

it("sends nothing to someone with no phone", async () => {
  devices = [];
  const f = expo([]);
  expect(await pushToStaff("org-1", ["s-lyle"], { title: "x" }, f)).toBe(0);
  expect(sent).toHaveLength(0);
});
