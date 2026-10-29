/**
 * @jest-environment node
 */
/* A phone's failure lands in the server log, with who and where, and nothing else. */
jest.mock("@/lib/mobile/auth", () => ({
  requireMobile: async (r: Request) => (r.headers.get("authorization") ? { userId: "auth0|isaac", orgId: "org" } : new Response(null, { status: 401 })),
  ok: (b: unknown) => Response.json(b),
}));
import { POST } from "@/app/api/mobile/log/route";

const req = (body: unknown, auth = true) =>
  new Request("https://go.hey-tiff.com/api/mobile/log", { method: "POST", headers: auth ? { authorization: "Bearer t" } : {}, body: JSON.stringify(body) });

test("a failure is written to the log, one line, cut short", async () => {
  const warn = jest.spyOn(console, "warn").mockImplementation(() => {});
  const res = await POST(req({ where: "dictation.start", message: "prepare failed\nline two " + "x".repeat(500), app: "1.0.6" }));
  expect(res.status).toBe(200);
  const line = String(warn.mock.calls[0]?.[0]);
  expect(line).toMatch(/^\[phone\] auth0\|isaac 1\.0\.6 dictation\.start: prepare failed line two x+$/);
  expect(line.length).toBeLessThan(700);
  warn.mockRestore();
});

test("signed out, or saying nothing, writes nothing", async () => {
  const warn = jest.spyOn(console, "warn").mockImplementation(() => {});
  expect((await POST(req({ where: "x" }, false))).status).toBe(401);
  expect((await POST(req({ message: "no where" }))).status).toBe(400);
  expect(warn).not.toHaveBeenCalled();
  warn.mockRestore();
});
