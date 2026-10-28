/* The menu's Start again and Delete design (Isaac, 27 October 2026: "make
   it so that you can restart a design or delete the existing design and
   start again"; and 28 October, after it took the plans with it: "it should
   just clear your things that you've added onto the plan. But not lose any
   of the data of the plans. Like the room sizes and all that").

   What has to hold: both ask first; Start again keeps the design's id, name,
   job, floors, plans, rooms, settings and Tiff's reading, clears the systems
   and everything on them, and stays on the canvas; a save already on its way
   can't write the old design back over the cleared one; and Delete design
   deletes, then lands on Home. */

import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { Studio, type PlanReader } from "../studio";
import { LocalDesignStore } from "@/lib/studio/store";
import { createDesign, type DesignDocument } from "@/lib/studio/document";
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
  async upload() {
    this.uploads += 1;
    return `org/o1/up_${this.uploads}.png`;
  }
  async uploadSource() {
    return "org/o1/src_1.pdf";
  }
  async sourceFile(ref: string) {
    return new File(["%PDF"], ref, { type: "application/pdf" });
  }
  async url() {
    return "data:image/png;base64,iVBORw0KGgo=";
  }
  async remove() {}
}

/* a design on job 3151 with a floor, a room on a system, its unit, and Tiff's reading */
function drawn(): DesignDocument {
  const d = createDesign({
    name: "Farran St",
    mode: "blank",
    jobNumber: "3151",
    client: "Diamond Air",
    site: "12 Farran St",
    job: { remoteId: "j-3151", jobNumber: "3151" },
    now: "2026-10-01T00:00:00.000Z",
  });
  const floorId = d.floors[0].id;
  d.systems = [{ id: "sys1", type: "split", brand: "me", colour: "#2E68FF", name: "S1", settings: {} }];
  d.objects = [
    {
      id: "rm1",
      type: "room",
      systemId: "sys1",
      floorId,
      geometry: { kind: "polygon", points: [{ x: 0, y: 0 }, { x: 200, y: 0 }, { x: 200, y: 200 }, { x: 0, y: 200 }] },
      plane: "room",
      props: { name: "Lounge", shape: "rect" },
    },
    {
      id: "u1",
      type: "unit",
      systemId: "sys1",
      floorId,
      geometry: { kind: "point", at: { x: 100, y: 20 } },
      plane: "room",
      props: { role: "idu", model: "MSZ-AP35VGD", roomId: "rm1" },
    },
  ];
  d.settings = { ...d.settings, climateZone: "6" };
  d.reading = { floors: {} } as unknown as DesignDocument["reading"];
  return d;
}

const stored = (id: string): DesignDocument | null => {
  const raw = window.localStorage.getItem(`heytiff.studio.design.${id}`);
  return raw ? (JSON.parse(raw) as DesignDocument) : null;
};

async function openOn(doc: DesignDocument, opts: { store?: LocalDesignStore; planReader?: PlanReader; planImages?: PlanImages } = {}) {
  const store = opts.store ?? new LocalDesignStore(window.localStorage);
  await new LocalDesignStore(window.localStorage).save(doc);
  const user = userEvent.setup();
  render(<Studio store={store} openDesignId={doc.id} planImages={opts.planImages ?? new FakePlanImages()} planReader={opts.planReader} />);
  expect(await screen.findByLabelText("Design name")).toHaveValue(doc.meta.name);
  return user;
}

async function menuPick(user: ReturnType<typeof userEvent.setup>, item: string) {
  await user.click(screen.getByRole("button", { name: "Studio menu" }));
  await user.click(screen.getByRole("menuitem", { name: item }));
}

describe("the Studio menu's Start again and Delete design", () => {
  beforeEach(() => {
    window.localStorage.clear();
    window.history.replaceState(null, "", "/dashboard/studio");
    pdfToPages.mockReset();
  });

  it("shows both, after Reference sheets, with Delete design red and last", async () => {
    const user = await openOn(drawn());
    await user.click(screen.getByRole("button", { name: "Studio menu" }));
    const items = within(screen.getByRole("menu")).getAllByRole("menuitem").map((b) => b.textContent);
    expect(items).toEqual(["New", "Open", "Save", "Edit plans", "Reference sheets", "Start again", "Delete design"]);
    expect(screen.getByRole("menuitem", { name: "Delete design" })).toHaveClass("ds-menu-item--danger");
    expect(screen.getByRole("menuitem", { name: "Start again" })).not.toHaveClass("ds-menu-item--danger");
  });

  it("Start again asks first, and Keep the design leaves it as it was", async () => {
    const doc = drawn();
    const user = await openOn(doc);
    await menuPick(user, "Start again");

    const ask = screen.getByRole("dialog", { name: "Start this design again?" });
    expect(ask).toHaveTextContent("Its systems, units, pipe runs and notes are cleared. It keeps its plans, its rooms, its name and its job.");
    await user.click(within(ask).getByRole("button", { name: "Keep the design" }));

    expect(screen.queryByRole("dialog", { name: "Start this design again?" })).toBeNull();
    expect(screen.queryByRole("dialog", { name: "Start again" })).toBeNull();
    expect(screen.getByTestId("studio-canvas")).toBeInTheDocument();
    await new Promise((r) => setTimeout(r, 700)); // past the autosave's wait
    const kept = stored(doc.id)!;
    expect(kept.objects).toHaveLength(2);
    expect(kept.systems).toHaveLength(1);
    expect(kept.floors).toHaveLength(1);
  });

  it("confirmed, clears the systems and what's on them, and keeps the plans, the rooms and the rest, on the canvas", async () => {
    const doc = drawn();
    const user = await openOn(doc);
    await menuPick(user, "Start again");
    await user.click(within(screen.getByRole("dialog", { name: "Start this design again?" })).getByRole("button", { name: "Start again" }));

    expect(screen.queryByRole("dialog", { name: "Start again" })).toBeNull();
    expect(screen.getByTestId("studio-canvas")).toBeInTheDocument();

    await waitFor(() => expect(stored(doc.id)!.systems).toHaveLength(0));
    const cleared = stored(doc.id)!;
    expect(cleared.id).toBe(doc.id);
    expect(cleared.meta.name).toBe("Farran St");
    expect(cleared.meta.createdAt).toBe(doc.meta.createdAt);
    expect([cleared.meta.jobNumber, cleared.meta.client, cleared.meta.site]).toEqual(["3151", "Diamond Air", "12 Farran St"]);
    expect(cleared.jobLink).toEqual(doc.jobLink);
    expect(cleared.floors).toEqual(doc.floors);
    expect(cleared.objects).toEqual([{ ...doc.objects[0], systemId: null }]);
    expect(cleared.settings.climateZone).toBe("6");
    expect(cleared.reading).toEqual(doc.reading);
    // the same design, not a second one beside it
    expect(JSON.parse(window.localStorage.getItem("heytiff.studio.index")!)).toHaveLength(1);
  });

  it("a save already on its way can't put the old design back", async () => {
    /* a server that holds its saves, then lands them in the order they're let go */
    class SlowServer extends LocalDesignStore {
      server: DesignDocument | null = null;
      calls: DesignDocument[] = [];
      held: (() => void)[] = [];
      hold = false;
      async save(d: DesignDocument) {
        this.calls.push(d);
        if (!this.hold) {
          this.server = d;
          return;
        }
        await new Promise<void>((res) =>
          this.held.push(() => {
            this.server = d;
            res();
          })
        );
      }
    }
    const store = new SlowServer(window.localStorage);
    const doc = drawn();
    const user = await openOn(doc, { store });

    store.hold = true;
    await user.type(screen.getByLabelText("Design name"), "!");
    await waitFor(() => expect(store.held).toHaveLength(1)); // the edit's save, on its way

    await menuPick(user, "Start again");
    await user.click(within(screen.getByRole("dialog", { name: "Start this design again?" })).getByRole("button", { name: "Start again" }));

    /* the cleared design waits behind the save in flight */
    await new Promise((r) => setTimeout(r, 900));
    expect(store.calls.every((d) => d.systems.length === 1)).toBe(true);

    /* the old save lands late; the cleared one still lands after it */
    store.hold = false;
    [...store.held].reverse().forEach((go) => go());
    await waitFor(() => expect(store.server?.systems).toHaveLength(0));
    expect(store.server!.id).toBe(doc.id);
    expect(store.server!.meta.name).toBe("Farran St!");
    await new Promise((r) => setTimeout(r, 700));
    expect(store.server!.objects).toHaveLength(1);
    expect(store.server!.systems).toHaveLength(0);
  });

  it("Delete design asks as Home does, deletes, then lands on Home", async () => {
    const doc = drawn();
    const user = await openOn(doc);
    await menuPick(user, "Delete design");

    const ask = screen.getByRole("dialog", { name: "Delete Farran St?" });
    expect(ask).toHaveTextContent("The design, its floors and its systems go for good.");
    await user.click(within(ask).getByRole("button", { name: "Delete design" }));

    expect(await screen.findByRole("button", { name: "New design" })).toBeInTheDocument();
    expect(await screen.findByText("No designs yet")).toBeInTheDocument();
    await new Promise((r) => setTimeout(r, 700)); // nothing saves it back
    expect(stored(doc.id)).toBeNull();
    expect(window.location.search).toBe("");
  });
});
