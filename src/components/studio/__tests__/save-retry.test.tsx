/* The save status pill IS the retry control when the server save has failed
   (field feedback 2026-07-26).

   Nothing in the store retries on its own — no backoff, no online listener —
   so "Saved locally" sat there until the next edit happened to fire the
   debounce, and the only deliberate way out was a menu row you had to think to
   open. In that one state the label becomes a button. Every other state stays
   a plain label: there is nothing to do about "Saved". */

import { act, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { Studio } from "../studio";
import { LocalDesignStore, type DesignStore } from "@/lib/studio/store";
import type { DesignDocument } from "@/lib/studio/document";

/** a local store whose SERVER save can be made to fail, like the real one */
class FlakyStore implements DesignStore {
  fail = false;
  saves = 0;
  constructor(private inner = new LocalDesignStore(window.localStorage)) {}
  list() {
    return this.inner.list();
  }
  load(id: string) {
    return this.inner.load(id);
  }
  remove(id: string) {
    return this.inner.remove(id);
  }
  stash(doc: DesignDocument) {
    return this.inner.save(doc); // the crash buffer always takes it
  }
  async save(doc: DesignDocument) {
    this.saves++;
    if (this.fail) throw new Error("offline");
    await this.inner.save(doc);
  }
}

async function newDesign(user: ReturnType<typeof userEvent.setup>, store: DesignStore) {
  render(<Studio store={store} />);
  await user.click(await screen.findByText("New design"));
  await user.type(screen.getByPlaceholderText(/Design name/), "Farran St");
  await user.click(screen.getByRole("button", { name: /Continue/ }));
  await user.click(screen.getByText("Blank canvas"));
}

describe("save status → retry", () => {
  beforeEach(() => window.localStorage.clear());

  it("stays a plain label while saves are landing", async () => {
    const user = userEvent.setup();
    const store = new FlakyStore();
    await newDesign(user, store);

    await waitFor(() => expect(screen.getByText("Saved")).toBeInTheDocument());
    // nothing to act on, so nothing to press
    expect(screen.queryByRole("button", { name: /Saved/ })).toBeNull();
  });

  it("becomes a button once the server save fails, and retries on click", async () => {
    const user = userEvent.setup();
    const store = new FlakyStore();
    await newDesign(user, store);
    await waitFor(() => expect(screen.getByText("Saved")).toBeInTheDocument());

    // the server goes away, and an edit's autosave fails
    store.fail = true;
    await user.type(screen.getByDisplayValue("Farran St"), "!");
    const retry = await screen.findByRole("button", { name: /Saved locally/ });

    // the way back is right there, on the thing that told you about it
    store.fail = false;
    const before = store.saves;
    await user.click(retry);

    await waitFor(() => expect(screen.getByText("Saved")).toBeInTheDocument());
    expect(store.saves).toBeGreaterThan(before);
    expect(screen.queryByRole("button", { name: /Saved locally/ })).toBeNull();
  });

  it("comes back on its own when the connection returns", async () => {
    const user = userEvent.setup();
    const store = new FlakyStore();
    await newDesign(user, store);
    await waitFor(() => expect(screen.getByText("Saved")).toBeInTheDocument());

    store.fail = true;
    await user.type(screen.getByDisplayValue("Farran St"), "!");
    await screen.findByRole("button", { name: /Saved locally/ });

    // the browser says the network is back — no click, no edit
    store.fail = false;
    await act(async () => {
      window.dispatchEvent(new Event("online"));
    });

    await waitFor(() => expect(screen.getByText("Saved")).toBeInTheDocument());
  });

  it("keeps trying on a backoff when nothing tells it the network is back", async () => {
    jest.useFakeTimers();
    const user = userEvent.setup({ advanceTimers: jest.advanceTimersByTime });
    const store = new FlakyStore();
    try {
      await newDesign(user, store);
      // the home→editor swap is on timers too, so let it land
      await act(async () => {
        jest.advanceTimersByTime(1_000);
      });
      store.fail = true;
      await user.type(screen.getByDisplayValue("Farran St"), "!");
      await act(async () => {
        jest.advanceTimersByTime(700); // the autosave debounce fails
      });
      await screen.findByRole("button", { name: /Saved locally/ });

      // nothing happens straight away — this is a wait, not a poll
      const afterFail = store.saves;
      await act(async () => {
        jest.advanceTimersByTime(4_000);
      });
      expect(store.saves).toBe(afterFail);

      // …the first retry lands at 5s, and fails, so the next wait doubles
      await act(async () => {
        jest.advanceTimersByTime(1_500);
      });
      expect(store.saves).toBe(afterFail + 1);
      await act(async () => {
        jest.advanceTimersByTime(5_000); // 5s in: too early for a 10s wait
      });
      expect(store.saves).toBe(afterFail + 1);

      store.fail = false;
      await act(async () => {
        jest.advanceTimersByTime(6_000); // 10s+ in: the second retry lands
      });
      expect(store.saves).toBe(afterFail + 2);
      expect(screen.getByText("Saved")).toBeInTheDocument();
    } finally {
      jest.useRealTimers();
    }
  });

  it("stays offered when the retry itself fails", async () => {
    const user = userEvent.setup();
    const store = new FlakyStore();
    await newDesign(user, store);
    await waitFor(() => expect(screen.getByText("Saved")).toBeInTheDocument());

    store.fail = true;
    await user.type(screen.getByDisplayValue("Farran St"), "!");
    await user.click(await screen.findByRole("button", { name: /Saved locally/ }));

    // still amber, still pressable — the local buffer still has the work
    expect(
      await screen.findByRole("button", { name: /Saved locally/ })
    ).toBeInTheDocument();
  });
});
