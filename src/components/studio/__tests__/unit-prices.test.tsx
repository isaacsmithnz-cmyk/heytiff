/* The unit browser's buy prices: every supplier's price for the picked
   unit, the cheaper marked with what it saves; a pairing priced at each
   unit's cheapest; and a model still waiting on its order code says so. */
import { render, screen } from "@testing-library/react";
import { BuyPrices, pairFromCents, type UnitPrices } from "../unit-prices";

const offer = (supplierKey: string, supplierName: string, code: string, netCents: number) => ({ supplierKey, supplierName, code, name: code, netCents });
const prices: UnitPrices = new Map([
  [
    "MSZ-AP71VGD2",
    {
      code: "MSZ-AP71VGKD2-A2",
      offers: [offer("aad", "AAD", "MSZ-AP71VGKD2-A2", 40927), offer("mitsubishi", "Mitsubishi Electric", "MSZ-AP71VGKD2-A2", 42000)],
      cheapest: offer("aad", "AAD", "MSZ-AP71VGKD2-A2", 40927),
      savesCents: 1073,
      features: ["Wi-Fi built in"],
      proposed: false,
    },
  ],
  ["MUZ-AP71VG2", { code: null, offers: [], cheapest: null, savesCents: null, features: [], proposed: true }],
]);

it("marks the cheaper supplier and says by how much", () => {
  render(<BuyPrices prices={prices} models={[{ model: "MSZ-AP71VGD2", role: "Indoor" }]} />);
  expect(screen.getByText("AAD").parentElement).toHaveClass("ok");
  expect(screen.getByText("Mitsubishi Electric").parentElement).not.toHaveClass("ok");
  expect(screen.getByText("AAD is $10.73 cheaper")).toBeInTheDocument();
});

it("says when a unit's order code is still to confirm, rather than guessing", () => {
  render(<BuyPrices prices={prices} models={[{ model: "MUZ-AP71VG2", role: "Outdoor" }]} />);
  expect(screen.getByText("Order code to confirm in Quoting")).toBeInTheDocument();
});

it("prices a pairing at each unit's cheapest, and not at all with a unit unpriced", () => {
  expect(pairFromCents(prices, ["MSZ-AP71VGD2"])).toBe(40927);
  expect(pairFromCents(prices, ["MSZ-AP71VGD2", "MUZ-AP71VG2"])).toBeNull();
});
