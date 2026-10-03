/**
 * @jest-environment node
 */
/* The customer dialog's actions ask nothing — not the session, not the
   database, not ServiceM8 — where the deployment doesn't save customer
   changes (SM8_WRITES not naming `customer`). */

const requireOrg = jest.fn();
jest.mock("@/lib/permissions-server", () => ({ requireOrg: (...a: unknown[]) => requireOrg(...a) }));
const from = jest.fn();
jest.mock("@/lib/supabase-server", () => ({ supabaseAdmin: { from: (...a: unknown[]) => from(...a) } }));
const readSm8WriteState = jest.fn();
jest.mock("@/lib/integrations/sm8-writes", () => ({ readSm8WriteState: (...a: unknown[]) => readSm8WriteState(...a) }));
const sm8AccessResult = jest.fn();
jest.mock("@/lib/integrations/sm8-store", () => ({ sm8AccessResult: (...a: unknown[]) => sm8AccessResult(...a) }));
jest.mock("@/lib/integrations/sm8-write", () => ({ readSm8Raw: jest.fn() }));
jest.mock("@/lib/integrations/sm8-press", () => ({ sm8PressFromSession: jest.fn() }));
jest.mock("@/lib/integrations/sm8-drain", () => ({ settlePressedWrites: jest.fn() }));
jest.mock("@/app/actions/sm8-customer-queue", () => ({ queueCustomerChanges: jest.fn() }));

import { customerEditOffered, readCustomerForEdit, saveCustomer } from "../job-customer";
import { CUSTOMER_WORDS } from "@/lib/integrations/sm8-customer-words";

const U = "0b1e0b1e-0000-4000-8000-000000000001";

afterAll(() => {
  delete process.env.SM8_WRITES;
});

describe.each(["1", "attachment,note,booking,leave", "attachment,job", ""])("with SM8_WRITES=%j", (setting) => {
  beforeEach(() => {
    process.env.SM8_WRITES = setting;
    for (const m of [requireOrg, from, readSm8WriteState, sm8AccessResult]) m.mockReset();
  });

  it("never offers Edit and answers every action before anything is read", async () => {
    expect(await customerEditOffered()).toBe(false);
    expect(await readCustomerForEdit(U)).toEqual({ ok: false, error: CUSTOMER_WORDS.card.customersUnavailable });
    expect(await saveCustomer(U, { jobUuid: U, company: null, billingAddress: null, contacts: [] })).toEqual({ ok: false, error: CUSTOMER_WORDS.card.customersUnavailable });
    for (const m of [requireOrg, from, readSm8WriteState, sm8AccessResult]) expect(m).not.toHaveBeenCalled();
  });
});

describe("where the deployment saves customer changes", () => {
  beforeEach(() => {
    process.env.SM8_WRITES = "attachment,customer";
    requireOrg.mockReset();
  });

  it("asks that the reader runs the board", async () => {
    requireOrg.mockRejectedValue(new Error("no"));
    expect(await readCustomerForEdit(U)).toEqual({ ok: false, error: CUSTOMER_WORDS.press.noManage });
    expect(requireOrg).toHaveBeenCalledWith("workboard_manage");
  });
});
