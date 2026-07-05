/* Page-preview lightbox: navigation, selection from inside, close. */

import { render, screen, fireEvent } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { useState } from "react";
import { PageLightbox } from "../plans-panel";
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
