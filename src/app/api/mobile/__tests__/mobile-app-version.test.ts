/**
 * @jest-environment node
 */

/* The newest install the phone's Update button offers: signed in only, and a
   real version and file for Android. */

const requireMobile = jest.fn();
jest.mock("@/lib/mobile/auth", () => ({
  requireMobile: (r: Request) => requireMobile(r),
  ok: (body: unknown) => Response.json(body),
}));

import { GET } from "../app-version/route";

const asked = () => new Request("https://x.test/api/mobile/app-version");

describe("GET /api/mobile/app-version", () => {
  it("tells nobody who isn't signed in", async () => {
    requireMobile.mockResolvedValue(new Response(null, { status: 401 }));
    expect((await GET(asked())).status).toBe(401);
  });

  it("gives a signed-in phone the newest Android version and its file", async () => {
    requireMobile.mockResolvedValue({ userId: "u1" });
    const { android } = (await (await GET(asked())).json()) as { android: { version: string; url: string } };
    expect(android.version).toMatch(/^\d+\.\d+\.\d+$/);
    expect(android.url).toMatch(/^https:\/\/.+\.apk$/);
  });
});
