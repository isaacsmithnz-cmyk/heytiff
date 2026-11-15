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
