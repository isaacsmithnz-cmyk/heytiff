/* Page-preview lightbox: navigation, selection from inside, close. */

import { render, screen, fireEvent } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { useState } from "react";
import { NamingLightbox, PageLightbox } from "../plans-panel";
import type { PageImage } from "@/lib/studio/plans";

const page = (n: number): PageImage => ({
  pageNumber: n,
  label: `Level ${n}`,
  blob: new Blob(),
  ext: "png",
  thumbUrl: `blob:page-${n}`,
  width: 2000,
  height: 1400,
});

function Harness({ onClose }: { onClose: () => void }) {
  const pages = [page(1), page(2), page(3)];
  const [index, setIndex] = useState(0);
  const [selected, setSelected] = useState(new Set<number>());
  return (
    <PageLightbox
      pages={pages}
      index={index}
      selected={selected}
      onToggle={(i) =>
        setSelected((s) => {
          const next = new Set(s);
          if (next.has(i)) next.delete(i);
          else next.add(i);
          return next;
        })
      }
      onNav={setIndex}
      onClose={onClose}
    />
  );
}

describe("PageLightbox", () => {
  it("navigates with arrows and keyboard, selects from inside, closes on Esc", async () => {
    const user = userEvent.setup();
    const onClose = jest.fn();
    render(<Harness onClose={onClose} />);

    expect(screen.getByText("Level 1")).toBeInTheDocument();
    expect(screen.getByText("1 / 3")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Previous page" })).toBeDisabled();

    await user.click(screen.getByRole("button", { name: "Next page" }));
    expect(screen.getByText("Level 2")).toBeInTheDocument();

    fireEvent.keyDown(window, { key: "ArrowRight" });
    expect(screen.getByText("Level 3")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Next page" })).toBeDisabled();

    await user.click(screen.getByRole("button", { name: "Select this page" }));
    expect(screen.getByRole("button", { name: "Selected" })).toBeInTheDocument();

    fireEvent.keyDown(window, { key: "Escape" });
    expect(onClose).toHaveBeenCalled();
  });

  it("renders into document.body (portal), not the panel subtree", () => {
    const { container } = render(<Harness onClose={() => {}} />);
    expect(container.querySelector(".ds-lightbox")).toBeNull();
    expect(document.body.querySelector(".ds-lightbox")).not.toBeNull();
  });
});

function NameHarness({ onDone }: { onDone: (names: string[]) => void }) {
  const pages = [page(1), page(2)];
  const [names, setNames] = useState(["Level 1", "Level 2"]);
  const [at, setAt] = useState(0);
  return (
    <NamingLightbox
      pages={pages}
      chosen={[0, 1]}
      names={names}
      at={at}
      onName={(n) => setNames((s) => s.map((v, k) => (k === at ? n : v)))}
      onNav={setAt}
      onBack={() => {}}
      onDone={() => onDone(names)}
    />
  );
}

describe("NamingLightbox", () => {
  it("edits names, steps through pages, and confirms on the last", async () => {
    const user = userEvent.setup();
    const onDone = jest.fn();
    render(<NameHarness onDone={onDone} />);

    expect(screen.getByText("Floor 1 / 2")).toBeInTheDocument();
    const input = screen.getByLabelText("Floor name");
    expect(input).toHaveValue("Level 1");
    await user.clear(input);
    await user.type(input, "Ground floor");
    expect(screen.getByLabelText("Floor name")).toHaveValue("Ground floor");

    // last page shows the stacking CTA, which fires onDone
    await user.click(screen.getByRole("button", { name: "Next floor" }));
    expect(screen.getByText("Floor 2 / 2")).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Continue to stacking" }));
    expect(onDone).toHaveBeenCalled();
    expect(onDone.mock.calls[0][0]).toEqual(["Ground floor", "Level 2"]);
  });
});
