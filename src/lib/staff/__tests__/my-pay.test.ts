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
  it("carries the rate and the ordinary-time ladder's own thresholds", async () => {
    // no pay_settings row -> DEFAULT_SETTINGS
    const pay = await getMyPay("org1", "auth0|me");
    expect(pay.rate).toBe(45);
    expect([pay.otAfter, pay.otUnit, pay.dblAfter]).toEqual([8, "day", 12]);
  });

  it("is null when no rate has been set, rather than zero", async () => {
    staffRow = { hourly_wage: null, super_override: null };
    expect((await getMyPay("org1", "auth0|me")).rate).toBeNull();
  });

  it("is null when there is no staff row at all", async () => {
    staffRow = null;
    expect((await getMyPay("org1", "auth0|me")).rate).toBeNull();
  });

  /* THE RULES TRAVEL WHOLE. This used to flatten each one to a single
     multiplier (`rules.sat.rate`), which threw away `up` — the hours at which
     a stepped rule moves to 2×. A Saturday is stepped on the default settings,
     so an 8h Saturday at $50 was reported as $600 and paid $750. Handing the
     rule over intact is what stops the card modelling `splitDay` a second
     time and getting it wrong. */
  it("hands over the org's pay rules intact, `up` and all", async () => {
    // no pay_settings row -> DEFAULT_SETTINGS: sat 1.5x first 2h then 2x
    const pay = await getMyPay("org1", "auth0|me");
    expect(pay.rules.sat).toEqual({ on: true, rate: 1.5, up: 2 });
    expect(pay.rules.sun).toEqual({ on: true, rate: 2, up: null });
  });

  /* Public holidays default ON at 2x and were absent from this payload
     entirely, so the card could not have shown them however it tried. */
  it("carries public holidays and night shift, which it used to drop", async () => {
    const pay = await getMyPay("org1", "auth0|me");
    expect(pay.rules.ph).toEqual({ on: true, rate: 2, up: null });
    expect(pay.rules.night.on).toBe(false); // off by default, but present
  });

  it("passes a switched-off rule through as off, for the card to skip", async () => {
    paySettingsRow = {
      rules: { sat: { on: false, rate: 1.5, up: 2 }, sun: { on: true, rate: 2, up: null } },
    };
    const pay = await getMyPay("org1", "auth0|me");
    expect(pay.rules.sat.on).toBe(false);
    expect(pay.rules.sun).toEqual({ on: true, rate: 2, up: null });
  });
});
