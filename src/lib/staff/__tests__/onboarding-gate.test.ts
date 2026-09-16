/* redirectIfOnboardingPending — who Home sends to their own first run, and who
   it leaves alone. The owner is the one that matters most: they have /welcome,
   and a second first-run screen stacked behind it would be two welcomes. */

const redirect = jest.fn();
const getDbRole = jest.fn();
const onboardingPending = jest.fn();

let session: { user: { sub: string }; orgId?: string } | null = null;

jest.mock("next/navigation", () => ({ redirect: (...a: unknown[]) => redirect(...a) }));
jest.mock("@/lib/auth0", () => ({
  auth0: { getSession: jest.fn(() => Promise.resolve(session)) },
}));
jest.mock("@/lib/permissions-server", () => ({ getDbRole: (...a: unknown[]) => getDbRole(...a) }));
jest.mock("../onboarding", () => ({ onboardingPending: (...a: unknown[]) => onboardingPending(...a) }));

import { redirectIfOnboardingPending } from "../onboarding-gate";

beforeEach(() => {
  redirect.mockClear();
  getDbRole.mockReset().mockResolvedValue("staff");
  onboardingPending.mockReset().mockResolvedValue(true);
  session = { user: { sub: "auth0|luke" }, orgId: "org-1" };
});

it("sends a member who has never been asked to /welcome/details", async () => {
  await redirectIfOnboardingPending();
  expect(onboardingPending).toHaveBeenCalledWith("org-1", "auth0|luke");
  expect(redirect).toHaveBeenCalledWith("/welcome/details");
});

/* luke is an admin in production and was seeded "luke" like anybody else — an
   admin's card is no better than a crew member's. */
it("asks staff, managers and admins alike", async () => {
  for (const role of ["staff", "manager", "admin"]) {
    redirect.mockClear();
    getDbRole.mockResolvedValue(role);
    await redirectIfOnboardingPending();
    expect(redirect).toHaveBeenCalledWith("/welcome/details");
  }
});

it("never intercepts the owner, and doesn't even ask", async () => {
  getDbRole.mockResolvedValue("owner");
  await redirectIfOnboardingPending();
  expect(onboardingPending).not.toHaveBeenCalled();
  expect(redirect).not.toHaveBeenCalled();
});

it("leaves somebody who has answered — saved or skipped — alone", async () => {
  onboardingPending.mockResolvedValue(false);
  await redirectIfOnboardingPending();
  expect(redirect).not.toHaveBeenCalled();
});

it("stays out of the way of a session with no org", async () => {
  session = { user: { sub: "auth0|floating" } };
  await redirectIfOnboardingPending();
  expect(getDbRole).not.toHaveBeenCalled();
  expect(redirect).not.toHaveBeenCalled();
});
