/* Reference viewer — serves the stored source files so the installer can read
   heights/sections/details without placing them. PDFs go in an iframe, images
   as <img>; multiple files get tabs. */

import { render, screen, fireEvent } from "@testing-library/react";
import { ReferenceViewer } from "../reference-viewer";
import { createDesign, type DesignDocument, type PlanImport } from "@/lib/studio/document";
import type { PlanImages } from "@/lib/studio/plans";

const fake: PlanImages = {
  upload: async () => "x",
  uploadSource: async () => "x",
  sourceFile: async () => new File([], "x"),
  url: async (ref) => `https://signed/${ref}`,
  remove: async () => {},
};

function docWith(planImport: PlanImport): DesignDocument {
  const d = createDesign({ name: "T", mode: "plan" });
  d.planImport = planImport;
  return d;
}

describe("ReferenceViewer", () => {
  it("renders the uploaded PDF in an iframe and closes on Escape", async () => {
    const onClose = jest.fn();
    render(
      <ReferenceViewer
        doc={docWith({ sources: [{ ref: "org/o1/src.pdf", kind: "pdf" }], placed: {}, chosen: [], names: {} })}
        planImages={fake}
        onClose={onClose}
      />
    );
    const frame = await screen.findByTitle("Reference PDF");
    expect(frame).toHaveAttribute("src", "https://signed/org/o1/src.pdf");

    fireEvent.keyDown(window, { key: "Escape" });
    expect(onClose).toHaveBeenCalled();
  });

  it("shows an image source as an <img>", async () => {
    render(
      <ReferenceViewer
        doc={docWith({ sources: [{ ref: "org/o1/plan.png", kind: "image" }], placed: {}, chosen: [], names: {} })}
        planImages={fake}
        onClose={() => {}}
      />
    );
    const img = await screen.findByAltText("Reference sheet");
    expect(img).toHaveAttribute("src", "https://signed/org/o1/plan.png");
  });

  it("offers a tab per file and switches between them", async () => {
    render(
      <ReferenceViewer
        doc={docWith({
          sources: [
            { ref: "org/o1/a.pdf", kind: "pdf" },
            { ref: "org/o1/b.pdf", kind: "pdf" },
          ],
          placed: {},
          chosen: [],
          names: {},
        })}
        planImages={fake}
        onClose={() => {}}
      />
    );
    // first file loads
    expect(await screen.findByTitle("Reference PDF")).toHaveAttribute(
      "src",
      "https://signed/org/o1/a.pdf"
    );
    // switch to the second
    fireEvent.click(screen.getByRole("tab", { name: "PDF 2" }));
    expect(await screen.findByTitle("Reference PDF")).toHaveAttribute(
      "src",
      "https://signed/org/o1/b.pdf"
    );
  });
});
