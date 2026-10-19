/* New design, from the plans to the canvas (v2, 19 October): drop the set,
   tick the floor plans in a long one, crop a page with several plans on it,
   set the levels, Start design. Only pdf.js's raster step is mocked. */

import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { Studio } from "../studio";
import { LocalDesignStore } from "@/lib/studio/store";
import type { PageImage, PlanImages } from "@/lib/studio/plans";

import { pdfToPages as pdfToPagesReal } from "@/lib/studio/plans";

jest.mock("@/lib/studio/plans", () => ({
  ...jest.requireActual("@/lib/studio/plans"),
  pdfToPages: jest.fn(),
  imageToPage: jest.fn(),
}));
const pdfToPages = pdfToPagesReal as unknown as jest.Mock;

const page = (n: number): PageImage => ({
  pageNumber: n,
  label: `Page ${n}`,
  blob: new Blob(["x"], { type: "image/png" }),
  ext: "png",
  thumbUrl: `blob:page-${n}`,
  width: 2000,
  height: 1400,
});

class FakePlanImages implements PlanImages {
  uploads = 0;
  sources = 0;
  async upload() {
    this.uploads += 1;
    return `org/o1/up_${this.uploads}.png`;
  }
  async uploadSource() {
    this.sources += 1;
    return `org/o1/src_${this.sources}.pdf`;
  }
  async sourceFile(ref: string) {
    return new File(["%PDF"], ref, { type: "application/pdf" });
  }
  async url() {
    return "data:image/png;base64,iVBORw0KGgo=";
  }
  async remove() {}
}

const INDEX = "heytiff.studio.index";
const saved = () => {
  const [row] = JSON.parse(window.localStorage.getItem(INDEX) ?? "[]");
  return JSON.parse(window.localStorage.getItem(`heytiff.studio.design.${row.id}`)!);
};

async function open(pages: number) {
  pdfToPages.mockResolvedValue(Array.from({ length: pages }, (_, i) => page(i + 1)));
  const fake = new FakePlanImages();
  const user = userEvent.setup();
  render(<Studio store={new LocalDesignStore(window.localStorage)} planImages={fake} />);
  await user.click(await screen.findByRole("button", { name: "New design" }));
  const dialog = screen.getByRole("dialog", { name: "New design" });
  await user.type(within(dialog).getByPlaceholderText(/Design name/), "44 Frogmore St");
  fireEvent.change(document.querySelector('.pt-dialog input[type="file"]')!, {
    target: { files: [new File(["%PDF"], "set.pdf", { type: "application/pdf" })] },
  });
  return { user, fake };
}

describe("New design, from the plans", () => {
  beforeEach(() => {
    window.localStorage.clear();
    pdfToPages.mockReset();
  });

  it("a long set opens its pages with nothing ticked; the ticked ones become floors from the ground up", async () => {
    const { user, fake } = await open(20);
    const picker = await screen.findByRole("dialog", { name: "Choose the floor plans" });
    expect(within(picker).getByRole("button", { name: "Use 0 pages" })).toBeDisabled();
    await user.click(within(picker).getByRole("button", { name: "Page 6" }));
    await user.click(within(picker).getByRole("button", { name: "Page 7" }));
    expect(within(picker).getByText("Pages 6 and 7")).toBeInTheDocument();
    await user.click(within(picker).getByRole("button", { name: "Use 2 pages" }));

    const floors = await screen.findByRole("list", { name: "Floors" });
    const rows = within(floors).getAllByRole("listitem");
    expect(rows).toHaveLength(2);
    expect(within(rows[0]).getByText("Page 6")).toBeInTheDocument();
    expect(within(rows[0]).getByRole("combobox", { name: /Level of Ground floor/ })).toBeInTheDocument();
    expect(within(rows[1]).getByRole("combobox", { name: /Level of Level 1/ })).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "Start design, 2 floors" }));
    expect(await screen.findByTestId("studio-canvas")).toBeInTheDocument();
    // the file and the two pages used are stored; the other 18 pages aren't
    expect(fake.sources).toBe(1);
    expect(fake.uploads).toBe(2);
    await waitFor(() => expect(saved().floors).toHaveLength(2));
    const doc = saved();
    expect(doc.meta.name).toBe("44 Frogmore St");
    expect(doc.floors.map((f: { name: string; level: number }) => [f.name, f.level])).toEqual([
      ["Ground floor", 0],
      ["Level 1", 1],
    ]);
    expect(doc.floors.every((f: { scaleMmPerUnit: number | null }) => f.scaleMmPerUnit === null)).toBe(true);
    expect(doc.planImport.chosen).toEqual([5, 6]);
  });

  it("three pages or fewer come in ticked, straight to the floors", async () => {
    await open(2);
    const floors = await screen.findByRole("list", { name: "Floors" });
    expect(within(floors).getAllByRole("listitem")).toHaveLength(2);
    expect(screen.queryByRole("dialog", { name: "Choose the floor plans" })).toBeNull();
  });

  it("two plans set to the same level are one floor holding both", async () => {
    const { user } = await open(2);
    await screen.findByRole("list", { name: "Floors" });
    await user.click(screen.getByRole("combobox", { name: /Level of Level 1/ }));
    await user.click(screen.getByRole("option", { name: "Ground floor" }));
    await user.click(screen.getByRole("button", { name: "Start design, 1 floor" }));
    await screen.findByTestId("studio-canvas");
    await waitFor(() => expect(saved().floors).toHaveLength(1));
    expect(saved().floors[0].plans).toHaveLength(2);
  });

  it("a page with several plans is cropped into floors, each holding only its box", async () => {
    const { user, fake } = await open(1);
    await screen.findByRole("list", { name: "Floors" });
    await user.click(screen.getByRole("button", { name: "Crop" }));

    const crop = await screen.findByRole("dialog", { name: "Crop the plans out of page 1" });
    const svg = within(crop).getByRole("img", { name: /drag a box round a plan/ });
    // jsdom has no layout: the page is drawn 1000 wide from 0,0, so a screen pixel is two page pixels
    svg.getBoundingClientRect = () => ({ left: 0, top: 0, width: 1000, height: 700, right: 1000, bottom: 700, x: 0, y: 0, toJSON() {} });
    svg.setPointerCapture = () => {};
    const box = (a: [number, number], b: [number, number]) => {
      fireEvent.pointerDown(svg, { clientX: a[0], clientY: a[1], pointerId: 1 });
      fireEvent.pointerMove(svg, { clientX: b[0], clientY: b[1], pointerId: 1 });
      fireEvent.pointerUp(svg, { clientX: b[0], clientY: b[1], pointerId: 1 });
    };
    box([10, 20], [480, 680]);
    await user.click(within(crop).getByRole("button", { name: "Crop it out" }));
    box([520, 20], [990, 680]);
    await user.click(within(crop).getByRole("button", { name: "Crop it out" }));
    expect(within(crop).getAllByRole("button", { name: "Put back" })).toHaveLength(2);
    await user.click(within(crop).getByRole("button", { name: "Done, 2 floors" }));

    const rows = within(await screen.findByRole("list", { name: "Floors" })).getAllByRole("listitem");
    expect(rows).toHaveLength(2);
    expect(within(rows[0]).getByText("Page 1, cropped")).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Start design, 2 floors" }));
    await screen.findByTestId("studio-canvas");
    await waitFor(() => expect(saved().floors).toHaveLength(2));
    const [ground, level1] = saved().floors;
    // one stored page, shared: both floors are windows on the same raster
    expect(fake.uploads).toBe(1);
    expect(ground.plans[0].imageRef).toBe(level1.plans[0].imageRef);
    expect(ground.plans[0].crop).toEqual({ x: 20, y: 40, w: 940, h: 1320 });
    expect(level1.plans[0].crop).toEqual({ x: 1040, y: 40, w: 940, h: 1320 });
  });

  it("a set with no pages says so and stays on the first step", async () => {
    pdfToPages.mockResolvedValue([]);
    const user = userEvent.setup();
    render(<Studio store={new LocalDesignStore(window.localStorage)} planImages={new FakePlanImages()} />);
    await user.click(await screen.findByRole("button", { name: "New design" }));
    fireEvent.change(document.querySelector('.pt-dialog input[type="file"]')!, {
      target: { files: [new File(["%PDF"], "empty.pdf", { type: "application/pdf" })] },
    });
    expect(await screen.findByRole("alert")).toHaveTextContent("No pages in that");
    expect(screen.getByText("Drop the plans")).toBeInTheDocument();
  });
});
