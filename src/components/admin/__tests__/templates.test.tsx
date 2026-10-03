import { render, screen } from "@testing-library/react";
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

const BRAND = { name: "Coolbreeze Air", logoUrl: null, color: "#436cad", abn: null, phone: "02 9000 0000", email: null, website: null };
const PAPERS = { licences: ["Contractor licence 123"] };
const WARN = { text: "1 change to approve", tone: "warn" as const };

describe("the certificate", () => {
  it("is the certificate itself, on the business's letterhead, with every statement saying when it prints", () => {
    render(<CertificateTemplate {...props()} brand={BRAND} papers={PAPERS} status={WARN} />);
    expect(screen.getByRole("heading", { level: 1, name: "Mechanical Compliance Certificate" })).toBeInTheDocument();
    expect(screen.getByText("Coolbreeze Air")).toBeInTheDocument();
    expect(screen.getByText("I certify that:")).toBeInTheDocument();
    expect(screen.getByLabelText("Refrigerant circuit, AS/NZS 5149.2")).toHaveTextContent("[The refrigerant and the charge added, per outdoor unit when they differ]");
    expect(screen.getByLabelText("Refrigerant circuit, AS/NZS 5149.2")).toHaveTextContent("On every air conditioning certificate");
    expect(screen.getByLabelText("Ductwork, AS 4254")).toHaveTextContent("When it was installed");
    expect(screen.getByLabelText("Air balance report")).toHaveTextContent("Changed");
    expect(screen.getByLabelText("Condensate drainage")).toHaveTextContent("New");
    expect(screen.getByRole("button", { name: "Approve the wording" })).toBeInTheDocument();
  });

  it("shows only what changed at a tick", async () => {
    render(<CertificateTemplate {...props()} brand={BRAND} papers={PAPERS} status={WARN} />);
    await userEvent.click(screen.getByRole("checkbox", { name: "Only what changed" }));
    expect(screen.queryByLabelText("Refrigerant circuit, AS/NZS 5149.2")).toBeNull();
    expect(screen.getByLabelText("Air balance report")).toBeInTheDocument();
  });

  it("says who approves it, and offers no button, to someone who isn't the owner", () => {
    render(<CertificateTemplate {...props({ isOwner: false })} brand={BRAND} papers={PAPERS} status={WARN} />);
    expect(screen.getByText("Waiting for Isaac Smith to approve it. No certificate can be issued until then.")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Approve the wording" })).toBeNull();
  });
});

describe("the SWMS", () => {
  it("says who approved it", () => {
    render(<SwmsTemplate approved={{ by: "Isaac Smith", on: "Sat 3 Oct" }} isOwner ownerName="Isaac Smith" status={{ text: "Approved", tone: "on" }} />);
    expect(screen.getByText("Approved by Isaac Smith on Sat 3 Oct. Every SWMS is written from these steps and controls.")).toBeInTheDocument();
  });
});

describe("the templates written into HeyTiff", () => {
  it("draws the quote on the business's paper, with its notes and payment terms beside it", () => {
    render(<QuoteTemplate brand={BRAND} />);
    expect(screen.getByText("Air Conditioning Scope")).toBeInTheDocument();
    expect(screen.getByText("Coolbreeze Air")).toBeInTheDocument();
    expect(screen.getByText("Roof access")).toBeInTheDocument();
    expect(screen.getByText("Home, small job")).toBeInTheDocument();
  });

  it("draws the handover sheet with the checks the project checklist prints", () => {
    render(<HandoverTemplate brand={BRAND} />);
    expect(screen.getByText("Handover sheet", { selector: ".ho-kicker" })).toBeInTheDocument();
    expect(screen.getAllByText("Customer walkthrough done")).toHaveLength(2);
  });

  it("shows the documents email as it arrives, from the letter it is sent as", () => {
    render(<DocumentsEmailTemplate brand={BRAND} />);
    expect(screen.getByText("Coolbreeze Air via HeyTiff")).toBeInTheDocument();
    expect(screen.getAllByText("Documents for job [job number], [site address]")).toHaveLength(2);
    expect(screen.getByTitle("The email as it arrives").getAttribute("srcdoc")).toContain("Documents from Coolbreeze Air");
  });

  it("shows every new project's checklist by section", () => {
    render(<ProjectChecklistTemplate />);
    expect(screen.getByText("Approval & prep")).toBeInTheDocument();
    expect(screen.getByText("Pressure-tested & vacuumed")).toBeInTheDocument();
  });
});
