/**
 * @jest-environment node
 *
 * What the connect route asks ServiceM8 for: the reads always, and the write
 * permission of the kinds this deployment allows while the owner has
 * sending On or Paused. On a deployment that writes, settings that can't be
 * read refuse the connect — guessing "off" would ask for reads alone, and a
 * reconnect of a live workspace would drop the permission its sending
 * depends on.
 */

jest.mock("@/lib/auth0", () => ({
  auth0: { getSession: jest.fn(async () => ({ orgId: "org-1", user: { sub: "auth0|me" } })) },
}));
jest.mock("@/lib/permissions-server", () => ({ getDbRole: jest.fn(async () => "owner") }));
jest.mock("@/lib/integrations/secrets", () => ({ tokenKey: () => "k".repeat(64) }));
jest.mock("@/lib/integrations/sm8", () => ({
  sm8Config: () => ({ clientId: "id", clientSecret: "secret", redirectUri: "https://app.test/cb" }),
  buildSm8ConsentUrl: (_cfg: unknown, state: string, scopes: string[]) =>
    `https://go.servicem8.com/oauth/authorize?state=${state}&scope=${encodeURIComponent(scopes.join(" "))}`,
}));

const readSm8WriteState = jest.fn();
jest.mock("@/lib/integrations/sm8-writes", () => ({
  readSm8WriteState: (...a: unknown[]) => readSm8WriteState(...a),
}));

import { GET } from "../connect/route";
import { SM8_SCOPE_LIST } from "@/lib/integrations/providers";

const state = (over: Record<string, unknown> = {}) => ({
  readable: true,
  kinds: ["attachment"],
  deployment: true,
  mode: "live",
  modeStored: "live",
  pausedReason: null,
  pausedAt: null,
  linked: true,
  connected: true,
  tenantId: "vendor-1",
  granted: ["attachment"],
  refused: [],
  timezoneName: null,
  ...over,
});

const connect = async () => {
  const res = await GET(new Request("https://app.test/api/integrations/servicem8/connect"));
  return new URL(res.headers.get("location")!);
};
const asked = (url: URL) => (url.searchParams.get("scope") ?? "").split(" ");

beforeEach(() => {
  readSm8WriteState.mockReset().mockResolvedValue(state());
});

describe("the ServiceM8 connect route", () => {
  it("asks for the write permission while sending is On", async () => {
    const url = await connect();
    expect(url.host).toBe("go.servicem8.com");
    expect(asked(url)).toEqual([...SM8_SCOPE_LIST, "manage_attachments"]);
  });

  it("keeps asking for it while sending is Paused", async () => {
    readSm8WriteState.mockResolvedValue(state({ mode: "paused", modeStored: "paused", pausedReason: "owner" }));
    expect(asked(await connect())).toContain("manage_attachments");
  });

  it("asks for reads alone when sending is off, or the deployment writes nothing", async () => {
    readSm8WriteState.mockResolvedValue(state({ mode: "off", modeStored: "off" }));
    expect(asked(await connect())).toEqual(SM8_SCOPE_LIST);
    readSm8WriteState.mockResolvedValue(state({ kinds: [], deployment: false }));
    expect(asked(await connect())).toEqual(SM8_SCOPE_LIST);
  });

  it("refuses to connect when the settings can't be read, rather than dropping a permission", async () => {
    readSm8WriteState.mockResolvedValue(state({ readable: false, mode: "off", modeStored: null }));
    const url = await connect();
    expect(`${url.pathname}${url.search}`).toBe("/dashboard/admin/integrations/servicem8?error=settings");
  });

  it("connects for reads alone on a deployment that writes nothing, whether or not the settings read", async () => {
    /* a preview, or SM8_WRITES unset: it asks for the reads whatever the
       settings say, so a database without the write migration can't block it */
    readSm8WriteState.mockResolvedValue(state({ readable: false, deployment: false, kinds: [], mode: "off", modeStored: null }));
    const url = await connect();
    expect(url.host).toBe("go.servicem8.com");
    expect(asked(url)).toEqual(SM8_SCOPE_LIST);
  });
});
