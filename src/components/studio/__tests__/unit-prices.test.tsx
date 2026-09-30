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
      chosen: offer("aad", "AAD", "MSZ-AP71VGKD2-A2", 40927),
      overridden: false,
      features: ["Wi-Fi built in"],
      proposed: false,
    },
  ],
  ["MUZ-AP71VG2", { code: null, offers: [], cheapest: null, savesCents: null, chosen: null, overridden: false, features: [], proposed: true }],
]);

it("buys from the lowest by default, and says by how much it's lower", () => {
  render(<BuyPrices prices={prices} models={[{ model: "MSZ-AP71VGD2", role: "Indoor" }]} onChoose={jest.fn()} />);
  expect(screen.getByRole("button", { name: "Buy MSZ-AP71VGD2 from AAD" })).toHaveClass("ok", "on");
  expect(screen.getByText("Lowest price")).toBeInTheDocument();
  expect(screen.getByText("AAD is $10.73 cheaper")).toBeInTheDocument();
});

it("overrides by pressing another supplier's price, and the lowest again goes back", () => {
  const onChoose = jest.fn();
  const over = new Map(prices);
  over.set("MSZ-AP71VGD2", { ...prices.get("MSZ-AP71VGD2")!, chosen: offer("mitsubishi", "Mitsubishi Electric", "MSZ-AP71VGKD2-A2", 42000), overridden: true });
  render(<BuyPrices prices={over} models={[{ model: "MSZ-AP71VGD2", role: "Indoor" }]} onChoose={onChoose} />);
  expect(screen.getByText("Override")).toBeInTheDocument();
  screen.getByRole("button", { name: "Buy MSZ-AP71VGD2 from AAD" }).click();
  expect(onChoose).toHaveBeenCalledWith("MSZ-AP71VGD2", null);
});

it("says when a unit's order code is still to confirm, rather than guessing", () => {
  render(<BuyPrices prices={prices} models={[{ model: "MUZ-AP71VG2", role: "Outdoor" }]} />);
  expect(screen.getByText("Order code to confirm in Quoting")).toBeInTheDocument();
});

it("prices a pairing at each unit's cheapest, and not at all with a unit unpriced", () => {
  expect(pairFromCents(prices, ["MSZ-AP71VGD2"])).toBe(40927);
  expect(pairFromCents(prices, ["MSZ-AP71VGD2", "MUZ-AP71VG2"])).toBeNull();
});
