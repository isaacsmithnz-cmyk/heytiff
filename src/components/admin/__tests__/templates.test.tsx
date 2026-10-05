import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { TemplatesList } from "../templates-list";
import { CertificateTemplate, SwmsTemplate, type ApprovalProps } from "../approved-templates";
import { DocumentsEmailTemplate, HandoverTemplate, ProjectChecklistTemplate, QuoteTemplate } from "../fixed-templates";
import { templateFor } from "../templates-catalogue";
import { standardTemplates } from "@/lib/templates/settings";

jest.mock("@/app/actions/certificates", () => ({ approveCertWording: jest.fn(async () => ({ ok: true })) }));
jest.mock("@/app/actions/swms", () => ({ approveSwmsLibrary: jest.fn(async () => ({ ok: true })) }));
const refresh = jest.fn();
jest.mock("next/navigation", () => ({ useRouter: () => ({ refresh }) }));
const saveTemplate = jest.fn(async (..._a: unknown[]) => ({ ok: true }));
const resetTemplate = jest.fn(async (..._a: unknown[]) => ({ ok: true }));
jest.mock("@/app/actions/templates", () => ({
  saveTemplate: (...a: unknown[]) => saveTemplate(...a),
  resetTemplate: (...a: unknown[]) => resetTemplate(...a),
}));

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
    expect(document.querySelector(".cer h1")).toHaveTextContent("Mechanical Compliance Certificate");
    expect(screen.getAllByText("[Make]").length).toBeGreaterThan(0);
    expect(screen.getByText("Coolbreeze Air")).toBeInTheDocument();
    expect(screen.getByText("I certify that:")).toBeInTheDocument();
    expect(screen.getByLabelText("Refrigerant circuit, AS/NZS 5149.2")).toHaveTextContent("[the refrigerant]");
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
    render(<QuoteTemplate brand={BRAND} templates={standardTemplates()} isOwner={false} />);
    expect(screen.getByText("Air Conditioning Scope")).toBeInTheDocument();
    expect(screen.getByText("Coolbreeze Air")).toBeInTheDocument();
    expect(screen.getByText("Roof access")).toBeInTheDocument();
    expect(screen.getByText("Home, small job")).toBeInTheDocument();
  });

  it("draws the handover sheet with the checks the project checklist prints", () => {
    render(<HandoverTemplate brand={BRAND} templates={standardTemplates()} isOwner={false} />);
    expect(screen.getByText("Handover sheet", { selector: ".ho-kicker" })).toBeInTheDocument();
    expect(screen.getAllByText("Customer walkthrough done")).toHaveLength(2);
  });

  it("shows the documents email as it arrives, from the letter it is sent as", () => {
    render(<DocumentsEmailTemplate brand={BRAND} templates={standardTemplates()} isOwner={false} />);
    expect(screen.getByText("Coolbreeze Air via HeyTiff")).toBeInTheDocument();
    expect(screen.getAllByText("Documents for job [job number], [site address]")).toHaveLength(2);
    expect(screen.getByTitle("The email as it arrives").getAttribute("srcdoc")).toContain("Documents from Coolbreeze Air");
  });

  it("shows every new project's checklist by section", () => {
    render(<ProjectChecklistTemplate templates={standardTemplates()} isOwner={false} />);
    expect(screen.getByText("Approval & prep")).toBeInTheDocument();
    expect(screen.getByText("Pressure-tested & vacuumed")).toBeInTheDocument();
  });
});

describe("the owner changes the business's own templates beside the document", () => {
  beforeEach(() => jest.clearAllMocks());

  it("puts a note on every quote, and the paper shows it", async () => {
    render(<QuoteTemplate brand={BRAND} templates={standardTemplates()} isOwner />);
    await userEvent.click(screen.getByRole("checkbox", { name: "Roof access on every quote" }));
    await userEvent.click(screen.getAllByRole("button", { name: "Save" })[0]);
    const [key, notes] = saveTemplate.mock.calls[0] as [string, { key: string; always: boolean }[]];
    expect(key).toBe("quote_notes");
    expect(notes.find((n) => n.key === "roof_access")?.always).toBe(true);
    expect(refresh).toHaveBeenCalled();
  });

  it("adds a note of the business's own", async () => {
    render(<QuoteTemplate brand={BRAND} templates={standardTemplates()} isOwner />);
    await userEvent.click(screen.getByRole("button", { name: "Add a note" }));
    await userEvent.type(screen.getByLabelText("Heading"), "Warranty");
    await userEvent.type(screen.getByLabelText("The words, a line each"), "Five years on our workmanship.");
    await userEvent.click(screen.getByRole("button", { name: "Done" }));
    await userEvent.click(screen.getAllByRole("button", { name: "Save" })[0]);
    const notes = saveTemplate.mock.calls[0][1] as { heading: string; lines: string[] }[];
    expect(notes.at(-1)).toMatchObject({ heading: "Warranty", lines: ["Five years on our workmanship."] });
  });

  it("won't save home payment terms that don't add up, and says why", async () => {
    render(<QuoteTemplate brand={BRAND} templates={standardTemplates()} isOwner />);
    const pct = screen.getByLabelText("Stage 1 percent");
    await userEvent.clear(pct);
    await userEvent.type(pct, "20");
    await userEvent.click(screen.getAllByRole("button", { name: "Save" })[1]);
    expect(saveTemplate).not.toHaveBeenCalled();
    expect(screen.getByText("Home, small job: the stages add up to 110%, not 100%.")).toBeInTheDocument();
  });

  it("takes any deposit, and shows the suggested one beside it", async () => {
    render(<QuoteTemplate brand={BRAND} templates={standardTemplates()} isOwner />);
    expect(screen.queryByText("Suggested 10%")).toBeNull();
    const deposit = screen.getByLabelText("Stage 1 percent");
    await userEvent.clear(deposit);
    await userEvent.type(deposit, "30");
    const balance = screen.getByLabelText("Stage 2 percent");
    await userEvent.clear(balance);
    await userEvent.type(balance, "70");
    expect(screen.getByText("Suggested 10%")).toBeInTheDocument();
    await userEvent.click(screen.getAllByRole("button", { name: "Save" })[1]);
    expect(saveTemplate).toHaveBeenCalled();
  });

  it("adds a handover check", async () => {
    render(<HandoverTemplate brand={BRAND} templates={standardTemplates()} isOwner />);
    await userEvent.type(screen.getByLabelText("Add to Handover"), "Remote set to the customer's times{Enter}");
    await userEvent.click(screen.getByRole("button", { name: "Save" }));
    const items = saveTemplate.mock.calls[0][1] as { section: string; label: string }[];
    expect(items.filter((i) => i.section === "Handover").at(-1)).toEqual({ section: "Handover", label: "Remote set to the customer's times" });
  });

  it("rewords the documents email, and goes back to the standard wording once changed", async () => {
    const t = standardTemplates();
    render(<DocumentsEmailTemplate brand={BRAND} templates={{ ...t, changed: { documents_email: "2026-10-03" } }} isOwner />);
    const subject = screen.getByLabelText("Subject");
    await userEvent.clear(subject);
    await userEvent.type(subject, "Paperwork for job [[job number]");
    await userEvent.click(screen.getByRole("button", { name: "Save" }));
    expect(saveTemplate).toHaveBeenCalledWith("documents_email", { subject: "Paperwork for job [job number]", message: t.documentsEmail.message });
    await userEvent.click(screen.getByRole("button", { name: "Back to the standard wording" }));
    expect(resetTemplate).toHaveBeenCalledWith("documents_email");
  });

  it("offers no editors to someone who isn't the owner", () => {
    render(<QuoteTemplate brand={BRAND} templates={standardTemplates()} isOwner={false} />);
    expect(screen.queryByRole("button", { name: "Save" })).toBeNull();
  });
});
