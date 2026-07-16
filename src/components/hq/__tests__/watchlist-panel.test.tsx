import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { WatchlistPanel, type WatchItem } from "../watchlist-panel";
import type { WatchSignal } from "@/lib/hq/watchlist";

jest.mock("next/navigation", () => ({
  useRouter: () => ({ refresh: jest.fn() }),
}));

const signals: WatchSignal[] = [
  {
    kind: "unextracted-source",
    title: "PUMY-SP Data Book",
    detail: "Declared as a pack source (M-P0860) but no data has been extracted from it yet.",
  },
  {
    kind: "unmatched-family",
    title: "MFXZ-KW",
    detail: "Whitelisted by MXZ-2F52VF but no indoor model matches.",
  },
];

const items: WatchItem[] = [
  {
    id: "w1",
    item: "PAC-MK branch box part specs",
    context: "needed for PUMY compatibility",
    addedBy: "isaac@heytiff.com",
    addedAt: "2026-07-16T04:00:00Z",
  },
];

describe("WatchlistPanel", () => {
  it("renders auto signals and manual items with attribution", () => {
    render(<WatchlistPanel signals={signals} items={items} />);
    expect(screen.getByText("PUMY-SP Data Book")).toBeInTheDocument();
    expect(screen.getByText("MFXZ-KW")).toBeInTheDocument();
    expect(screen.getByText(/book not extracted/i)).toBeInTheDocument();
    expect(screen.getByText("PAC-MK branch box part specs")).toBeInTheDocument();
    expect(screen.getByText(/isaac@heytiff.com/)).toBeInTheDocument();
  });

  it("adds a manual item through the injected action", async () => {
    const onAdd = jest.fn().mockResolvedValue({ ok: true });
    const user = userEvent.setup();
    render(<WatchlistPanel signals={[]} items={[]} onAdd={onAdd} />);

    await user.type(
      screen.getByPlaceholderText(/next extraction should look for/i),
      "PUMY combination tables"
    );
    await user.click(screen.getByRole("button", { name: "Add" }));

    expect(onAdd).toHaveBeenCalledWith("PUMY combination tables");
  });

  it("resolves a manual item through the injected action", async () => {
    const onResolve = jest.fn().mockResolvedValue({ ok: true });
    const user = userEvent.setup();
    render(<WatchlistPanel signals={[]} items={items} onResolve={onResolve} />);

    await user.click(screen.getByRole("button", { name: "Resolve" }));
    expect(onResolve).toHaveBeenCalledWith("w1");
  });

  it("shows the all-clear when nothing is outstanding", () => {
    render(<WatchlistPanel signals={[]} items={[]} />);
    expect(screen.getByText(/nothing outstanding/i)).toBeInTheDocument();
  });
});
