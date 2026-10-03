import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { TemplatesList } from "../templates-list";
import { CertificateTemplate, SwmsTemplate, type ApprovalProps } from "../approved-templates";
import { DocumentsEmailTemplate, HandoverTemplate, ProjectChecklistTemplate, QuoteTemplate } from "../fixed-templates";
import { templateFor } from "../templates-catalogue";

jest.mock("@/app/actions/certificates", () => ({ approveCertWording: jest.fn(async () => ({ ok: true })) }));
jest.mock("@/app/actions/swms", () => ({ approveSwmsLibrary: jest.fn(async () => ({ ok: true })) }));
jest.mock("next/navigation", () => ({ useRouter: () => ({ refresh: jest.fn() }) }));

const props = (over: Partial<ApprovalProps> = {}): ApprovalProps => ({
  isOwner: true,
  ownerName: "Isaac Smith",
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

describe("the list", () => {
  it("groups every template by who receives it, each a link, and says which wait for approval", () => {
    render(<TemplatesList status={{ certificate: { text: "Waiting for your approval", tone: "warn" }, swms: { text: "Approved", tone: "on" } }} />);
    expect(screen.getByRole("link", { name: /Admin/ })).toHaveAttribute("href", "/dashboard/admin");
    expect(screen.getByText("Customers")).toBeInTheDocument();
    expect(screen.getByText("Builders and certifiers")).toBeInTheDocument();
    expect(screen.getByText("Your team")).toBeInTheDocument();
    const hrefs = screen.getAllByRole("link").map((a) => a.getAttribute("href"));
    expect(hrefs).toEqual([
      "/dashboard/admin",
      "/dashboard/admin/templates/quote",
      "/dashboard/admin/templates/handover",
      "/dashboard/admin/templates/documents-email",
      "/dashboard/admin/templates/certificate",
      "/dashboard/admin/templates/swms",
      "/dashboard/admin/templates/project-checklist",
    ]);
    expect(screen.getByRole("link", { name: /Mechanical Compliance Certificate/ })).toHaveTextContent("Waiting for your approval");
    expect(screen.getByRole("link", { name: /SWMS/ })).toHaveTextContent("Approved");
  });

  it("knows a template by its key, and nothing else", () => {
    expect(templateFor("swms")?.title).toBe("SWMS");
    expect(templateFor("fans")).toBeNull();
  });
});

describe("the certificate", () => {
  it("shows only what changed since the last approval, marked, and the whole certificate at a press", async () => {
    render(<CertificateTemplate {...props()} />);
    expect(screen.getByText("2 statements have changed since you approved the wording on Sat 3 Oct. Read them, then approve.")).toBeInTheDocument();
    expect(screen.getByLabelText("Air balance report")).toHaveTextContent("Changed");
    expect(screen.getByLabelText("Condensate drainage")).toHaveTextContent("New");
    expect(screen.queryByLabelText("Refrigerant circuit, AS/NZS 5149.2")).toBeNull();
    expect(screen.queryByText("I certify that:")).toBeNull();
    await userEvent.click(screen.getByRole("checkbox", { name: "Show only what changed" }));
    /* the certificate top to bottom: the job, the equipment, the statements, the signature */
    expect(screen.getByText("I certify that:")).toBeInTheDocument();
    expect(screen.getByText("The equipment")).toBeInTheDocument();
    expect(screen.getByText("Signed")).toBeInTheDocument();
    expect(screen.getByLabelText("Refrigerant circuit, AS/NZS 5149.2")).toHaveTextContent("[The refrigerant and the charge added, per outdoor unit when they differ]");
    expect(screen.getByRole("button", { name: "Approve the wording" })).toBeInTheDocument();
  });

  it("says who approves it, and offers no button, to someone who isn't the owner", () => {
    render(<CertificateTemplate {...props({ isOwner: false })} />);
    expect(screen.getByText("Waiting for Isaac Smith to approve it. No certificate can be issued until then.")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Approve the wording" })).toBeNull();
  });
});

describe("the SWMS", () => {
  it("says who approved it", () => {
    render(<SwmsTemplate approved={{ by: "Isaac Smith", on: "Sat 3 Oct" }} isOwner ownerName="Isaac Smith" />);
    expect(screen.getByText("Approved by Isaac Smith on Sat 3 Oct. Every SWMS is written from these steps.")).toBeInTheDocument();
  });
});

describe("the templates written into HeyTiff", () => {
  it("shows the quote's notes, payment terms and site checklist from the data the quote is drawn from", () => {
    render(<QuoteTemplate />);
    expect(screen.getByText(/^Roof access: Roof tiles are lifted/)).toBeInTheDocument();
    expect(screen.getByText("Payment terms: Home, small job")).toBeInTheDocument();
    expect(screen.getAllByText("10%: Deposit, on accepting")).toHaveLength(2);
    expect(screen.getByText("Site checklist: Unit")).toBeInTheDocument();
  });

  it("shows the handover checks the project checklist prints", () => {
    render(<HandoverTemplate />);
    const checks = screen.getByText("Handover checks").closest(".sws-grp") as HTMLElement;
    expect(within(checks).getByText("Customer walkthrough done")).toBeInTheDocument();
  });

  it("shows the documents email as it starts", () => {
    render(<DocumentsEmailTemplate />);
    expect(screen.getByText("Documents for job [job number], [site address]")).toBeInTheDocument();
    expect(screen.getByText("Please find our documents for this job attached.")).toBeInTheDocument();
  });

  it("shows every new project's checklist by section", () => {
    render(<ProjectChecklistTemplate />);
    expect(screen.getByText("Approval & prep")).toBeInTheDocument();
    expect(screen.getByText("Pressure-tested & vacuumed")).toBeInTheDocument();
  });
});
