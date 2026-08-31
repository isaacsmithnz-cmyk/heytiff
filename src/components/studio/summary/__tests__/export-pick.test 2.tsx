/* EXPORT ASKS WHAT YOU ARE SENDING.

   The card used to lead with the machine — Print / PNG per floor / Design
   file — and hide how much of the design goes in behind a "Customise"
   disclosure underneath. These pin the shape that replaced it: a list of
   artifacts named by what comes out, options that appear only when they apply
   to the pick, and one button that says what pressing it will do. */

import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { createDesign, type DesignDocument } from "@/lib/studio/document";
import { ExportCard } from "../export-card";

jest.mock("@/app/actions/org", () => ({
  getOrgBrand: jest.fn(() => new Promise(() => {})),
}));

const planImages = {
  url: jest.fn(),
  upload: jest.fn(),
  uploadSource: jest.fn(),
  sourceFile: jest.fn(),
  remove: jest.fn(),
};

function docWithFloors(n: number): DesignDocument {
  const d = createDesign({ name: "85 West St", mode: "blank", now: "2026-08-20T00:00:00.000Z" });
  d.floors = Array.from({ length: n }, (_, i) => ({
    id: `f${i}`,
    name: i === 0 ? "Ground" : `Level ${i}`,
    level: i,
    scaleMmPerUnit: 10,
    northDeg: null,
    northPos: null,
    plans: [],
  }));
  return d;
}

function renderCard(
  over: {
    doc?: DesignDocument;
    empty?: boolean;
    onExportJson?: () => void;
    onClose?: () => void;
  } = {}
) {
  const onExportJson = over.onExportJson ?? jest.fn();
  const onClose = over.onClose ?? jest.fn();
  const view = render(
    <ExportCard
      doc={over.doc ?? docWithFloors(2)}
      pack={null}
      planImages={planImages}
      empty={over.empty ?? false}
      onExportJson={onExportJson}
      loadVariant={async () => null}
      onClose={onClose}
    />
  );
  return { onExportJson, onClose, ...view };
}

const go = () => screen.getByRole("button", { name: /Print or save|Download/ });

describe("the choice comes first", () => {
  it("names every artifact by what comes out of it", () => {
    renderCard();
    for (const label of [
      "The design summary",
      "The summary and the plans",
      "The plans",
      "The plans as images",
      "The design file",
    ])
      expect(screen.getByRole("radio", { name: label })).toBeInTheDocument();
  });

  it("NEVER CALLS ANY OF IT A PACK", () => {
    /* the word promised a folder of documents — datasheets, schedules,
       compliance — and what comes out is a summary and some plans. On a
       blank-canvas design it was the summary alone. */
    const { container } = renderCard();
    expect(container.textContent).not.toMatch(/pack/i);
  });

  it("says what the button will do, not what mode you are in", async () => {
    const user = userEvent.setup();
    renderCard();
    expect(go()).toHaveTextContent("Print or save as PDF");

    await user.click(screen.getByRole("radio", { name: /The plans as images/ }));
    // two floors selected by default
    expect(go()).toHaveTextContent("Download 2 images");

    await user.click(screen.getByRole("radio", { name: /The design file/ }));
    expect(go()).toHaveTextContent("Download the design file");
  });
});

describe("the options are only the ones that apply", () => {
  it("drops the drawing and paper options for a summary-only export", async () => {
    const user = userEvent.setup();
    renderCard();
    await user.click(screen.getByRole("radio", { name: /The design summary/ }));
    await user.click(screen.getByRole("button", { name: /How it should look/ }));
    expect(screen.queryByText("Drawing")).not.toBeInTheDocument();
    expect(screen.queryByText("Floors")).not.toBeInTheDocument();
    // paper still matters — a summary is printed
    expect(screen.getByText("Paper")).toBeInTheDocument();
  });

  it("drops paper for the images — an export sheet should not ask about A3 for a PNG", async () => {
    const user = userEvent.setup();
    renderCard();
    await user.click(screen.getByRole("radio", { name: /The plans as images/ }));
    await user.click(screen.getByRole("button", { name: /How it should look/ }));
    expect(screen.getByText("Drawing")).toBeInTheDocument();
    expect(screen.queryByText("Paper")).not.toBeInTheDocument();
  });

  it("offers nothing to adjust on the design file", async () => {
    const user = userEvent.setup();
    renderCard();
    await user.click(screen.getByRole("radio", { name: /The design file/ }));
    expect(
      screen.queryByRole("button", { name: /How it should look/ })
    ).not.toBeInTheDocument();
  });
});

describe("what an empty design can still send", () => {
  it("cannot send a summary with no systems on it, but can still send a backup", async () => {
    const user = userEvent.setup();
    const { onExportJson } = renderCard({ empty: true });
    expect(go()).toBeDisabled();

    await user.click(screen.getByRole("radio", { name: /The design file/ }));
    expect(go()).toBeEnabled();
    await user.click(go());
    expect(onExportJson).toHaveBeenCalled();
  });
});

/* IT IS A DIALOG, NOT A CARD ABOVE A LONG DOCUMENT. The summary sheet runs
   several screens; the card used to unfold into the chrome bar at the top of
   it, so pressing Export after reading to the bottom moved nothing into view.
   These pin the three ways out and the portal — the shell's `.page` transform
   traps `position: fixed`, so a modal that renders in place is a modal stuck
   inside the scroller. */
describe("export comes to the reader", () => {
  it("is a modal dialog, portalled out of the summary's own tree", () => {
    const { container } = renderCard();
    const dialog = screen.getByRole("dialog", { name: "Export" });
    expect(dialog).toHaveAttribute("aria-modal", "true");
    expect(container).not.toContainElement(dialog);
    expect(document.body).toContainElement(dialog);
  });

  it("closes on the x, on the scrim, and on Escape", async () => {
    const user = userEvent.setup();

    const first = renderCard();
    await user.click(screen.getByRole("button", { name: "Close" }));
    expect(first.onClose).toHaveBeenCalledTimes(1);
    first.unmount();

    const second = renderCard();
    await user.keyboard("{Escape}");
    expect(second.onClose).toHaveBeenCalledTimes(1);
    second.unmount();

    const third = renderCard();
    /* the scrim only closes when the press LANDS on it — a drag that starts
       inside the dialog and finishes over the backdrop must not dismiss */
    const scrim = screen.getByRole("dialog").parentElement as HTMLElement;
    await user.click(screen.getByRole("radio", { name: /The design file/ }));
    expect(third.onClose).not.toHaveBeenCalled();
    await user.click(scrim);
    expect(third.onClose).toHaveBeenCalledTimes(1);
  });
});
