/**
 * @jest-environment node
 *
 * Settings › Pay and holidays, the loader: who gets in, and what it hands
 * the screen. The gates are the settings gear's, unchanged: in with
 * `financials` or as an admin; the pay rules and Xero payroll matching only
 * with `financials`, the public holidays only for an admin; and nothing is
 * read for a group the viewer won't see. The screen is its own suite's.
 */

import type { ReactElement } from "react";

jest.mock("next/navigation", () => ({
  redirect: (to: string) => {
    throw new Error(`redirect ${to}`);
  },
}));
let session: { orgId?: string } | null = { orgId: "org-1" };
jest.mock("@/lib/auth0", () => ({ auth0: { getSession: jest.fn(async () => session) } }));

let role = "owner";
let financials = true;
jest.mock("@/lib/permissions-server", () => ({
  getDbRole: jest.fn(async () => role),
  can: jest.fn(async (c: string) => c === "financials" && financials),
}));

const getPaySettings = jest.fn(async (..._a: unknown[]) => ({ settings: { cycle: "Weekly" }, configured: false }));
jest.mock("@/lib/timepay/query", () => ({ getPaySettings: (...a: unknown[]) => getPaySettings(...a) }));
const loadHolidayManager = jest.fn(async () => ({ holidays: [], orgState: "NSW", today: "2026-10-25" }));
jest.mock("@/lib/timepay/leave-page", () => ({ loadHolidayManager: () => loadHolidayManager() }));
let xeroStatus: string | null = "connected";
const getConnectionView = jest.fn(async (..._a: unknown[]) => (xeroStatus ? { status: xeroStatus } : null));
jest.mock("@/lib/integrations/store", () => ({ getConnectionView: (...a: unknown[]) => getConnectionView(...a) }));

jest.mock("@/app/actions/timepay", () => ({ savePaySettings: jest.fn() }));
jest.mock("@/app/actions/xero-links", () => ({
  getLinkingData: jest.fn(),
  linkEmployee: jest.fn(),
  unlinkEmployee: jest.fn(),
  checkPayRates: jest.fn(),
  adoptWage: jest.fn(),
  adoptPayBasis: jest.fn(),
  adoptEmploymentType: jest.fn(),
}));
jest.mock("@/components/settings/pay-screen", () => ({ PayScreen: () => null }));

import PayPage from "../page";
import { savePaySettings } from "@/app/actions/timepay";
import * as xeroActions from "@/app/actions/xero-links";
import type { PayScreenProps } from "@/components/settings/pay-screen";

const props = async () => ((await PayPage()) as ReactElement<PayScreenProps>).props;

beforeEach(() => {
  session = { orgId: "org-1" };
  role = "owner";
  financials = true;
  xeroStatus = "connected";
  [getPaySettings, loadHolidayManager, getConnectionView].forEach((m) => m.mockClear());
});

it("sends a signed-out visitor to sign in", async () => {
  session = null;
  await expect(PayPage()).rejects.toThrow("redirect /auth/login");
});

it("turns away someone with neither `financials` nor admin", async () => {
  role = "manager";
  financials = false;
  await expect(PayPage()).rejects.toThrow("redirect /dashboard");
});

it("hands an owner the pay rules, the holidays and payroll matching", async () => {
  const p = await props();
  expect(getPaySettings).toHaveBeenCalledWith("org-1");
  expect(p.pay).toEqual({ settings: { cycle: "Weekly" }, configured: false, onSave: savePaySettings });
  expect(p.holidays).toEqual({ initial: { holidays: [], orgState: "NSW", today: "2026-10-25" } });
  expect(p.xero).toEqual({
    load: xeroActions.getLinkingData,
    onLink: xeroActions.linkEmployee,
    onUnlink: xeroActions.unlinkEmployee,
    onAdoptEmployment: xeroActions.adoptEmploymentType,
    onAdoptBasis: xeroActions.adoptPayBasis,
    onCheckPay: xeroActions.checkPayRates,
    onAdoptWage: xeroActions.adoptWage,
  });
});

it("an admin without `financials` gets the holidays, and nothing about pay is read", async () => {
  role = "admin";
  financials = false;
  const p = await props();
  expect(p.pay).toBeNull();
  expect(p.xero).toBeNull();
  expect(p.holidays).not.toBeNull();
  expect(getPaySettings).not.toHaveBeenCalled();
  expect(getConnectionView).not.toHaveBeenCalled();
});

it("a manager granted `financials` gets the pay rules and not the holidays", async () => {
  role = "manager";
  const p = await props();
  expect(p.pay).not.toBeNull();
  expect(p.holidays).toBeNull();
  expect(loadHolidayManager).not.toHaveBeenCalled();
});

it("leaves payroll matching out without a live Xero grant", async () => {
  xeroStatus = "needs_reauth";
  expect((await props()).xero).toBeNull();
  xeroStatus = null;
  expect((await props()).xero).toBeNull();
});
