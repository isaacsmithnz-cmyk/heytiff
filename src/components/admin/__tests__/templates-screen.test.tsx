import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { TemplatesScreen, type TemplatesProps } from "../templates-screen";

jest.mock("@/app/actions/certificates", () => ({ approveCertWording: jest.fn(async () => ({ ok: true })) }));
jest.mock("@/app/actions/swms", () => ({ approveSwmsLibrary: jest.fn(async () => ({ ok: true })) }));
jest.mock("next/navigation", () => ({ useRouter: () => ({ refresh: jest.fn() }) }));

const props = (over: Partial<TemplatesProps> = {}): TemplatesProps => ({
  isOwner: true,
  ownerName: "Isaac Smith",
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
  ...over,
});
const panel = () => within(screen.getByRole("tabpanel"));

describe("TemplatesScreen", () => {
  it("has a tab for each document, with the way back to Admin", () => {
    render(<TemplatesScreen {...props({ initialSec: "swms" })} />);
    expect(screen.getByRole("link", { name: /Admin/ })).toHaveAttribute("href", "/dashboard/admin");
    expect(screen.getAllByRole("tab").map((t) => t.textContent)).toEqual(["SWMS", "Mechanical Compliance Certificate"]);
    expect(panel().getByText("Approved by Isaac Smith on Sat 3 Oct. Every SWMS is written from these steps.")).toBeInTheDocument();
  });

  it("opens on the one waiting for approval", () => {
    render(<TemplatesScreen {...props()} />);
    expect(screen.getByRole("tab", { name: "Mechanical Compliance Certificate" })).toHaveAttribute("aria-selected", "true");
  });

  it("shows only what changed since the last approval, marked, and the whole certificate at a press", async () => {
    render(<TemplatesScreen {...props({ initialSec: "certificate" })} />);
    const p = panel();
    expect(p.getByText("2 statements have changed since you approved the wording on Sat 3 Oct. Read them, then approve.")).toBeInTheDocument();
    expect(p.getByLabelText("Air balance report")).toHaveTextContent("Changed");
    expect(p.getByLabelText("Condensate drainage")).toHaveTextContent("New");
    expect(p.queryByLabelText("Refrigerant circuit, AS/NZS 5149.2")).toBeNull();
    expect(p.queryByText("I certify that:")).toBeNull();
    await userEvent.click(p.getByRole("checkbox", { name: "Show only what changed" }));
    /* the certificate top to bottom: the job, the equipment, the statements, the signature */
    expect(p.getByText("I certify that:")).toBeInTheDocument();
    expect(p.getByText("The equipment")).toBeInTheDocument();
    expect(p.getByText("Signed")).toBeInTheDocument();
    expect(p.getByLabelText("Refrigerant circuit, AS/NZS 5149.2")).toHaveTextContent("[The refrigerant and the charge added, per outdoor unit when they differ]");
    expect(p.getByRole("button", { name: "Approve the wording" })).toBeInTheDocument();
  });

  it("says who approves it, and offers no button, to someone who isn't the owner", () => {
    render(<TemplatesScreen {...props({ isOwner: false, initialSec: "certificate" })} />);
    expect(panel().getByText("Waiting for Isaac Smith to approve it. No certificate can be issued until then.")).toBeInTheDocument();
    expect(panel().queryByRole("button", { name: "Approve the wording" })).toBeNull();
  });
});
