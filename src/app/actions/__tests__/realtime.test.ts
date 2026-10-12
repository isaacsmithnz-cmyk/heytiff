/* A TICKET TO LIVE RECORDS: unless the deployment has switched them off,
   only when it can sign, only for a session in a workspace, and with the
   name the others see. */

jest.unmock("@/app/actions/realtime");

const session = jest.fn(async (): Promise<Record<string, unknown> | null> => ({
  user: { sub: "auth0|me", name: "me@example.com" },
  orgId: "org-1",
}));
jest.mock("@/lib/auth0", () => ({ auth0: { getSession: () => session() } }));
jest.mock("@/lib/staff/query", () => ({
  getViewerName: async () => ({ full: "Dane Mitchell", first: "Dane" }),
}));

import { realtimeTicket } from "../realtime";

const env = { ...process.env };
/* On is the flag unset. */
beforeEach(() => {
  process.env = { ...env, SUPABASE_JWT_SECRET: "s3cret" };
  delete process.env.NEXT_PUBLIC_LIVE_RECORDS;
});
afterAll(() => {
  process.env = env;
});

it("signs a ticket for the session's workspace, with the viewer's first name", async () => {
  const t = await realtimeTicket();
  expect(t).toMatchObject({ orgId: "org-1", me: { id: "auth0|me", name: "Dane" } });
  expect(t!.token.split(".")).toHaveLength(3);
});

it("is nothing while the deployment has live records switched off", async () => {
  process.env.NEXT_PUBLIC_LIVE_RECORDS = "0";
  expect(await realtimeTicket()).toBeNull();
});

it("is nothing without a secret to sign with", async () => {
  delete process.env.SUPABASE_JWT_SECRET;
  expect(await realtimeTicket()).toBeNull();
});

it("is nothing without a session in a workspace", async () => {
  session.mockResolvedValueOnce({ user: { sub: "auth0|me" } });
  expect(await realtimeTicket()).toBeNull();
});
