/* SEND — one dialog where Share and Export were two.

   Export listed five machines and always printed the material picklist, so a
   customer's copy could not be made without it; Share made a link that showed
   whatever the sheet showed. These pin what replaced both: where it goes, who
   it is for, a tick per part, a link that remembers what it was made with,
   and the three ways out of the dialog. */

import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { createDesign, type DesignDocument } from "@/lib/studio/document";
import { buildDesignSnapshot, buildSummaryModel, designBasis } from "@/lib/studio/summary";
import { NO_BRAND } from "@/lib/org/brand";
import { SHARE_TTL_DAYS, shareExpiresAt } from "@/lib/studio/share";
import { SendCard, type SendCheck } from "../send-card";

jest.mock("@/app/actions/org", () => ({
  getOrgBrand: jest.fn(() => new Promise(() => {})),
}));

const getShareLink = jest.fn();
const createShareLink = jest.fn();
const updateShareScope = jest.fn();
const revokeShareLink = jest.fn();
jest.mock("@/app/actions/studio-share", () => ({
  getShareLink: (...a: unknown[]) => getShareLink(...a),
  createShareLink: (...a: unknown[]) => createShareLink(...a),
  updateShareScope: (...a: unknown[]) => updateShareScope(...a),
  revokeShareLink: (...a: unknown[]) => revokeShareLink(...a),
}));

const planImages = {
  url: jest.fn(async (r: string) => `blob:${r}`),
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

const link = (over: Record<string, unknown> = {}) => ({
  url: "https://heytiff.vercel.app/live/tok",
  createdAt: "2026-07-20T00:00:00.000Z",
  expiresAt: shareExpiresAt("2026-07-20T00:00:00.000Z").toISOString(),
  expired: false,
  daysLeft: 9,
  scope: { parts: ["figures", "systems", "plans"], hiddenFloorIds: [] },
  ...over,
});

function renderCard(
  over: {
    doc?: DesignDocument;
    empty?: boolean;
    simOffered?: boolean;
    checks?: SendCheck[];
    onExportJson?: () => void;
    onClose?: () => void;
  } = {}
) {
  const doc = over.doc ?? docWithFloors(2);
  const onExportJson = over.onExportJson ?? jest.fn();
  const onClose = over.onClose ?? jest.fn();
  const view = render(
    <SendCard
      doc={doc}
      pack={null}
      brand={NO_BRAND}
      model={buildSummaryModel(doc, null)}
      snapshot={buildDesignSnapshot(doc)}
      basis={designBasis(doc)}
      preparedOn="20 August 2026"
      planImages={planImages}
      empty={over.empty ?? false}
      simOffered={over.simOffered ?? false}
      checks={over.checks ?? []}
      onExportJson={onExportJson}
      loadVariant={async () => null}
      onClose={onClose}
    />
  );
  return { onExportJson, onClose, ...view };
}

const box = (name: RegExp | string) => screen.getByRole("checkbox", { name });
const foot = () => document.querySelector(".ds-xm-foot") as HTMLElement;
const toLink = (user: ReturnType<typeof userEvent.setup>) =>
  user.click(screen.getByRole("radio", { name: "Live link" }));

beforeEach(() => {
  jest.clearAllMocks();
  getShareLink.mockResolvedValue(null);
});

describe("where it goes, who it is for, what goes in", () => {
  it("starts on the customer's copy: the design without the materials", () => {
    renderCard();
    expect(box(/Heat loads/)).toBeChecked();
    expect(box(/Systems and rooms/)).toBeChecked();
    expect(box(/Floor plans/)).toBeChecked();
    expect(box(/Pipe, electrical/)).not.toBeChecked();
    expect(screen.getByRole("button", { name: "The customer" })).toHaveAttribute("aria-pressed", "true");
  });

  it("the install team keeps the heat loads and gets the pipework", async () => {
    const user = userEvent.setup();
    renderCard();
    await user.click(screen.getByRole("button", { name: "The install team" }));
    expect(box(/Heat loads/)).toBeChecked();
    expect(box(/Pipe, electrical/)).toBeChecked();
  });

  it("offers two presets, and each can be chosen", async () => {
    const user = userEvent.setup();
    renderCard();
    const team = screen.getByRole("button", { name: "The install team" });
    await user.click(team);
    expect(team).toHaveAttribute("aria-pressed", "true");
    await user.click(screen.getByRole("button", { name: "The customer" }));
    expect(screen.getByRole("button", { name: "The customer" })).toHaveAttribute("aria-pressed", "true");
    expect(screen.queryByRole("button", { name: "The office" })).not.toBeInTheDocument();
  });

  it("a hand-ticked set is nobody's preset", async () => {
    const user = userEvent.setup();
    renderCard();
    await user.click(box(/Heat loads/));
    for (const name of ["The customer", "The install team"])
      expect(screen.getByRole("button", { name })).toHaveAttribute("aria-pressed", "false");
  });

  it("the live link can't carry the picklist, and has no one else to be for", async () => {
    const user = userEvent.setup();
    renderCard();
    await toLink(user);
    expect(box(/Material picklist/)).toBeDisabled();
    expect(screen.getByText("Not on the link")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "The customer" })).not.toBeInTheDocument();
  });

  it("paper can't run the simulation; the link can once it is ticked ready", async () => {
    const user = userEvent.setup();
    const first = renderCard();
    expect(box(/Simulation/)).toBeDisabled();
    expect(screen.getByText("Link only")).toBeInTheDocument();
    await toLink(user);
    expect(box(/Simulation/)).toBeDisabled();
    expect(screen.getByText("Not ticked ready")).toBeInTheDocument();
    first.unmount();

    renderCard({ simOffered: true });
    await toLink(user);
    expect(box(/Simulation/)).toBeEnabled();
  });

  it("hangs a tick per floor under the plans", () => {
    renderCard();
    expect(box("Ground")).toBeChecked();
    expect(box("Level 1")).toBeChecked();
  });

  it("offers other options only on a design that has them", () => {
    const first = renderCard();
    expect(screen.queryByRole("checkbox", { name: /Other options/ })).not.toBeInTheDocument();
    first.unmount();

    const d = docWithFloors(1);
    d.variants = [
      { id: d.id, label: "Option A" },
      { id: "dsn_b", label: "Option B" },
    ];
    renderCard({ doc: d });
    expect(box(/Other options/)).not.toBeChecked();
  });

  it("NEVER CALLS ANY OF IT A PACK", () => {
    renderCard();
    expect(document.body.textContent).not.toMatch(/\bpack\b/i);
  });
});

describe("the button says what pressing it will do", () => {
  it("prints the ticked parts, and says so", () => {
    renderCard();
    expect(within(foot()).getByRole("button", { name: /Print or save as PDF/ })).toBeEnabled();
  });

  it("with nothing ticked it says what is missing, and can't be pressed", async () => {
    const user = userEvent.setup();
    renderCard();
    for (const name of [/Heat loads/, /Systems and rooms/, /Floor plans/]) await user.click(box(name));
    expect(within(foot()).getByRole("button", { name: "Tick something to send" })).toBeDisabled();
    expect(screen.getByText("Nothing ticked yet.")).toBeInTheDocument();
  });

  it("an empty design can still send its heat loads, its plans and the design file", async () => {
    const user = userEvent.setup();
    const { onExportJson } = renderCard({ empty: true });
    expect(box(/Systems and rooms/)).toBeDisabled();
    expect(screen.getAllByText("Nothing designed yet")).toHaveLength(2);
    expect(within(foot()).getByRole("button", { name: /Print or save as PDF/ })).toBeEnabled();
    await user.click(screen.getByRole("button", { name: "Design file" }));
    expect(onExportJson).toHaveBeenCalled();
  });

  it("says what to check before it goes", () => {
    renderCard({
      checks: [
        { title: "Bed 2 is under-covered", detail: "2.5 kW against 2.9 kW." },
        { title: "1 room has no unit", detail: "Listed under Not served yet." },
      ],
    });
    expect(screen.getByText("2 to check")).toBeInTheDocument();
    expect(screen.getByText(/Bed 2 is under-covered, and 1 more/)).toBeInTheDocument();
  });
});

describe("the live link", () => {
  it("tells you the lifetime BEFORE you make one, and makes it with the ticks", async () => {
    const user = userEvent.setup();
    createShareLink.mockResolvedValue(link({ daysLeft: SHARE_TTL_DAYS }));
    renderCard();
    await toLink(user);
    expect(await screen.findByText(new RegExp(`works for ${SHARE_TTL_DAYS} days`))).toBeInTheDocument();

    await user.click(within(foot()).getByRole("button", { name: "Create live link" }));
    expect(createShareLink).toHaveBeenCalledWith(
      expect.any(String),
      { parts: ["figures", "systems", "plans"], hiddenFloorIds: [] }
    );
    expect(await screen.findByText(`${SHARE_TTL_DAYS} days`)).toBeInTheDocument();
  });

  it("shows what the link shows when you turn to it", async () => {
    const user = userEvent.setup();
    getShareLink.mockResolvedValue(link({ scope: { parts: ["figures", "lines"], hiddenFloorIds: [] } }));
    renderCard();
    await waitFor(() => expect(getShareLink).toHaveBeenCalled());
    await toLink(user);
    expect(box(/Pipe, electrical/)).toBeChecked();
    expect(box(/Systems and rooms/)).not.toBeChecked();
    expect(within(foot()).getByRole("button", { name: /Copy link/ })).toBeInTheDocument();
  });

  it("changing a tick asks to update the link, and never rotates it", async () => {
    const user = userEvent.setup();
    getShareLink.mockResolvedValue(link());
    updateShareScope.mockImplementation(async (_id: string, scope: unknown) => link({ scope }));
    renderCard();
    await toLink(user);
    await screen.findByText("9 days");

    await user.click(box(/Heat loads/));
    await user.click(within(foot()).getByRole("button", { name: "Update the link" }));
    expect(updateShareScope).toHaveBeenCalledWith(expect.any(String), {
      parts: ["systems", "plans"],
      hiddenFloorIds: [],
    });
    expect(createShareLink).not.toHaveBeenCalled();
    expect(await within(foot()).findByRole("button", { name: /Copy link/ })).toBeInTheDocument();
  });

  it("uses the singular on the last day", async () => {
    const user = userEvent.setup();
    getShareLink.mockResolvedValue(link({ daysLeft: 1 }));
    renderCard();
    await toLink(user);
    expect(await screen.findByText("1 day")).toBeInTheDocument();
  });

  it("an expired link says so and offers a new one instead of Copy", async () => {
    const user = userEvent.setup();
    getShareLink.mockResolvedValue(link({ expired: true, daysLeft: 0 }));
    renderCard();
    await toLink(user);
    expect(await screen.findByText(/anyone opening it now sees nothing/i)).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /Copy link/ })).not.toBeInTheDocument();
    expect(within(foot()).getByRole("button", { name: "Create a new link" })).toBeInTheDocument();
  });

  it("revoke asks twice, and Keep backs out", async () => {
    const user = userEvent.setup();
    getShareLink.mockResolvedValue(link());
    renderCard();
    await toLink(user);
    await user.click(await within(foot()).findByRole("button", { name: /Revoke/ }));
    await user.click(within(foot()).getByRole("button", { name: "Keep" }));
    expect(revokeShareLink).not.toHaveBeenCalled();

    revokeShareLink.mockResolvedValue(undefined);
    await user.click(within(foot()).getByRole("button", { name: /Revoke/ }));
    await user.click(within(foot()).getByRole("button", { name: "Really revoke" }));
    expect(revokeShareLink).toHaveBeenCalled();
    expect(await within(foot()).findByRole("button", { name: "Create live link" })).toBeInTheDocument();
  });

  it("without a session it says why, and puts nothing on the bar", async () => {
    const user = userEvent.setup();
    getShareLink.mockRejectedValue(new Error("no session"));
    renderCard();
    await toLink(user);
    expect(await screen.findByText(/needs a signed-in session/i)).toBeInTheDocument();
    expect(foot()).toBeNull();
  });
});

/* IT IS A DIALOG, NOT A CARD ABOVE A LONG DOCUMENT. The shell's `.page`
   transform traps `position: fixed`, so a modal rendered in place is a modal
   stuck inside the scroller. */
describe("send comes to the reader", () => {
  it("is a modal dialog, portalled out of the summary's own tree", () => {
    const { container } = renderCard();
    const dialog = screen.getByRole("dialog", { name: "Share" });
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
    /* only a press that LANDS on the scrim closes it */
    await user.click(box(/Heat loads/));
    expect(third.onClose).not.toHaveBeenCalled();
    await user.click(screen.getByRole("dialog").parentElement as HTMLElement);
    expect(third.onClose).toHaveBeenCalledTimes(1);
  });
});
