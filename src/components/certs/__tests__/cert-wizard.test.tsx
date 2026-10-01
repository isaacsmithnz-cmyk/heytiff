/* The certificate wizard on the job card, walked as the person issuing it
   uses it: the job's quote fills in the equipment, the address preselects
   the building and says so, nothing issues until the test figures are typed
   and the signer holds both licences, and an issue lands on the job with the
   buttons for what happens next. */

import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { CertWizardContext } from "@/app/actions/certificates";
import { readQuote, suggestBuilding } from "@/lib/certs/quote";
import { JOB_3326 } from "@/lib/certs/__tests__/fixtures/jobs";

const certWizardContext = jest.fn(async (): Promise<CertWizardContext | null> => null);
jest.mock("@/app/actions/certificates", () => ({
  certWizardContext: (...a: unknown[]) => certWizardContext(...(a as [])),
  certPrevious: async () => null,
  certificatePdfUrl: async () => "https://example.com/cert.pdf",
  readCertifierList: async () => ({ ok: false, error: "not in this test" }),
  saveMySignature: async () => ({ ok: true, svg: "<svg/>" }),
  addFanModel: async () => ({ ok: false, error: "not in this test" }),
}));
jest.mock("next/navigation", () => ({ useRouter: () => ({ refresh: jest.fn(), push: jest.fn() }) }));

import { CertWizard } from "../cert-wizard";

const licence = (number: string) => ({ name: "", number, expires: "2027-10-09", current: true });
const context = (over: Partial<CertWizardContext> = {}): CertWizardContext => ({
  job: {
    uuid: "job-1",
    number: "3326",
    address: "Lv 3 Suite 4/44-54 Example Road, Suburb, NSW, 2015",
    description: JOB_3326,
    companyUuid: "co-1",
    clientName: "Helix Venture Studio Pty Ltd",
    contactName: "Lisa Harper",
    completedOn: "2026-09-25",
  },
  reading: readQuote(JOB_3326),
  building: suggestBuilding("Lv 3 Suite 4/44-54 Example Road"),
  today: "2026-10-01",
  viewerStaffId: "isaac",
  signatory: { staffId: "isaac", name: "Isaac Smith", arc: licence("L118650"), contractor: licence("315890C"), signatureSvg: "<svg/>" },
  approved: true,
  canApprove: true,
  ownerName: "Isaac Smith",
  fanModels: [],
  certifiers: [],
  usualCertifier: null,
  existing: [],
  files: [],
  ...over,
});

const onClose = jest.fn();
const onIssued = jest.fn();
const onEmail = jest.fn();
const onSendToSm8 = jest.fn();
const onOpen = jest.fn();
const open = (canSend = true) =>
  render(<CertWizard jobUuid="job-1" onClose={onClose} onIssued={onIssued} onEmail={onEmail} onSendToSm8={onSendToSm8} onOpen={onOpen} canSend={canSend} />);
const tab = (name: string) => userEvent.click(screen.getByRole("tab", { name }));
const panel = (key: string) => within(document.getElementById(`czsec-${key}`) as HTMLElement);

beforeEach(() => {
  jest.clearAllMocks();
  certWizardContext.mockImplementation(async () => context());
});

describe("what the job already says", () => {
  it("preselects the building from the address and says so, and dates it from ServiceM8", async () => {
    open();
    await screen.findByRole("tab", { name: "What it covers" });
    const covers = panel("covers");
    expect(covers.getByRole("checkbox", { name: /Air conditioning/ })).toBeChecked();
    expect(covers.getByRole("radio", { name: /Office/ })).toBeChecked();
    expect(covers.getByText("Class 5, From the address")).toBeInTheDocument();
    expect(covers.getByRole("button", { name: "Works completed" })).toHaveTextContent("25/09/2026");
    expect(covers.getByText("From ServiceM8")).toBeInTheDocument();
  });

  it("fills the equipment in from the quote, and the condensate pump", async () => {
    open();
    await screen.findByRole("tab", { name: "Equipment" });
    await tab("Equipment");
    const eq = panel("equipment");
    expect(eq.getByDisplayValue("MUZ-AP42VGD2-A2")).toBeInTheDocument();
    expect(eq.getByDisplayValue("MSZ-AP42VGKD2-A2")).toBeInTheDocument();
    expect(eq.getByRole("checkbox", { name: /A condensate pump/ })).toBeChecked();
    expect(eq.getByRole("checkbox", { name: /Ductwork/ })).not.toBeChecked();
  });
});

describe("issuing", () => {
  it("waits for the test figures, then issues and offers what happens next", async () => {
    const fetchMock = jest.fn(async () => ({
      json: async () => ({ ok: true, versionId: "v-1", version: 1, documentId: "d-1", fileName: "Air conditioning certificate – Lv 3 – job 3326.pdf" }),
    }));
    global.fetch = fetchMock as unknown as typeof fetch;
    open();
    await screen.findByRole("tab", { name: "Sign" });
    await tab("Sign");
    expect(screen.getByRole("button", { name: "Issue the certificate" })).toBeDisabled();
    expect(panel("sign").getByRole("button", { name: /Enter the test pressure/ })).toBeInTheDocument();

    /* the quote names the unit but not the room it went in */
    expect(panel("sign").getByRole("button", { name: /Say where indoor unit 1/ })).toBeInTheDocument();
    await tab("Equipment");
    await userEvent.type(panel("equipment").getByLabelText("Room"), "Office");

    await tab("Checks");
    const checks = panel("checks");
    await userEvent.type(checks.getByLabelText("Test pressure, kPa"), "4150");
    await userEvent.type(checks.getByLabelText("Held, minutes"), "30");
    await userEvent.type(checks.getByLabelText("Vacuum, microns"), "350");
    await userEvent.type(checks.getByLabelText("Added, kg"), "0");
    await tab("Sign");
    const issue = screen.getByRole("button", { name: "Issue the certificate" });
    await waitFor(() => expect(issue).toBeEnabled());
    await userEvent.click(issue);

    await screen.findByText("The certificate is on the job");
    expect(fetchMock).toHaveBeenCalledWith("/api/certificates/issue", expect.objectContaining({ method: "POST" }));
    expect(onIssued).toHaveBeenCalledWith({ versionId: "v-1", documentId: "d-1", fileName: expect.any(String) });
    await userEvent.click(screen.getByRole("button", { name: "Email to the builder" }));
    expect(onEmail).toHaveBeenCalledWith("d-1");
    await userEvent.click(screen.getByRole("button", { name: "Send to ServiceM8" }));
    expect(onSendToSm8).toHaveBeenCalledWith("d-1", expect.any(String));
    await userEvent.click(screen.getByRole("button", { name: "Open the certificate" }));
    expect(onOpen).toHaveBeenCalledWith("v-1");
  });

  it("offers someone who may issue but not send the PDF only", async () => {
    global.fetch = jest.fn(async () => ({
      json: async () => ({ ok: true, versionId: "v-1", version: 1, documentId: "d-1", fileName: "Air conditioning certificate.pdf" }),
    })) as unknown as typeof fetch;
    certWizardContext.mockImplementation(async () =>
      context({
        reading: { ...readQuote(JOB_3326), systems: readQuote(JOB_3326).systems.map((x) => ({ ...x, indoors: x.indoors.map((r) => ({ ...r, location: "Office" })), test: { pressureKpa: 4150, holdMinutes: 30, vacuumMicrons: 350, manufacturerMicrons: null, refrigerant: "R32", addedKg: 0 } })) },
      })
    );
    open(false);
    await screen.findByRole("tab", { name: "Sign" });
    await tab("Sign");
    const issue = screen.getByRole("button", { name: "Issue the certificate" });
    await waitFor(() => expect(issue).toBeEnabled());
    await userEvent.click(issue);
    await screen.findByText("The certificate is on the job");
    expect(screen.queryByRole("button", { name: "Email to the builder" })).toBeNull();
    expect(screen.queryByRole("button", { name: "Send to ServiceM8" })).toBeNull();
    expect(screen.getByRole("button", { name: "Download PDF" })).toBeInTheDocument();
  });

  it("can't be issued by someone without both licences current, and says why", async () => {
    certWizardContext.mockImplementation(async () =>
      context({ signatory: { staffId: "dane", name: "Dane", arc: licence("L1"), contractor: null, signatureSvg: null } })
    );
    open();
    await screen.findByRole("tab", { name: "Sign" });
    await tab("Sign");
    expect(panel("sign").getByText(/Anyone with their own current ARC licence and contractor licence can sign/)).toBeInTheDocument();
    expect(panel("sign").getByText("Not on your staff card")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Issue the certificate" })).toBeDisabled();
  });

  it("names a licence with no expiry date, which can't sign until one is added", async () => {
    certWizardContext.mockImplementation(async () =>
      context({ signatory: { staffId: "isaac", name: "Isaac Smith", arc: { name: "", number: "L118650", expires: null, current: false }, contractor: licence("315890C"), signatureSvg: "<svg/>" } })
    );
    open();
    await screen.findByRole("tab", { name: "Sign" });
    await tab("Sign");
    expect(panel("sign").getByText("No expiry date on file")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Issue the certificate" })).toBeDisabled();
  });
});
