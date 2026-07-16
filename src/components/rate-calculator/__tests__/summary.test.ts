import { calculate } from "../engine";
import { generateSummary, toPlainText } from "../summary";
import { emptyState } from "../state";
import { buildDemoState } from "../demo-data";
import { buildEngineData } from "../state";

// Pinned dates — generateSummary is date-dependent (July award check, generatedAt).
const JULY = new Date("2026-07-16T10:00:00");
const MARCH = new Date("2026-03-10T10:00:00");

const demo = buildDemoState();
const demoCalc = calculate(buildEngineData(demo));

describe("generateSummary", () => {
  it("tells an unconfigured business to add staff", () => {
    const s = emptyState();
    const calc = calculate(buildEngineData(s));
    const sum = generateSummary(calc, s.eofy, s.settings, s.profit, s.currentRates, MARCH);
    expect(sum.whereStand).toMatch(/Add your staff records/);
  });

  it("flags below-recommended rates and quantifies the gap", () => {
    // Blue Sky charges $118/$105 vs higher recommended — below recommended, above BE
    const sum = generateSummary(demoCalc, demo.eofy, demo.settings, demo.profit, demo.currentRates, MARCH);
    expect(sum.whereStand).toMatch(/covers costs but sits \$\d+\/hr below the recommended/);
    expect(sum.attentionItems.some(i => i.heading === "Rate increase to target")).toBe(true);
  });

  it("adds the July award-rate check only in July", () => {
    const july = generateSummary(demoCalc, demo.eofy, demo.settings, demo.profit, demo.currentRates, JULY);
    const march = generateSummary(demoCalc, demo.eofy, demo.settings, demo.profit, demo.currentRates, MARCH);
    expect(july.attentionItems.some(i => i.heading === "July award rate check")).toBe(true);
    expect(march.attentionItems.some(i => i.heading === "July award rate check")).toBe(false);
  });

  it("warns when taxable wages approach the payroll threshold with tax disabled", () => {
    // Inflate the wage bill so totalWages (incl. super) crosses 80% of the threshold
    const s = buildDemoState();
    s.simpleLabour.months = [85_000, 85_000, 85_000]; // ~1.02M + super ≈ 1.14M ≈ 95% of 1.2M
    const calc = calculate(buildEngineData(s));
    const sum = generateSummary(calc, s.eofy, s.settings, s.profit, s.currentRates, MARCH);
    const item = sum.attentionItems.find(i => i.heading === "Payroll tax threshold approaching");
    expect(item).toBeDefined();
    expect(item!.text).toMatch(/NSW payroll tax threshold/);
  });

  it("stamps generatedAt from the injected date", () => {
    const sum = generateSummary(demoCalc, demo.eofy, demo.settings, demo.profit, demo.currentRates, MARCH);
    expect(sum.generatedAt).toBe("10 March 2026");
  });
});

describe("toPlainText", () => {
  it("renders all three sections in order", () => {
    const sum = generateSummary(demoCalc, demo.eofy, demo.settings, demo.profit, demo.currentRates, MARCH);
    const text = toPlainText(sum);
    expect(text.indexOf("WHERE YOU STAND")).toBeGreaterThan(-1);
    expect(text.indexOf("WHAT NEEDS ATTENTION")).toBeGreaterThan(text.indexOf("WHERE YOU STAND"));
    expect(text.indexOf("WHAT'S WORKING")).toBeGreaterThan(text.indexOf("WHAT NEEDS ATTENTION"));
  });
});
