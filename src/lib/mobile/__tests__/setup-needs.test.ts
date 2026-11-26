/**
 * @jest-environment node
 */

/* Who the phone sends through its first run. The trap: the web never asked an
   owner their details, so an owner of a business already running has a card
   with no onboarded stamp, and must not be sent through a first run when they
   next sign in on the phone. */

let pending = { org: false, card: true };
jest.mock("@/lib/org/query", () => ({ orgSetupPending: async () => pending.org }));
jest.mock("@/lib/staff/onboarding", () => ({ onboardingPending: async () => pending.card }));

import { setupNeeds } from "../setup-needs";
import type { MobileCtx } from "../auth";

const ctx = (role: string) => ({ userId: "u", orgId: "o", role, caps: new Set(), orgIds: ["o"] }) as unknown as MobileCtx;

test("an owner whose business is running is sent nowhere, whatever their card's stamp", async () => {
  pending = { org: false, card: true };
  expect(await setupNeeds(ctx("owner"))).toEqual({ business: false, details: false });
});

test("an owner of a new business does both", async () => {
  pending = { org: true, card: true };
  expect(await setupNeeds(ctx("owner"))).toEqual({ business: true, details: true });
});

test("staff never see the business's steps; their own follow their card", async () => {
  pending = { org: true, card: true };
  expect(await setupNeeds(ctx("staff"))).toEqual({ business: false, details: true });
  pending = { org: true, card: false };
  expect(await setupNeeds(ctx("admin"))).toEqual({ business: false, details: false });
});
