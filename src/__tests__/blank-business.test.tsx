/* A BUSINESS THAT HAS SET UP NOTHING — no name, no logo, no state, no
   licences on file, no templates of its own — can still read every template,
   write its own, and fill in a certificate. Nothing it is shown or sends
   carries another business's details; where it has none, it gets the
   standard wording or is asked. (Isaac, 2026-10-04: "an entirely new org can
   create a template and cert with a blank org. Nothing hard coded".) */

import { render, screen } from "@testing-library/react";
import { renderToStaticMarkup } from "react-dom/server";
import { NO_BRAND } from "@/lib/org/brand";
import { standardTemplates, templatesFrom, fillEmail, STANDARD_EMAIL } from "@/lib/templates/settings";
import { QuoteTemplate, HandoverTemplate, DocumentsEmailTemplate, ProjectChecklistTemplate } from "@/components/admin/fixed-templates";
import { CertificateTemplate } from "@/components/admin/approved-templates";
import { CertificatePaper } from "@/components/certs/certificate-paper";
import { DEFAULT_CERT_ANSWERS, buildCertificate, certProblemList, type CertAnswers } from "@/lib/certs/mechanical";
import { readQuote } from "@/lib/certs/quote";
import { jobBlock, SYSTEM_PROMPT } from "@/lib/quotes/proposal-writer";

jest.mock("@/app/actions/certificates", () => ({ approveCertWording: jest.fn() }));
jest.mock("@/app/actions/swms", () => ({ approveSwmsLibrary: jest.fn() }));
jest.mock("@/app/actions/templates", () => ({ saveTemplate: jest.fn(), resetTemplate: jest.fn() }));
jest.mock("next/navigation", () => ({ useRouter: () => ({ refresh: jest.fn() }) }));
jest.mock("@/lib/supabase-server", () => ({ supabaseAdmin: {} }));

/* what the first business on HeyTiff is called, and anything that is its own */
const ANOTHER_BUSINESS = /Diamond|DAS Pty|Isaac|L118650|315890C|14 603 285 409|McEvoy/;

const blank = { brand: NO_BRAND, templates: templatesFrom([]), isOwner: true };

describe("a business that has set up nothing", () => {
  it("reads every template it can change, in the standard wording, with its editors", () => {
    for (const Page of [QuoteTemplate, HandoverTemplate, DocumentsEmailTemplate]) {
      const { container, unmount } = render(<Page {...blank} />);
      expect(container.textContent).not.toMatch(ANOTHER_BUSINESS);
      expect(screen.getAllByRole("button", { name: "Save" }).length).toBeGreaterThan(0);
      unmount();
    }
    const { container } = render(<ProjectChecklistTemplate templates={blank.templates} isOwner />);
    expect(container.textContent).not.toMatch(ANOTHER_BUSINESS);
  });

  it("starts from the standard wording, and its email names no business it hasn't got", () => {
    expect(templatesFrom([])).toEqual(standardTemplates());
    const message = fillEmail(STANDARD_EMAIL.message, { jobNumber: "12", siteAddress: "1 Main St", yourName: "Sam", business: null });
    expect(message).toBe("Hi,\n\nPlease find our documents for this job attached.\n\nKind regards,\nSam");
  });

  it("reads the certificate's template, waiting for its own owner's approval", () => {
    const { container } = render(
      <CertificateTemplate
        isOwner
        ownerName={null}
        wording={{ approved: null, changed: null, lastApprovedOn: null, earlier: [] }}
        brand={NO_BRAND}
        papers={{ licences: [] }}
        status={{ text: "Waiting for your approval", tone: "warn" }}
      />
    );
    expect(container.textContent).not.toMatch(ANOTHER_BUSINESS);
    expect(screen.getByRole("button", { name: "Approve the wording" })).toBeInTheDocument();
  });

  it("fills in a certificate: asked for its state when nothing says it, and printed with no letterhead of anyone else's", () => {
    const answers: CertAnswers = {
      ...DEFAULT_CERT_ANSWERS,
      covers: { ac: true, vent: false },
      building: "house",
      completedOn: "2026-10-01",
      systems: readQuote("Supply and install 1 x 7.1kW Daikin split system FTXM71W / RXM71W in the living room. R32.").systems,
    };
    const facts = { today: "2026-10-04", approved: true, hasSignature: true, arcCurrent: true, contractorCurrent: true };
    /* no state on the address and none in its settings: asked, never assumed */
    expect(certProblemList(answers, facts).map((p) => p.text)).toContain("Say which state the job is in.");
    /* a Victorian job gets the plain wording, not NSW's */
    const content = buildCertificate({ ...answers, state: "VIC" });
    const html = renderToStaticMarkup(
      <CertificatePaper
        content={content}
        brand={NO_BRAND}
        papers={{ licences: [] }}
        job={{ number: "12", builder: null, address: "1 Main St\nRichmond VIC 3121" }}
        signOff={{ name: "Sam Lee", signedOn: "2026-10-04", signatureSvg: "<svg/>", arc: null, contractor: null }}
        version={1}
      />
    );
    expect(html).not.toMatch(ANOTHER_BUSINESS);
    expect(html).not.toContain("Construction Certificate");
  });

  it("is never named in Tiff's instructions, and is handed to Tiff as no business at all", () => {
    expect(SYSTEM_PROMPT).not.toMatch(ANOTHER_BUSINESS);
    const job = {
      business: null,
      noteLibrary: blank.templates.quoteNotes,
      paymentTerms: blank.templates.paymentTerms,
      cardId: "j",
      jobNumber: "12",
      address: "1 Main St",
      clientName: null,
      contactFirstName: null,
      category: null,
      scope: null,
      notes: [],
    };
    expect(jobBlock(job)).not.toContain("The business writing this quote");
  });
});
