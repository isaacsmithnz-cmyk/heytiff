/* The certificate wizard on the job card, walked as the person issuing it
   uses it: the job's quote fills in the equipment, the address only hints at
   the building and the person picks it, what it was asked to cover comes in
   from ServiceM8, an upload or pasted text, from whoever asked, nothing issues until the test
   figures are typed and the signer holds both licences, and an issue lands
   on the job with the buttons for what happens next. */

import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { CertListFile, CertWizardContext, ReadListResult } from "@/app/actions/certificates";
import { readQuote, suggestBuilding } from "@/lib/certs/quote";
import { JOB_1383, JOB_2933, JOB_3326 } from "@/lib/certs/__tests__/fixtures/jobs";

const certWizardContext = jest.fn(async (): Promise<CertWizardContext | null> => null);
const readCertifierList = jest.fn(async (..._a: unknown[]): Promise<ReadListResult> => ({ ok: false, error: "not in this test" }));
const readCertifierEmail = jest.fn(async (..._a: unknown[]): Promise<ReadListResult> => ({ ok: false, error: "not in this test" }));
const certListFiles = jest.fn(async (..._a: unknown[]): Promise<CertListFile[] | null> => null);
const cacheJobFiles = jest.fn(async (..._a: unknown[]) => ({ ok: true, cached: 1, remaining: 0, media: null, note: null }));
jest.mock("@/app/actions/certificates", () => ({
  certWizardContext: (...a: unknown[]) => certWizardContext(...(a as [])),
  certPrevious: async () => null,
  certificatePdfUrl: async () => "https://example.com/cert.pdf",
  readCertifierList: (...a: unknown[]) => readCertifierList(...a),
  readCertifierEmail: (...a: unknown[]) => readCertifierEmail(...a),
  certListFiles: (...a: unknown[]) => certListFiles(...a),
  saveMySignature: async () => ({ ok: true, svg: "<svg/>" }),
  addFanModel: async () => ({ ok: false, error: "not in this test" }),
}));
jest.mock("@/app/actions/workboard-media", () => ({ cacheJobFiles: (...a: unknown[]) => cacheJobFiles(...a) }));
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
    completedOn: "2026-09-25",
  },
  reading: readQuote(JOB_3326),
  equipmentFrom: "description",
  quoteToMark: 0,
  building: suggestBuilding("Lv 3 Suite 4/44-54 Example Road"),
  today: "2026-10-01",
  viewerStaffId: "isaac",
  signatory: { staffId: "isaac", name: "Isaac Smith", arc: licence("L118650"), contractor: licence("315890C"), signatureSvg: "<svg/>" },
  approved: true,
  canApprove: true,
  ownerName: "Isaac Smith",
  fanModels: [],
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
  it("hints at the building from the address but makes the person pick it, and dates it from ServiceM8", async () => {
    open();
    await screen.findByRole("tab", { name: "What it covers" });
    const covers = panel("covers");
    expect(covers.getByRole("checkbox", { name: /Air conditioning/ })).toBeChecked();
    for (const r of covers.getAllByRole("radio")) expect(r).not.toBeChecked();
    expect(covers.getByText("Class 5, The address suggests this")).toBeInTheDocument();
    expect(covers.getByText("The address has a level or suite. Pick one to confirm.")).toBeInTheDocument();
    await tab("Sign");
    expect(panel("sign").getByRole("button", { name: "Choose what kind of building it is." })).toBeInTheDocument();
    await tab("What it covers");
    await userEvent.click(covers.getByRole("radio", { name: /Office/ }));
    expect(covers.getByRole("radio", { name: /Office/ })).toBeChecked();
    expect(covers.queryByText(/The address suggests this/)).toBeNull();
    expect(panel("sign").queryByRole("button", { name: "Choose what kind of building it is." })).toBeNull();
    expect(covers.getByRole("button", { name: "Works completed" })).toHaveTextContent("25/09/2026");
    expect(covers.getByText("From ServiceM8")).toBeInTheDocument();
  });

  it("fills the equipment in from the quote, with no condensate pump question", async () => {
    open();
    await screen.findByRole("tab", { name: "Equipment" });
    await tab("Equipment");
    const eq = panel("equipment");
    expect(eq.getByDisplayValue("MUZ-AP42VGD2-A2")).toBeInTheDocument();
    expect(eq.getByDisplayValue("MSZ-AP42VGKD2-A2")).toBeInTheDocument();
    expect(eq.queryByRole("checkbox", { name: /A condensate pump/ })).toBeNull();
    expect(eq.getByRole("checkbox", { name: /Ductwork/ })).not.toBeChecked();
  });
});

describe("what the quote says about itself", () => {
  const job1383 = () =>
    context({
      job: { uuid: "job-1", number: "1383", address: "74/10 Etham Avenue\nDarling Point NSW 2027", description: JOB_1383, companyUuid: "co-1", clientName: "Reed Developments", completedOn: "2026-08-04" },
      reading: readQuote(JOB_1383),
      building: suggestBuilding("74/10 Etham Avenue"),
    });

  it("says when the quote's stated total and its rows don't agree, and updates as rows change", async () => {
    certWizardContext.mockImplementation(async () => job1383());
    open();
    await screen.findByRole("tab", { name: "Equipment" });
    await tab("Equipment");
    const eq = panel("equipment");
    expect(eq.getByText(/The quote says 29.0 kW connected, but these rows add to 19.8 kW/)).toBeInTheDocument();
    const living = eq.getAllByLabelText("kW each")[0];
    await userEvent.clear(living);
    await userEvent.type(living, "18.2");
    expect(eq.queryByText(/The quote says/)).toBeNull();
  });
});

describe("where the equipment came from", () => {
  it("says it came from the accepted quote when it did", async () => {
    certWizardContext.mockImplementation(async () => context({ equipmentFrom: "quote" }));
    open();
    await screen.findByRole("tab", { name: "Equipment" });
    await tab("Equipment");
    expect(panel("equipment").getByText("Filled in from the accepted quote. Check every row.")).toBeInTheDocument();
  });

  it("says to mark the accepted option when the quote has several and none is marked", async () => {
    certWizardContext.mockImplementation(async () => context({ quoteToMark: 2 }));
    open();
    await screen.findByRole("tab", { name: "Equipment" });
    await tab("Equipment");
    expect(panel("equipment").getByText(/This job's quote has 2 options and none is marked accepted/)).toBeInTheDocument();
    expect(panel("equipment").getByText("Filled in from the job's description. Check every row against what was installed.")).toBeInTheDocument();
  });
});

describe("issuing", () => {
  it("waits for the refrigerant charge and the room, then issues and offers what happens next", async () => {
    const fetchMock = jest.fn(async () => ({
      json: async () => ({ ok: true, versionId: "v-1", version: 1, documentId: "d-1", fileName: "Air conditioning certificate – Lv 3 – job 3326.pdf" }),
    }));
    global.fetch = fetchMock as unknown as typeof fetch;
    open();
    await screen.findByRole("tab", { name: "Sign" });
    await tab("Sign");
    expect(screen.getByRole("button", { name: "Issue the certificate" })).toBeDisabled();
    expect(panel("sign").getByRole("button", { name: /Enter the refrigerant added/ })).toBeInTheDocument();
    expect(panel("sign").getByRole("button", { name: /Confirm every unit installed is listed/ })).toBeInTheDocument();
    expect(panel("sign").queryByRole("button", { name: /test pressure|vacuum/i })).toBeNull();

    /* the quote names the unit but not the room it went in */
    expect(panel("sign").getByRole("button", { name: /Say where indoor unit 1/ })).toBeInTheDocument();
    await tab("What it covers");
    await userEvent.click(panel("covers").getByRole("radio", { name: /Office/ }));
    await tab("Equipment");
    await userEvent.type(panel("equipment").getByLabelText("Room"), "Office");
    await userEvent.click(panel("equipment").getByRole("checkbox", { name: /Every unit installed is listed/ }));

    await tab("Checks");
    const checks = panel("checks");
    expect(checks.queryByLabelText(/Test pressure|Vacuum/)).toBeNull();
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
    await userEvent.click(panel("covers").getByRole("radio", { name: /Office/ }));
    await tab("Equipment");
    await userEvent.click(panel("equipment").getByRole("checkbox", { name: /Every unit installed is listed/ }));
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

describe("what you've been asked to cover", () => {
  const reading = (requirements: { text: string; clause: "refrigerant" | null; notOurs: boolean }[]): ReadListResult => ({
    ok: true,
    requirements,
  });
  const openStep = async () => {
    open();
    await screen.findByRole("tab", { name: "Requirements" });
    await tab("Requirements");
    return panel("list");
  };

  it("is a text box: what is typed is read, and nothing about a certifier is asked or kept", async () => {
    readCertifierEmail.mockImplementation(async () => reading([{ text: "Exhaust fans to AS 1668.2", clause: null, notOurs: false }]));
    const list = await openStep();
    const read = list.getByRole("button", { name: "Read it" });
    expect(read).toBeDisabled();
    await userEvent.type(list.getByLabelText("What you've been asked to cover"), "Hi Isaac, please certify the exhaust fans to AS 1668.2");
    expect(list.getByText(/Not read yet/)).toBeInTheDocument();
    await userEvent.click(read);
    expect(readCertifierEmail).toHaveBeenCalledWith("job-1", "Hi Isaac, please certify the exhaust fans to AS 1668.2");
    expect(readCertifierList).not.toHaveBeenCalled();
    expect(await list.findByDisplayValue("Exhaust fans to AS 1668.2")).toBeInTheDocument();
    expect(list.queryByText(/Not read yet/)).toBeNull();
    expect(read).toBeDisabled();
    expect(list.queryByLabelText("Certifier")).toBeNull();
    await tab("Sign");
    expect(panel("sign").queryByText(/certifier/i)).toBeNull();
  });

  it("reads a file filed on the job in ServiceM8 along with the text, both at once", async () => {
    certWizardContext.mockImplementation(async () =>
      context({ files: [{ id: "f-sm8", name: "OC List of Requirements.pdf", fromSm8: true }, { id: "f-ours", name: "Photo of list.jpg", fromSm8: false }] })
    );
    readCertifierList.mockImplementation(async () => reading([{ text: "AC installed to AS/NZS 5149", clause: "refrigerant", notOurs: false }]));
    readCertifierEmail.mockImplementation(async () => reading([{ text: "Fans to AS 1668.2", clause: null, notOurs: false }]));
    const list = await openStep();
    const pick = list.getByRole("combobox", { name: "A file to read" });
    expect(within(pick).getByRole("group", { name: "From ServiceM8" })).toHaveTextContent("OC List of Requirements.pdf");
    expect(within(pick).getByRole("group", { name: "Uploaded here" })).toHaveTextContent("Photo of list.jpg");
    await userEvent.selectOptions(pick, "f-sm8");
    await userEvent.type(list.getByLabelText("What you've been asked to cover"), "Fans to AS 1668.2 too please");
    await userEvent.click(list.getByRole("button", { name: "Read it" }));
    expect(readCertifierList).toHaveBeenCalledWith("job-1", "f-sm8");
    expect(await list.findByDisplayValue("AC installed to AS/NZS 5149")).toBeInTheDocument();
    expect(list.getByDisplayValue("Fans to AS 1668.2")).toBeInTheDocument();
  });

  it("says when Tiff found nothing to cover", async () => {
    readCertifierEmail.mockImplementation(async () => reading([]));
    const list = await openStep();
    await userEvent.type(list.getByLabelText("What you've been asked to cover"), "Can you send the cert please");
    await userEvent.click(list.getByRole("button", { name: "Read it" }));
    expect(await list.findByText("Tiff found nothing in it for this certificate to cover.")).toBeInTheDocument();
  });

  it("looks again for a file filed in ServiceM8 a minute ago", async () => {
    certListFiles.mockImplementation(async () => [{ id: "f-new", name: "Requirements.pdf", fromSm8: true }]);
    const list = await openStep();
    expect(list.getByRole("option", { name: "No files on this job yet" })).toBeInTheDocument();
    await userEvent.click(list.getByRole("button", { name: "Look again" }));
    expect(cacheJobFiles).toHaveBeenCalledWith("job-1");
    expect(await list.findByRole("option", { name: "Requirements.pdf" })).toBeInTheDocument();
  });
});

describe("where the exhaust goes", () => {
  it("asks whether every exhaust fan discharges outdoors, and won't issue until it's answered", async () => {
    certWizardContext.mockImplementation(async () =>
      context({
        job: { uuid: "job-1", number: "2933", address: "8/119 McEvoy St\nAlexandria NSW 2015", description: JOB_2933, companyUuid: "co-1", clientName: "RCC", completedOn: "2026-07-16" },
        reading: readQuote(JOB_2933),
        building: suggestBuilding("8/119 McEvoy St"),
      })
    );
    open();
    await screen.findByRole("tab", { name: "Equipment" });
    await tab("Equipment");
    const eq = panel("equipment");
    expect(eq.getByText("Does every exhaust fan discharge outdoors?")).toBeInTheDocument();
    for (const name of [/every one discharges outdoors/, /not every one/, /no exhaust fans/]) expect(eq.getByRole("radio", { name })).not.toBeChecked();
    await tab("Sign");
    expect(panel("sign").getByRole("button", { name: "Say whether every exhaust fan discharges outdoors." })).toBeInTheDocument();
    await tab("Equipment");
    await userEvent.click(eq.getByRole("radio", { name: /not every one/ }));
    expect(eq.getByText("The certificate won't say where the exhaust goes.")).toBeInTheDocument();
    expect(panel("sign").queryByRole("button", { name: "Say whether every exhaust fan discharges outdoors." })).toBeNull();
  });
});

describe("every unit listed", () => {
  it("takes the tick back off when a unit changes", async () => {
    open();
    await screen.findByRole("tab", { name: "Equipment" });
    await tab("Equipment");
    const eq = panel("equipment");
    const tick = eq.getByRole("checkbox", { name: /Every unit installed is listed/ });
    await userEvent.click(tick);
    expect(tick).toBeChecked();
    await userEvent.type(eq.getByLabelText("Room"), "Office");
    expect(tick).not.toBeChecked();
  });

  it("keeps the tick when only the refrigerant charge is typed", async () => {
    open();
    await screen.findByRole("tab", { name: "Equipment" });
    await tab("Equipment");
    await userEvent.click(panel("equipment").getByRole("checkbox", { name: /Every unit installed is listed/ }));
    await tab("Checks");
    await userEvent.type(panel("checks").getByLabelText("Added, kg"), "0.4");
    await tab("Equipment");
    expect(panel("equipment").getByRole("checkbox", { name: /Every unit installed is listed/ })).toBeChecked();
  });
});
