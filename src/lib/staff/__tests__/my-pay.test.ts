/* getMyPay — YOUR pay, and the two boundaries that keep it yours.

   The important assertions here are about the QUERIES, not the arithmetic:
   which row the wage came from, and that the org's super default is pulled out
   of rate_calc_state as a single scalar rather than by dragging the whole
   `state` blob — which holds every staff member's modelled wage — into this
   request. */

type Row = Record<string, unknown> | null;

const selects: { table: string; columns: string }[] = [];
const filters: { table: string; column: string; value: unknown }[] = [];

let staffRow: Row = { hourly_wage: 45, super_override: null };
let rateCalcRow: Row = { super_pct: 11.5 };
let paySettingsRow: Row = null;

function chain(table: string, result: Row) {
  const node: Record<string, unknown> = {
    maybeSingle: jest.fn().mockResolvedValue({ data: result, error: null }),
  };
  node.select = jest.fn((columns: string) => {
    selects.push({ table, columns });
    return node;
  });
  node.eq = jest.fn((column: string, value: unknown) => {
    filters.push({ table, column, value });
    return node;
  });
  return node;
}

jest.mock("@/lib/supabase-server", () => ({
  supabaseAdmin: {
    from: (table: string) => {
      if (table === "staff_profiles") return chain(table, staffRow);
      if (table === "rate_calc_state") return chain(table, rateCalcRow);
      return chain(table, paySettingsRow);
    },
  },
}));

import { DEFAULT_SUPER_PCT, getMyPay } from "../my-pay";

beforeEach(() => {
  selects.length = 0;
  filters.length = 0;
  staffRow = { hourly_wage: 45, super_override: null };
  rateCalcRow = { super_pct: 11.5 };
  paySettingsRow = null;
});

const selectFor = (table: string) => selects.find((s) => s.table === table)!.columns;

describe("the money boundary", () => {
  it("reads the wage from YOUR row — org and user, never by staff id alone", async () => {
    await getMyPay("org1", "auth0|me");
    const staffFilters = filters.filter((f) => f.table === "staff_profiles");
    expect(staffFilters).toEqual([
      { table: "staff_profiles", column: "org_id", value: "org1" },
      { table: "staff_profiles", column: "user_id", value: "auth0|me" },
    ]);
  });

  it("selects only the two pay columns it needs off that row", async () => {
    await getMyPay("org1", "auth0|me");
    expect(selectFor("staff_profiles")).toBe("hourly_wage, super_override");
  });

  it("pulls ONE scalar out of rate_calc_state, never the whole state blob", async () => {
    await getMyPay("org1", "auth0|me");
    const columns = selectFor("rate_calc_state");
    expect(columns).toContain("state->settings->super_pct");
    // `state` on its own would carry every staff member's modelled wage
    expect(columns).not.toBe("state");
    expect(columns).not.toMatch(/(^|,)\s*state\s*(,|$)/);
  });

  it("scopes the org default to the caller's org", async () => {
    await getMyPay("org1", "auth0|me");
    expect(filters).toContainEqual({
      table: "rate_calc_state",
      column: "org_id",
      value: "org1",
    });
  });
});

describe("super resolution", () => {
  it("prefers the person's own override", async () => {
    staffRow = { hourly_wage: 45, super_override: 15 };
    const pay = await getMyPay("org1", "auth0|me");
    expect(pay).toMatchObject({ superPct: 15, superSource: "override" });
  });

  it("falls back to the org's rate", async () => {
    const pay = await getMyPay("org1", "auth0|me");
    expect(pay).toMatchObject({ superPct: 11.5, superSource: "org" });
  });

  it("falls back to the statutory default when the org never set one", async () => {
    rateCalcRow = null;
    const pay = await getMyPay("org1", "auth0|me");
    expect(pay).toMatchObject({ superPct: DEFAULT_SUPER_PCT, superSource: "default" });
  });

  it("ignores a blob whose settings have no super_pct", async () => {
    rateCalcRow = {};
    const pay = await getMyPay("org1", "auth0|me");
    expect(pay).toMatchObject({ superPct: DEFAULT_SUPER_PCT, superSource: "default" });
  });
});

describe("the rates themselves", () => {
  it("carries the rate and the fixed multipliers", async () => {
    const pay = await getMyPay("org1", "auth0|me");
    expect(pay.rate).toBe(45);
    expect(pay.otMultiplier).toBe(1.5);
    expect(pay.dblMultiplier).toBe(2);
  });

  it("is null when no rate has been set, rather than zero", async () => {
    staffRow = { hourly_wage: null, super_override: null };
    expect((await getMyPay("org1", "auth0|me")).rate).toBeNull();
  });

  it("is null when there is no staff row at all", async () => {
    staffRow = null;
    expect((await getMyPay("org1", "auth0|me")).rate).toBeNull();
  });

  it("takes weekend multipliers from the org's pay rules", async () => {
    // no pay_settings row -> DEFAULT_SETTINGS: sat x1.5, sun x2, both on
    const pay = await getMyPay("org1", "auth0|me");
    expect(pay.weekend).toEqual({ sat: 1.5, sun: 2 });
  });

  it("reports a switched-off weekend rule as no rate, not as x1", async () => {
    paySettingsRow = {
      rules: { sat: { on: false, rate: 1.5, up: 2 }, sun: { on: true, rate: 2, up: null } },
    };
    const pay = await getMyPay("org1", "auth0|me");
    expect(pay.weekend).toEqual({ sat: null, sun: 2 });
  });
});
