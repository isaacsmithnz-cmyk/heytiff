/* redirectIfSetupPending — who Home steers into first-run setup, and who it
   leaves alone. The leave-alones are the point: staff in a half-set-up org,
   org-less sessions and settled orgs must all pass through untouched. */

const redirect = jest.fn();
const getDbRole = jest.fn();
const orgSetupPending = jest.fn();

let session: { user: { sub: string }; orgId?: string } | null = null;

jest.mock("next/navigation", () => ({
  redirect: (...a: unknown[]) => redirect(...a),
}));
jest.mock("@/lib/auth0", () => ({
  auth0: { getSession: jest.fn(() => Promise.resolve(session)) },
}));
jest.mock("@/lib/permissions-server", () => ({
  getDbRole: (...a: unknown[]) => getDbRole(...a),
}));
jest.mock("../query", () => ({
  orgSetupPending: (...a: unknown[]) => orgSetupPending(...a),
}));

import { redirectIfSetupPending } from "../setup-gate";

beforeEach(() => {
  redirect.mockClear();
  getDbRole.mockReset().mockResolvedValue("owner");
  orgSetupPending.mockReset().mockResolvedValue(true);
  session = { user: { sub: "auth0|owner" }, orgId: "org-1" };
});

it("sends a fresh org's owner to /welcome", async () => {
  await redirectIfSetupPending();
  expect(orgSetupPending).toHaveBeenCalledWith("org-1");
  expect(redirect).toHaveBeenCalledWith("/welcome");
});

it("leaves a settled org alone", async () => {
  orgSetupPending.mockResolvedValue(false);
  await redirectIfSetupPending();
  expect(redirect).not.toHaveBeenCalled();
});

/* Invited before the owner got around to setup — a screen of company fields
   staff cannot save is worse than the empty Home they can at least use. The
   setup read is skipped entirely, not just its redirect. */
it("never intercepts staff or admins, and doesn't even ask", async () => {
  for (const role of ["staff", "admin", null]) {
    getDbRole.mockResolvedValue(role);
    await redirectIfSetupPending();
  }
  expect(orgSetupPending).not.toHaveBeenCalled();
  expect(redirect).not.toHaveBeenCalled();
});

it("stays out of the way of a session with no org", async () => {
  session = { user: { sub: "auth0|floating" } };
  await redirectIfSetupPending();
  expect(getDbRole).not.toHaveBeenCalled();
  expect(redirect).not.toHaveBeenCalled();

  session = null;
  await redirectIfSetupPending();
  expect(redirect).not.toHaveBeenCalled();
});
