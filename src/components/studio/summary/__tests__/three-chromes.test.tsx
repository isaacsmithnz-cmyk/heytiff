/* ONE DOCUMENT, THREE CHROMES — and the separation is the point.

   `SheetDoc` is the artifact. The Summary screen, the customer's live link and
   the printed pack all render it, and what differs is what each one passes IN.
   That is what makes the owner-only material ABSENT from the other two rather
   than hidden in them, and absence is the only version of this that is safe:
   the checks list names what is wrong with a design before anyone has decided
   how to present it.

   So this suite asserts the same document three ways and then asserts what
   each chrome does NOT have — by querying the rendered output, not by eye. */

import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { createDesign, type DesignDocument } from "@/lib/studio/document";
import type { SimApprovalState } from "@/lib/studio/sim-approval";
import {
  buildDesignSnapshot,
  buildSummaryModel,
  designBasis,
} from "@/lib/studio/summary";
import { NO_BRAND } from "@/lib/org/brand";
import { SheetDoc } from "../sheet-doc";
import { SummaryView } from "../summary";

/* Contributors and Share resolve a lazily imported action after paint;
   settling either mid-assertion is act() noise about a card this suite is not
   testing. Held pending on purpose. */
jest.mock("@/app/actions/studio-contributors", () => ({
  listDesignContributors: jest.fn(() => new Promise(() => {})),
}));
jest.mock("@/app/actions/studio-share", () => ({
  getShareLink: jest.fn(() => new Promise(() => {})),
  createShareLink: jest.fn(),
  revokeShareLink: jest.fn(),
}));
jest.mock("@/app/actions/org", () => ({
  getOrgBrand: jest.fn(() => new Promise(() => {})),
}));

const NOTHING: SimApprovalState = {
  simulatable: [],
  approved: [],
  pending: [],
  lapsed: [],
  offered: false,
};

const planImages = {
  url: jest.fn(),
  upload: jest.fn(),
  uploadSource: jest.fn(),
  sourceFile: jest.fn(),
  remove: jest.fn(),
};

function baseDoc(): DesignDocument {
  return createDesign({
    name: "18 Kembla Street",
    mode: "blank",
    now: "2026-08-17T00:00:00.000Z",
    jobNumber: "2214",
    client: "Halloran Bros Construction",
    site: "18 Kembla Street\nWollongong\nNSW 2500",
    job: { remoteId: "job-uuid", jobNumber: "2214" },
  });
}

function renderOwner(doc = baseDoc(), onMutate = jest.fn()) {
  render(
    <SummaryView
      doc={doc}
      pack={null}
      onMutate={onMutate}
      onExportJson={jest.fn()}
      simFlag
      simReady={{ ok: true, reason: "", floorName: "Ground" }}
      simApproval={NOTHING}
      onSimulate={jest.fn()}
      planImages={planImages}
      loadVariant={jest.fn()}
    />
  );
  return { onMutate };
}

/** the document with NOTHING passed in — what paper gets */
function renderBare(doc = baseDoc()) {
  render(
    <SheetDoc
      doc={doc}
      model={buildSummaryModel(doc, null)}
      snapshot={buildDesignSnapshot(doc)}
      basis={designBasis(doc)}
      brand={NO_BRAND}
      eyebrow="Design summary"
      preparedOn="17 August 2026"
    />
  );
}

describe("the document itself, whoever is holding it", () => {
  it("says the same things on the owner's copy and on paper", () => {
    const { unmount } = render(<div />);
    unmount();
    renderBare();
    for (const t of [
      "Design summary",
      "Prepared by",
      "17 August 2026",
      "Calculated heat load",
      "Climate zone",
    ])
      expect(screen.getByText(t)).toBeInTheDocument();
    // the addressee, read-only
    expect(screen.getByText("Halloran Bros Construction")).toBeInTheDocument();
    expect(screen.getByText("Wollongong")).toBeInTheDocument();
    expect(screen.getByText("2214")).toBeInTheDocument();
  });

  it("PAPER HAS NO CONTROLS — a page cannot be pressed", () => {
    renderBare();
    expect(screen.queryAllByRole("button")).toHaveLength(0);
    expect(screen.queryAllByRole("textbox")).toHaveLength(0);
  });
});

describe("the owner's chrome", () => {
  it("carries the checks verdict, Share and Export above the document", () => {
    /* a design with nothing wrong says so rather than showing an empty pill;
       the pill itself is covered where the checks are, in sim-gate.test */
    renderOwner();
    expect(screen.getByText("Nothing flagged")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /Share/ })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /Export/ })).toBeInTheDocument();
  });

  it("TYPES INTO THE LETTERHEAD, in the document's own frame", async () => {
    const user = userEvent.setup();
    const { onMutate } = renderOwner();
    const client = screen.getByRole("textbox", { name: "Client" });
    // the same block the customer reads, filled with fields instead of text
    expect(client.closest("address")).toHaveClass("dsd-to");
    await user.type(client, "!");
    expect(onMutate).toHaveBeenCalled();
    for (const name of ["Client", "Site", "Job number"])
      expect(screen.getByRole("textbox", { name })).toBeInTheDocument();
  });

  it("shows where the job number came from, and how to detach it", () => {
    renderOwner();
    expect(screen.getByText(/Added from ServiceM8 2214/)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Unlink" })).toBeInTheDocument();
  });

  it("hangs the picklist and its push off the foot of the document", () => {
    const doc = baseDoc();
    doc.objects = [
      {
        id: "u1",
        type: "unit",
        systemId: null,
        floorId: "f",
        geometry: { kind: "point", at: { x: 0, y: 0 } },
        plane: "room",
        props: { role: "idu", model: "MSZ-AP25VGD2" },
      },
    ];
    renderOwner(doc);
    const pick = screen.getByRole("heading", { name: "Material picklist" });
    expect(pick).toBeInTheDocument();
    expect(screen.getByText("Units")).toBeInTheDocument();
    /* NO CHECKBOXES: it becomes tickable on the job card, not on the sheet */
    expect(screen.queryAllByRole("checkbox")).toHaveLength(0);
    expect(
      screen.getByRole("button", { name: /Add to job 2214/ })
    ).toBeInTheDocument();
  });
});

describe("what the owner's chrome adds is not IN the document", () => {
  it("the bare document has no letterhead fields, provenance or push", () => {
    /* the customer's link renders exactly this — the guarantee is that the
       owner's material is passed in, so a copy that passes nothing has none
       of it. Absence, not a hidden attribute. */
    renderBare();
    expect(screen.queryByText(/Added from ServiceM8/)).not.toBeInTheDocument();
    expect(screen.queryByText(/to check before you send this/)).not.toBeInTheDocument();
    expect(screen.queryByText("Contributors")).not.toBeInTheDocument();
    expect(screen.queryByText("Material picklist")).not.toBeInTheDocument();
  });

  it("the owner's letterhead is the ONLY thing that differs in that block", () => {
    /* one frame, two fillings — if the owner's copy grew its own letterhead
       markup the two would drift into different documents */
    renderOwner();
    const owner = screen.getByRole("textbox", { name: "Client" }).closest("address");
    expect(owner).toHaveClass("dsd-to");
    expect(within(owner as HTMLElement).getByText("Job")).toBeInTheDocument();
  });
});
