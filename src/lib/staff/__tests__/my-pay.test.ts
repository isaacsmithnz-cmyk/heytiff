/* getMyPay — YOUR pay, and the two boundaries that keep it yours.

   The important assertions here are about the QUERIES, not the arithmetic:
   which row the wage came from, and that the org's super rate comes from
   pay_settings — its home since the audit — with rate_calc_state (a pricing
   blob that once doubled as the super record) never touched at all. */

type Row = Record<string, unknown> | null;

const selects: { table: string; columns: string }[] = [];
const filters: { table: string; column: string; value: unknown }[] = [];

let staffRow: Row = { hourly_wage: 45, super_override: null };
let paySettingsRow: Row = { super_pct: 11.5 };

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
      return chain(table, paySettingsRow);
    },
  },
}));

import { DEFAULT_SUPER_PCT, getMyPay } from "../my-pay";

beforeEach(() => {
  selects.length = 0;
  filters.length = 0;
  staffRow = { hourly_wage: 45, super_override: null };
  paySettingsRow = { super_pct: 11.5 };
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

  it("never touches rate_calc_state — the pricing blob is not the super record", async () => {
    await getMyPay("org1", "auth0|me");
    expect(selects.find((s) => s.table === "rate_calc_state")).toBeUndefined();
    expect(filters.find((f) => f.table === "rate_calc_state")).toBeUndefined();
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
    paySettingsRow = null;
    const pay = await getMyPay("org1", "auth0|me");
    expect(pay).toMatchObject({ superPct: DEFAULT_SUPER_PCT, superSource: "default" });
  });

  it("treats a settings row with no super column as unset", async () => {
    paySettingsRow = { cycle: "Weekly" };
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
