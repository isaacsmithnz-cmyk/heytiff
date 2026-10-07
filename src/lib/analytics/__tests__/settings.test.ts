/* How a business's jobs are counted: what a setting may hold, what stands in
   for one never set, and what is found in the jobs themselves. */
import {
  bookingClients,
  closeAgeOf,
  DEFAULT_SETTINGS,
  guessRole,
  hoursToClose,
  normaliseSettings,
  roleOf,
  rulesOf,
  settingsRow,
  wholeDays,
  type CardFacts,
} from "../settings";

describe("normaliseSettings", () => {
  it("reads a saved row, and keeps nothing it can't read", () => {
    expect(
      normaliseSettings({
        lapse_after_days: 120,
        quote_from_cents: 250_000,
        auto_close_days: 0,
        category_roles: { "c-1": "warranty", "c-2": "heat pump", "": "install" },
        not_customers: ["co-1", "co-1", 7, ""],
      }),
    ).toEqual({
      lapseAfterDays: 120,
      quoteFromCents: 250_000,
      autoCloseDays: 0,
      categoryRoles: { "c-1": "warranty" },
      notCustomers: ["co-1"],
    });
  });

  it("leaves a number out of range, or not whole, unset", () => {
    const s = normaliseSettings({ lapseAfterDays: 30, quoteFromCents: -1, autoCloseDays: 60.5 });
    expect(s).toMatchObject({ lapseAfterDays: null, quoteFromCents: null, autoCloseDays: null });
  });

  it("tells a list never saved from an empty one", () => {
    expect(normaliseSettings({}).notCustomers).toBeNull();
    expect(normaliseSettings({ notCustomers: [] }).notCustomers).toEqual([]);
  });

  it("writes back what it reads", () => {
    const s = normaliseSettings({ lapseAfterDays: 200, categoryRoles: { c: "install" }, notCustomers: ["x"] });
    expect(normaliseSettings(settingsRow(s))).toEqual(s);
  });
});

describe("the rules", () => {
  it("uses the live account's rules until the business sets its own", () => {
    expect(rulesOf(DEFAULT_SETTINGS)).toEqual({ lapseAfterDays: 180, quoteFromCents: 300_000, closeAfterDays: null });
    expect(rulesOf(DEFAULT_SETTINGS, 60).closeAfterDays).toBe(60);
  });

  it("takes the business's close age over what was found, and none when ServiceM8 doesn't close quotes", () => {
    expect(rulesOf({ ...DEFAULT_SETTINGS, autoCloseDays: 30 }, 60).closeAfterDays).toBe(30);
    expect(rulesOf({ ...DEFAULT_SETTINGS, autoCloseDays: 0 }, 60).closeAfterDays).toBeNull();
  });
});

describe("category roles", () => {
  it("reads a role from the names the live account uses", () => {
    expect(guessRole("Install")).toBe("install");
    expect(guessRole("Construction Project ")).toBe("install");
    expect(guessRole("Service Call")).toBe("service");
    expect(guessRole("Annual Maintenance ")).toBe("maintenance");
    expect(guessRole("Warranty")).toBe("warranty");
    expect(guessRole("Standard")).toBe("other");
    expect(guessRole(null)).toBe("other");
  });

  it("takes the business's role over the name", () => {
    const s = { ...DEFAULT_SETTINGS, categoryRoles: { "c-std": "install" as const } };
    expect(roleOf(s, "c-std", "Standard")).toBe("install");
    expect(roleOf(s, "c-other", "Service Call")).toBe("service");
  });
});

describe("found in the jobs", () => {
  const card = (clientId: string, over: Partial<CardFacts> = {}): CardFacts => ({
    clientId,
    quoted: false,
    invoiced: false,
    paid: false,
    priced: false,
    ...over,
  });

  it("finds a client whose cards are bookings: six or more, none quoted, invoiced or paid, few priced", () => {
    const tafe = [...Array(9)].map(() => card("tafe")).concat(card("tafe", { priced: true }));
    const builder = [...Array(8)].map(() => card("builder")).concat(card("builder", { invoiced: true }));
    const few = [...Array(5)].map(() => card("few"));
    const priced = [...Array(6)].map(() => card("priced", { priced: true }));
    expect(bookingClients([...tafe, ...builder, ...few, ...priced])).toEqual([{ clientId: "tafe", cards: 10 }]);
  });

  it("finds the age ServiceM8 closes an unanswered Quote at, when a quarter of them and five share it to the hour", () => {
    const at60 = [1440.1, 1439.5, 1441.9, 1440, 1440.6];
    expect(closeAgeOf([...at60, 300, 2000, 900])).toEqual({ days: 60, count: 5 });
    // four is too few, and five of thirty too rare
    expect(closeAgeOf(at60.slice(1))).toBeNull();
    expect(closeAgeOf([...at60, ...[...Array(25)].map((_, i) => 100 + i * 37)])).toBeNull();
  });

  it("reads the hours from a quote date to a last edit, and whether they're whole days", () => {
    expect(hoursToClose("2026-03-11 09:14:02", "2026-05-10 09:14:40")).toBeCloseTo(1440.01, 2);
    expect(hoursToClose(null, "2026-05-10 09:14:40")).toBeNull();
    expect(hoursToClose("2026-05-10 09:14:40", "2026-03-11 09:14:02")).toBeNull();
    expect(wholeDays(1441.9)).toBe(60);
    expect(wholeDays(1445)).toBeNull();
  });
});
