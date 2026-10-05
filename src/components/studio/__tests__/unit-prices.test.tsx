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

/* Isaac, 2026-10-05: "Anything that's a pair should come from one supplier, not mix and match" */
it("offers the pair only from one supplier that has both, cheapest first, and picking one sets both units", () => {
  const onChoose = jest.fn();
  const me = (code: string, c: number) => offer("mitsubishi", "Mitsubishi Electric", code, c);
  const aadO = (code: string, c: number) => offer("aad", "AAD", code, c);
  const pair: UnitPrices = new Map([
    ["IDU", { code: "IDU", offers: [aadO("IDU", 40927), me("IDU", 42000)], cheapest: aadO("IDU", 40927), savesCents: 1073, chosen: aadO("IDU", 40927), overridden: false, features: [], proposed: false }],
    ["ODU", { code: "ODU", offers: [me("ODU", 120000), aadO("ODU", 126940)], cheapest: me("ODU", 120000), savesCents: 6940, chosen: me("ODU", 120000), overridden: false, features: [], proposed: false }],
  ]);
  render(<BuyPrices prices={pair} models={[{ model: "IDU", role: "Indoor" }, { model: "ODU", role: "Outdoor" }]} onChoose={onChoose} />);
  const group = screen.getByRole("group", { name: "Buy the pair" });
  expect(group).not.toHaveTextContent("Lowest each");
  /* Mitsubishi's pair is $1,620, AAD's $1,678.67: Mitsubishi first, AAD with what it costs over */
  expect([...group.querySelectorAll("button")].map((b) => b.textContent)).toEqual(["All from Mitsubishi Electric$1,620.00", "All from AAD$1,678.67+$58.67"]);
  screen.getByRole("button", { name: /All from AAD/ }).click();
  /* the indoor is already AAD's lowest; the outdoor moves to AAD */
  expect(onChoose).toHaveBeenCalledTimes(1);
  expect(onChoose).toHaveBeenCalledWith("ODU", "aad");
});

it("prices a pair at one supplier's total, never the cheapest of each mixed", () => {
  const me = (code: string, c: number) => offer("mitsubishi", "Mitsubishi Electric", code, c);
  const aadO = (code: string, c: number) => offer("aad", "AAD", code, c);
  const pair: UnitPrices = new Map([
    ["IDU", { code: "IDU", offers: [aadO("IDU", 40927), me("IDU", 42000)], cheapest: aadO("IDU", 40927), savesCents: 1073, chosen: aadO("IDU", 40927), overridden: false, features: [], proposed: false }],
    ["ODU", { code: "ODU", offers: [me("ODU", 120000), aadO("ODU", 126940)], cheapest: me("ODU", 120000), savesCents: 6940, chosen: me("ODU", 120000), overridden: false, features: [], proposed: false }],
  ]);
  /* the cheapest of each would be $1,609.27, mixing AAD's head with Mitsubishi's outdoor */
  expect(pairFromCents(pair, ["IDU", "ODU"])).toBe(162000);
});
