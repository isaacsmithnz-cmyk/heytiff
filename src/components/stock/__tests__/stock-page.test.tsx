import { render, screen } from "@testing-library/react";
import { StockPage } from "../stock-page";

jest.mock("next/navigation", () => ({ useRouter: () => ({ push: jest.fn(), replace: jest.fn(), refresh: jest.fn() }), useSearchParams: () => new URLSearchParams() }));
jest.mock("@/app/actions/stock", () => ({ stockPress: jest.fn() }));

/* Stock threw on opening: it raises toasts and no provider stood above it
   (Isaac, 15 November 2026: "Stock does not work. It says this page didn't
   load"). The page holds its own. */
it("opens without a toast provider above it", () => {
  expect(() => render(<StockPage initial={{ ready: false }} />)).not.toThrow();
  expect(document.body.textContent).not.toBe("");
  expect(screen.queryByText(/didn.t load/)).toBeNull();
});

/* The office's list (22 November 2026): every item in one of To order,
   Ordered and In stock, one button for each supplier's lot, and that
   button's sheet ordering the lot with what's ticked. */
import { act, fireEvent } from "@testing-library/react";
import { NO_MARK, ordersOf, shoppingList, jobState, type JobNeed, type StockJob } from "@/lib/stock/stock";
import type { StockView } from "@/lib/stock/stock-server";
import { stockPress } from "@/app/actions/stock";

const job = (uuid: string, number: string): StockJob => ({ uuid, number, client: `Client ${number}`, suburb: "Glebe", address: null, hue: "blue", kind: "Install", firstAt: "2026-11-24 07:00:00", crew: 2 });
const need = (code: string, qty: number, supplierKey: string | null, mark: Partial<typeof NO_MARK> = {}): JobNeed => ({ key: code, code, title: `Unit ${code}`, detail: code, group: "unit", qty, supplierKey, role: null, ...NO_MARK, ...mark, need: qty, visit: null, at: "2026-11-24 07:00:00" });

function view(): StockView {
  const a = job("a", "2798");
  const list = [{ job: a, needs: [need("AAA-1", 2, "aad"), need("BBB-2", 1, "aad"), need("CCC-3", 1, "me", { ordered: 1, orderedDue: "2026-11-23" }), need("DDD-4", 1, "me", { inStock: 1 })] }];
  const items = shoppingList(list);
  return {
    ready: true,
    week: "next",
    today: "2026-11-22",
    from: "2026-11-23",
    to: "2026-11-29",
    jobs: list.map((x) => ({ job: x.job, state: jobState(x.needs), from: "accepted", needs: x.needs.map((n) => ({ ...n, inStockName: null, orderedName: null })), later: [], visits: [], choose: null })),
    items,
    orders: ordersOf(items, (it) => it.supplierKey).map((o) => ({ ...o, supplierName: o.supplierKey === "aad" ? "AAD" : "ME", orderUrl: null })),
    later: [],
    prices: {},
    noQuote: [],
    noUnits: [],
  };
}

it("puts each item in one group, and orders a supplier's lot from its one button", async () => {
  render(<StockPage initial={view()} />);
  expect(screen.getByRole("heading", { name: "To order" })).toBeTruthy();
  expect(screen.getByRole("heading", { name: "Ordered" })).toBeTruthy();
  expect(screen.getByRole("heading", { name: "In stock" })).toBeTruthy();
  /* each in one place: the ordered one isn't in To order, the one in stock isn't either */
  expect(screen.getAllByText("Unit CCC-3")).toHaveLength(1);
  expect(screen.getAllByText("Unit DDD-4")).toHaveLength(1);
  fireEvent.click(screen.getByRole("button", { name: "Order from AAD" }));
  expect(screen.getByRole("button", { name: "Mark 3 ordered" })).toBeTruthy();
  /* From starts at the lot's supplier */
  expect(screen.getByText("AAD, the cheapest")).toBeTruthy();
  fireEvent.click(screen.getByRole("checkbox", { name: /BBB-2/ }));
  const go = screen.getByRole("button", { name: "Mark 2 ordered" });
  (stockPress as jest.Mock).mockResolvedValue({ ok: false, reason: "no" });
  await act(async () => {
    fireEvent.click(go);
  });
  expect(stockPress).toHaveBeenCalledWith(expect.objectContaining({ do: "ordered", supplier: "aad", keys: ["AAA-1"], from: "aad" }));
});
