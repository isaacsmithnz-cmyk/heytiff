import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { PaperworkScreen, type PaperworkProps } from "../paperwork-screen";

const addFanModel = jest.fn();
const updateFanModel = jest.fn();
const removeFanModel = jest.fn();
jest.mock("@/app/actions/certificates", () => ({
  addFanModel: (...a: unknown[]) => addFanModel(...a),
  updateFanModel: (...a: unknown[]) => updateFanModel(...a),
  removeFanModel: (...a: unknown[]) => removeFanModel(...a),
  approveCertWording: jest.fn(async () => ({ ok: true })),
}));
jest.mock("@/app/actions/swms", () => ({ approveSwmsLibrary: jest.fn(async () => ({ ok: true })) }));
jest.mock("next/navigation", () => ({ useRouter: () => ({ refresh: jest.fn() }) }));

const props = (over: Partial<PaperworkProps> = {}): PaperworkProps => ({
  isOwner: true,
  ownerName: "Isaac Smith",
  canEditFans: true,
  swms: { by: "Isaac Smith", on: "Sat 3 Oct" },
  wording: {
    approved: null,
    changed: [
      { clause: "airBalance", isNew: false },
      { clause: "condensate", isNew: true },
    ],
    lastApprovedOn: "Sat 3 Oct",
    earlier: [{ by: "Isaac Smith", on: "Sat 3 Oct" }],
  },
  fans: [{ id: "f1", model: "XF100", ratedLps: 40 }],
  ...over,
});
const panel = () => within(screen.getByRole("tabpanel"));

beforeEach(() => jest.clearAllMocks());

describe("PaperworkScreen", () => {
  it("opens on an overview of what needs doing, with the way back to Admin", () => {
    render(<PaperworkScreen {...props()} />);
    expect(screen.getByRole("link", { name: /Admin/ })).toHaveAttribute("href", "/dashboard/admin");
    expect(panel().getByText("Approved by Isaac Smith on Sat 3 Oct")).toBeInTheDocument();
    expect(panel().getByText("2 changed since Sat 3 Oct. Waiting for your approval")).toBeInTheDocument();
    expect(panel().getByText("1 fan")).toBeInTheDocument();
  });

  it("opens the tab a link names", () => {
    render(<PaperworkScreen {...props({ initialSec: "fans" })} />);
    expect(screen.getByRole("tab", { name: "Fan list" })).toHaveAttribute("aria-selected", "true");
  });

  it("shows only what changed since the last approval, marked, and everything at a press", async () => {
    render(<PaperworkScreen {...props({ initialSec: "wording" })} />);
    const p = panel();
    expect(p.getByText("2 statements have changed since you approved the wording on Sat 3 Oct. Read them, then approve.")).toBeInTheDocument();
    expect(p.getByLabelText("Air balance report")).toHaveTextContent("Changed");
    expect(p.getByLabelText("Condensate drainage")).toHaveTextContent("New");
    expect(p.queryByLabelText("Refrigerant circuit, AS/NZS 5149.2")).toBeNull();
    await userEvent.click(p.getByRole("checkbox", { name: "Show only what changed" }));
    expect(p.getByLabelText("Refrigerant circuit, AS/NZS 5149.2")).toHaveTextContent("[The refrigerant and the charge added, per outdoor unit when they differ]");
    expect(p.getByRole("button", { name: "Approve the wording" })).toBeInTheDocument();
  });

  it("says who approves it, and offers no button, to someone who isn't the owner", () => {
    render(<PaperworkScreen {...props({ isOwner: false, initialSec: "wording" })} />);
    expect(panel().getByText("Waiting for Isaac Smith to approve it. No certificate can be issued until then.")).toBeInTheDocument();
    expect(panel().queryByRole("button", { name: "Approve the wording" })).toBeNull();
  });

  it("corrects a fan's rated airflow, removes one, and adds one", async () => {
    updateFanModel.mockResolvedValue({ ok: true, fan: { id: "f1", model: "XF100", ratedLps: 45 } });
    removeFanModel.mockResolvedValue({ ok: true });
    addFanModel.mockResolvedValue({ ok: true, fan: { id: "f2", model: "SJMF100", ratedLps: 67 } });
    render(<PaperworkScreen {...props({ initialSec: "fans" })} />);
    const p = panel();
    const lps = p.getByLabelText("XF100 rated L/s");
    await userEvent.clear(lps);
    await userEvent.type(lps, "45");
    await userEvent.click(p.getByRole("button", { name: "Save" }));
    expect(updateFanModel).toHaveBeenCalledWith("f1", 45);
    expect(p.queryByRole("button", { name: "Save" })).toBeNull();
    await userEvent.type(p.getByLabelText("Model"), "SJMF100");
    await userEvent.type(p.getByLabelText("Rated L/s"), "67");
    await userEvent.click(p.getByRole("button", { name: "Add the fan" }));
    expect(addFanModel).toHaveBeenCalledWith("SJMF100", 67);
    expect(await p.findByText("SJMF100")).toBeInTheDocument();
    await userEvent.click(p.getByRole("button", { name: "Remove XF100" }));
    expect(removeFanModel).toHaveBeenCalledWith("f1");
    expect(p.queryByText("XF100")).toBeNull();
  });

  it("shows the fan list read-only to someone who can't change it", () => {
    render(<PaperworkScreen {...props({ canEditFans: false, initialSec: "fans" })} />);
    expect(panel().getByText("40 L/s rated")).toBeInTheDocument();
    expect(panel().queryByRole("button", { name: /Remove/ })).toBeNull();
  });
});
