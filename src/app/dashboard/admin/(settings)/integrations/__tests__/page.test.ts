/**
 * @jest-environment node
 *
 * Settings › Integrations, the page: owner-only, as each app's screen was,
 * both apps' reads side by side, and an OAuth round trip's outcome said in
 * the group of the app it came back from. ServiceM8's and Xero's own
 * addresses, where their callbacks land, send you on to it with that
 * outcome. What each loader reads is its own suite's.
 */

import type { ReactElement } from "react";

jest.mock("next/navigation", () => ({
  redirect: (to: string) => {
    throw new Error(`redirect ${to}`);
  },
}));
const getSession = jest.fn(async (): Promise<unknown> => ({ orgId: "org-1" }));
jest.mock("@/lib/auth0", () => ({ auth0: { getSession: () => getSession() } }));
let role = "owner";
jest.mock("@/lib/permissions-server", () => ({ getDbRole: jest.fn(async () => role) }));
jest.mock("@/components/integrations/integrations-screen", () => ({ IntegrationsScreen: () => null }));

const loadServicem8 = jest.fn(async (..._a: unknown[]) => ({ app: "servicem8" }));
const loadXero = jest.fn(async (..._a: unknown[]) => ({ app: "xero" }));
jest.mock("../load", () => ({
  loadServicem8: (...a: unknown[]) => loadServicem8(...a),
  loadXero: (...a: unknown[]) => loadXero(...a),
}));

/* Tiff's email address and what came in last (28 October 2026): read beside the apps */
const readEmailAddress = jest.fn(async (..._a: unknown[]): Promise<unknown> => null);
const lastEmailIn = jest.fn(async (..._a: unknown[]): Promise<unknown> => null);
jest.mock("@/lib/email/inbound-server", () => ({
  readEmailAddress: (...a: unknown[]) => readEmailAddress(...a),
  lastEmailIn: (...a: unknown[]) => lastEmailIn(...a),
}));

import IntegrationsPage from "../page";
import Servicem8IntegrationPage from "../servicem8/page";
import XeroIntegrationPage from "../xero/page";
import { integrationsAddress } from "../back-to";

type Params = Record<string, string | string[]>;
const page = async (params: Params = {}) =>
  ((await IntegrationsPage({ searchParams: Promise.resolve(params) })) as ReactElement<Record<string, unknown>>).props;

beforeEach(() => {
  role = "owner";
  getSession.mockReset().mockResolvedValue({ orgId: "org-1" });
  loadServicem8.mockClear();
  loadXero.mockClear();
});

describe("the page", () => {
  it("hands Email to Tiff the business's address and what came in last", async () => {
    readEmailAddress.mockResolvedValueOnce({ token: "k7m2q9xwab", madeAt: "2026-10-29T00:00:00Z" });
    lastEmailIn.mockResolvedValueOnce({ at: "2026-10-29T22:12:00Z", fromName: "Isaac Smith", fromAddress: "isaac@x.au", subject: "Fw: Tender", state: "refused" });
    const props = await page();
    expect(readEmailAddress).toHaveBeenCalledWith("org-1");
    expect(props.email).toEqual({
      address: "tiff-k7m2q9xwab@in.hey-tiff.com",
      last: { at: "2026-10-29T22:12:00Z", from: "Isaac Smith", subject: "Fw: Tender", refused: true },
    });
  });

  it("is owner-only: anyone else goes to the dashboard, nobody signed in to sign in", async () => {
    role = "admin";
    await expect(page()).rejects.toThrow("redirect /dashboard");
    getSession.mockResolvedValue(null);
    await expect(page()).rejects.toThrow("redirect /auth/login");
    expect(loadServicem8).not.toHaveBeenCalled();
    expect(loadXero).not.toHaveBeenCalled();
  });

  it("reads both apps for the session's workspace and hands each its group", async () => {
    const props = await page();
    expect(loadServicem8).toHaveBeenCalledWith("org-1", {});
    expect(loadXero).toHaveBeenCalledWith("org-1", {});
    expect(props).toEqual({ servicem8: { app: "servicem8" }, xero: { app: "xero" }, email: { address: null, last: null } });
  });

  it("reads them side by side, not one after the other", async () => {
    let release = () => {};
    loadServicem8.mockImplementationOnce(() => new Promise((r) => (release = () => r({ app: "servicem8" }))));
    const pending = page();
    await new Promise((r) => setTimeout(r, 0));
    // ServiceM8's read hasn't come back, and Xero's has already begun
    expect(loadXero).toHaveBeenCalled();
    release();
    await pending;
  });

  it("says a round trip's outcome only in the group of the app it came back from", async () => {
    await page({ from: "servicem8", connected: "1", switched: "1" });
    expect(loadServicem8).toHaveBeenLastCalledWith("org-1", { from: "servicem8", connected: "1", switched: "1" });
    expect(loadXero).toHaveBeenLastCalledWith("org-1", {});

    await page({ from: "xero", error: "denied" });
    expect(loadServicem8).toHaveBeenLastCalledWith("org-1", {});
    expect(loadXero).toHaveBeenLastCalledWith("org-1", { from: "xero", error: "denied" });
  });

  it("says nothing for an outcome that names no app", async () => {
    await page({ connected: "1" });
    expect(loadServicem8).toHaveBeenLastCalledWith("org-1", {});
    expect(loadXero).toHaveBeenLastCalledWith("org-1", {});
  });
});

describe("ServiceM8's and Xero's own addresses", () => {
  const sub = (p: typeof Servicem8IntegrationPage, params: Params = {}) => p({ searchParams: Promise.resolve(params) });

  it("send the callback's outcome on to the one page", async () => {
    await expect(sub(Servicem8IntegrationPage, { connected: "1", switched: "1" })).rejects.toThrow(
      "redirect /dashboard/admin/integrations?from=servicem8&connected=1&switched=1"
    );
    await expect(sub(XeroIntegrationPage, { error: "denied" })).rejects.toThrow(
      "redirect /dashboard/admin/integrations?from=xero&error=denied#xero"
    );
  });

  it("send a plain link on with nothing in the query", async () => {
    await expect(sub(Servicem8IntegrationPage)).rejects.toThrow("redirect /dashboard/admin/integrations");
    await expect(sub(XeroIntegrationPage)).rejects.toThrow("redirect /dashboard/admin/integrations#xero");
  });

  it("stay owner-only", async () => {
    role = "admin";
    await expect(sub(Servicem8IntegrationPage, { connected: "1" })).rejects.toThrow("redirect /dashboard");
    await expect(sub(XeroIntegrationPage, { connected: "1" })).rejects.toThrow("redirect /dashboard");
  });

  it("carry only the outcome's own codes, the first of each", () => {
    expect(integrationsAddress("servicem8", { connected: ["1", "2"], next: "https://example.com", error: "" })).toBe(
      "/dashboard/admin/integrations?from=servicem8&connected=1"
    );
  });
});
