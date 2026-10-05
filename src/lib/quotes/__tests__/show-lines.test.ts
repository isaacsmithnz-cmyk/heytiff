import { normaliseDraft } from "../proposal";
import { normaliseQuoteSettings, quoteSettingsRow } from "../settings";

/* Isaac, 2026-10-05: "we will just click show line items to customer or leave
   it off by default so that they just see the total price" */
it("keeps each business's default for what the customer sees, off unless it's set", () => {
  expect(normaliseQuoteSettings({}).showLines).toBe(false);
  expect(normaliseQuoteSettings({ show_lines: true }).showLines).toBe(true);
  expect(quoteSettingsRow(normaliseQuoteSettings({ show_lines: true })).show_lines).toBe(true);
});

it("lets a quote say otherwise, and leaves it to the business when it doesn't", () => {
  const base = { intro: "Hi", options: [{ name: "Split", lines: ["A split"], units: [] }] };
  expect(normaliseDraft(base)!.showLines).toBeNull();
  expect(normaliseDraft({ ...base, showLines: true })!.showLines).toBe(true);
  expect(normaliseDraft({ ...base, show_lines: false })!.showLines).toBe(false);
});
