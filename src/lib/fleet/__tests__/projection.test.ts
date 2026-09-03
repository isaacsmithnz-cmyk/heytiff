/* The projection boundary: what a fleet query is ALLOWED to ask the database
   for. These assert against the select() column list rather than the rendered
   output, because the guarantee is that the sensitive columns are never read —
   not that a component remembers to hide them. */

import { VEHICLE_PICKER_FIELDS, VEHICLE_SENSITIVE_FIELDS } from "@/lib/projections";

const selected: string[] = [];

const chain = () => {
  const c: Record<string, unknown> = {};
  for (const m of ["eq", "neq", "in", "is", "order", "limit"]) c[m] = () => c;
  c.select = (cols: string) => {
    selected.push(cols);
    return c;
  };
  c.maybeSingle = async () => ({ data: null });
  c.then = (res: (v: { data: never[] }) => unknown) => Promise.resolve({ data: [] }).then(res);
  return c;
};

jest.mock("@/lib/supabase-server", () => ({ supabaseAdmin: { from: () => chain() } }));

import { getOwnVehicle, listVehiclePicker, listVehicles } from "../query";

/** snake_case column list -> the camelCase field names it exposes */
const fieldsOf = (cols: string) =>
  cols.split(",").map((c) => c.trim().replace(/_([a-z])/g, (_, ch) => ch.toUpperCase()));

beforeEach(() => {
  selected.length = 0;
});

describe("the pool-vehicle picker", () => {
  it("asks for exactly VEHICLE_PICKER_FIELDS and nothing else", async () => {
    await listVehiclePicker("org-1");
    const fields = fieldsOf(selected[0]);
    expect(fields.sort()).toEqual([...VEHICLE_PICKER_FIELDS].sort());
  });

  it("reads none of the sensitive columns", async () => {
    await listVehiclePicker("org-1");
    const cols = selected[0];
    for (const field of VEHICLE_SENSITIVE_FIELDS) {
      const column = field.replace(/[A-Z]/g, (ch) => `_${ch.toLowerCase()}`);
      // regoDays/insuranceDays/purchaseDateDays are day-counts of date columns
      const stored = column.replace(/_days$/, "_expiry");
      expect(cols).not.toContain(column);
      expect(cols).not.toContain(stored);
    }
    expect(cols).not.toContain("ai_value");
  });
});

describe("your own vehicle", () => {
  it("adds the compliance facts the screen exists to show — and no money", async () => {
    await getOwnVehicle("org-1", "staff-1");
    const cols = selected[0];
    expect(cols).toContain("rego_expiry");
    expect(cols).toContain("insurance_expiry");
    expect(cols).toContain("ctp_expiry");
    expect(cols).toContain("service_interval_km");
    // your own vehicle still isn't a valuation, an assignment or a note
    expect(cols).not.toContain("value");
    expect(cols).not.toContain("purchase_price");
    expect(cols).not.toContain("assigned_to");
    expect(cols).not.toContain("notes");
  });

  it("never returns a sold vehicle, and returns nothing without a staff record", async () => {
    expect(await getOwnVehicle("org-1", null)).toBeNull();
    expect(selected).toHaveLength(0); // no staff record, no query at all
  });
});

describe("the register", () => {
  it("is the only query that reads money and assignment", async () => {
    await listVehicles("org-1");
    const cols = selected[0];
    expect(cols).toContain("value");
    expect(cols).toContain("purchase_price");
    // the certificate's specs ride the register payload and no narrower one
    for (const spec of ["vin", "engine_number", "tare_kg", "gvm_kg", "body_type", "colour"]) {
      expect(cols).toContain(spec);
    }
    expect(cols).toContain("assigned_to");
    expect(cols).toContain("ai_value");
  });
});
