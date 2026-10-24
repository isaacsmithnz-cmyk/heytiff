import { act, fireEvent, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { useRef, useState, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { overlayOpen, useOverlay, type OverlayOptions } from "../use-overlay";

/* THE OVERLAY STACK. Escape goes to the dialog in front and only to it, Tab
   goes round inside it, and focus goes back to what opened it. These
   dialogs are portalled to <body> the way the app's are, so none of them is
   inside another in the page even when one is drawn inside another. */

function Dialog({
  name,
  onEscape,
  children,
  ...opts
}: { name: string; children?: ReactNode } & OverlayOptions) {
  const ref = useRef<HTMLDivElement>(null);
  useOverlay(ref, { onEscape, ...opts });
  return createPortal(
    <div ref={ref} role="dialog" aria-modal="true" aria-label={name} tabIndex={-1}>
      {children}
    </div>,
    document.body,
  );
}

function Opener({ name, children }: { name: string; children: (close: () => void) => ReactNode }) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <button onClick={() => setOpen(true)}>{name}</button>
      {open && children(() => setOpen(false))}
    </>
  );
}

const esc = () => fireEvent.keyDown(document.activeElement ?? document.body, { key: "Escape" });

describe("Escape", () => {
  it("closes the dialog in front, and only it", async () => {
    const user = userEvent.setup();
    render(
      <Opener name="Open card">
        {(closeCard) => (
          <Dialog name="Card" onEscape={closeCard}>
            <Opener name="Edit customer">
              {(closeInner) => <Dialog name="Customer" onEscape={closeInner} />}
            </Opener>
          </Dialog>
        )}
      </Opener>,
    );
    await user.click(screen.getByRole("button", { name: "Open card" }));
    await user.click(screen.getByRole("button", { name: "Edit customer" }));
    esc();
    expect(screen.queryByRole("dialog", { name: "Customer" })).toBeNull();
    expect(screen.getByRole("dialog", { name: "Card" })).toBeInTheDocument();
    esc();
    expect(screen.queryByRole("dialog", { name: "Card" })).toBeNull();
  });

  it("puts the one drawn inside in front even when both open at once", () => {
    const card = jest.fn();
    const inner = jest.fn();
    render(
      <Dialog name="Card" onEscape={card}>
        <Dialog name="Confirm" onEscape={inner} />
      </Dialog>,
    );
    esc();
    expect(inner).toHaveBeenCalledTimes(1);
    expect(card).not.toHaveBeenCalled();
  });

  it("steps aside for a key something inside already took", () => {
    const card = jest.fn();
    render(
      <Dialog name="Card" onEscape={card}>
        <input aria-label="Your answer" onKeyDown={(e) => e.key === "Escape" && e.preventDefault()} />
      </Dialog>,
    );
    fireEvent.keyDown(screen.getByRole("textbox", { name: "Your answer" }), { key: "Escape" });
    expect(card).not.toHaveBeenCalled();
  });

  it("is claimed, and a handler on the page underneath can tell either way", () => {
    // one that was listening before the dialog opened hears the key first
    const before = jest.fn(() => overlayOpen());
    document.addEventListener("keydown", before);
    render(<Dialog name="Card" onEscape={() => {}} />);
    const after = jest.fn((e: KeyboardEvent) => e.defaultPrevented);
    document.addEventListener("keydown", after);
    esc();
    document.removeEventListener("keydown", before);
    document.removeEventListener("keydown", after);
    expect(before).toHaveReturnedWith(true);
    expect(after).toHaveReturnedWith(true);
  });

  it("does nothing in a dialog that answers it itself", () => {
    const card = jest.fn();
    render(
      <Dialog name="Card" onEscape={card}>
        <Dialog name="Tiff" />
      </Dialog>,
    );
    esc();
    expect(card).not.toHaveBeenCalled();
  });
});

describe("Tab", () => {
  it("goes round inside the dialog in front, both ways, and never to the page", async () => {
    const user = userEvent.setup();
    render(
      <>
        <button>On the page</button>
        <Dialog name="Card">
          <button>First</button>
          <section hidden>
            <button>On a hidden face</button>
          </section>
          <button disabled>Not now</button>
          <button>Last</button>
        </Dialog>
      </>,
    );
    screen.getByRole("button", { name: "Last" }).focus();
    await user.tab();
    expect(document.activeElement).toBe(screen.getByRole("button", { name: "First" }));
    await user.tab({ shift: true });
    expect(document.activeElement).toBe(screen.getByRole("button", { name: "Last" }));
    await user.tab({ shift: true });
    expect(document.activeElement).toBe(screen.getByRole("button", { name: "First" }));
  });

  it("brings focus that wandered outside back in", async () => {
    const user = userEvent.setup();
    render(
      <>
        <button>On the page</button>
        <Dialog name="Card">
          <button>First</button>
          <button>Last</button>
        </Dialog>
      </>,
    );
    screen.getByRole("button", { name: "On the page" }).focus();
    await user.tab();
    expect(document.activeElement).toBe(screen.getByRole("button", { name: "First" }));
  });

  it("is left alone for a dialog that keeps its own", async () => {
    const user = userEvent.setup();
    render(
      <>
        <Dialog name="Card" trap={false}>
          <button>Only</button>
        </Dialog>
        <button>After</button>
      </>,
    );
    screen.getByRole("button", { name: "Only" }).focus();
    await user.tab();
    expect(document.activeElement).not.toBe(screen.getByRole("button", { name: "Only" }));
  });
});

describe("focus", () => {
  it("goes back to what opened the dialog when the dialog took it along", async () => {
    const user = userEvent.setup();
    render(
      <Opener name="Open card">
        {(close) => (
          <Dialog name="Card" onEscape={close}>
            <button autoFocus>Close</button>
          </Dialog>
        )}
      </Opener>,
    );
    const door = screen.getByRole("button", { name: "Open card" });
    await user.click(door);
    expect(document.activeElement).toBe(screen.getByRole("button", { name: "Close" }));
    act(() => esc());
    expect(document.activeElement).toBe(door);
  });

  it("is left where a host already put it", async () => {
    const user = userEvent.setup();
    render(
      <>
        <button>Somewhere else</button>
        <Opener name="Open card">
          {(close) => (
            <Dialog name="Card">
              <button
                onClick={() => {
                  screen.getByRole("button", { name: "Somewhere else" }).focus();
                  close();
                }}
              >
                Done
              </button>
            </Dialog>
          )}
        </Opener>
      </>,
    );
    await user.click(screen.getByRole("button", { name: "Open card" }));
    await user.click(screen.getByRole("button", { name: "Done" }));
    expect(document.activeElement).toBe(screen.getByRole("button", { name: "Somewhere else" }));
  });
});
