import { act, cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { ExpenseForm, type CostJob } from "../expense-form";
import { WindowsContext } from "@/components/records/records-context";
import type { JobCandidate } from "@/lib/workboard/note-match";
import type { PaidWith } from "@/lib/expenses/claim";

/* CLAIM AN EXPENSE, and a job's Add › Cost (v2 forms, boards 10 and 4).
   Every rule My expenses' own form had, kept: the receipt first and read,
   the file attached at any point and never re-read over what was typed,
   PDFs, whose money it was, the job (kind and id only), fuel handed to the
   vehicle, and Send held until the two things a claim needs. New: it opens
   over the page, the job is a field, a ServiceM8 job is named in the words,
   fuel reads the litres and the ABN with the fuel log's reader, and saving
   says so with a toast whose Undo cancels the claim. */

const readReceipt = jest.fn();
const readFuel = jest.fn();
const submit = jest.fn();
const cancel = jest.fn();
const facts = jest.fn();
const upload = jest.fn();
const push = jest.fn();
const refresh = jest.fn();

jest.mock("@/app/actions/expense-ai", () => ({
  readExpenseReceipt: (...a: unknown[]) => readReceipt(...a),
}));
jest.mock("@/app/actions/fleet-ai", () => ({
  readFuelReceipt: (...a: unknown[]) => readFuel(...a),
}));
jest.mock("@/app/actions/expenses", () => ({
  submitClaim: (...a: unknown[]) => submit(...a),
  cancelClaim: (...a: unknown[]) => cancel(...a),
  claimFormFacts: () => facts(),
}));
jest.mock("@/lib/documents/upload-client", () => ({
  uploadFile: (...a: unknown[]) => upload(...a),
}));
/* jsdom draws no canvas: the photo goes to the reader as it is */
jest.mock("@/lib/images/upright", () => ({
  fileToUprightBase64: async (f: File) => ({ data: "b64", mediaType: f.type }),
}));
jest.mock("next/navigation", () => ({ useRouter: () => ({ push, refresh }) }));

const TODAY = "2026-10-18";
const JOBS: JobCandidate[] = [
  { kind: "visit", id: "v1", clientName: "Northgate Realty", label: "Quarterly service", siteLabel: "Mona Vale", jobNumber: "1042" },
  { kind: "project", id: "p1", clientName: "Acme Industrial", label: "Plant room", siteLabel: null, jobNumber: null },
];
const SM8: CostJob = { kind: "sm8", id: "j-3209", label: "Job 3209, Richards Building, North Narrabeen" };

const toast = jest.fn();
type Opts = { job?: CostJob | null; jobs?: JobCandidate[] | undefined; payer?: PaidWith; given?: boolean };
const draw = ({ job = null, jobs = JOBS, payer, given = true }: Opts = {}) => {
  const onClose = jest.fn();
  const onSaved = jest.fn();
  const onUndone = jest.fn();
  render(
    <WindowsContext.Provider value={{ toast } as never}>
      <ExpenseForm
        job={job}
        jobs={given ? jobs : undefined}
        today={given ? TODAY : undefined}
        payer={payer}
        onClose={onClose}
        onSaved={onSaved}
        onUndone={onUndone}
      />
    </WindowsContext.Provider>,
  );
  return { onClose, onSaved, onUndone };
};

/** The file picker the drop zone's Choose a file and the form's Replace share. */
const picker = () => screen.getByLabelText("Choose a receipt") as HTMLInputElement;
const camera = () => screen.getByLabelText("Photograph a receipt") as HTMLInputElement;
const photo = () => new File(["x".repeat(900_000)], "Shell Mona Vale, 16 Oct.jpg", { type: "image/jpeg" });
const pdf = () => new File(["x"], "reece-invoice.pdf", { type: "application/pdf" });

const what = () => screen.getByLabelText("What was it for");
const total = () => screen.getByLabelText("Total paid");
const pickCategory = async (user: ReturnType<typeof userEvent.setup>, name: string) => {
  await user.click(screen.getByRole("combobox", { name: "Category" }));
  await user.click(within(screen.getByRole("listbox")).getByRole("option", { name }));
};

const READ = {
  ok: true,
  total: 158.4,
  gst: 14.4,
  supplier: "Shell Mona Vale",
  date: "2026-10-16",
  description: "Diesel",
  category: "fuel",
};

beforeEach(() => {
  sessionStorage.clear();
  readReceipt.mockReset().mockResolvedValue({ ok: false, reason: "no-key" });
  readFuel.mockReset().mockResolvedValue({ ok: false, reason: "no-key" });
  submit.mockReset().mockResolvedValue({ ok: true, id: "c1" });
  cancel.mockReset().mockResolvedValue({ ok: true });
  facts.mockReset().mockResolvedValue({ today: TODAY, jobs: JOBS });
  upload.mockReset().mockResolvedValue({ ok: true, file: { documentId: "doc-1" } });
  push.mockReset();
  refresh.mockReset();
  toast.mockReset();
});
afterEach(cleanup);

describe("the receipt first", () => {
  it("opens on the drop zone, with the camera, a file, and Enter it myself", () => {
    draw();
    expect(screen.getByRole("dialog", { name: "Claim an expense" })).toBeInTheDocument();
    expect(screen.getByText("Drop the receipt here, a photo or a PDF")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Take a photo" })).toHaveClass("pt-btn--main");
    expect(screen.getByRole("button", { name: "Choose a file" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Enter it myself" })).toBeInTheDocument();
    expect(camera()).toHaveAttribute("capture", "environment");
  });

  it("reads what is dropped with today's reader, and shows the fields filled for checking", async () => {
    readReceipt.mockResolvedValue({ ...READ, category: "materials", description: "Copper fittings", supplier: "Reece" });
    draw();
    const zone = screen.getByText("Drop the receipt here, a photo or a PDF").parentElement!;
    await act(async () => {
      fireEvent.drop(zone, { dataTransfer: { files: [photo()] } });
    });
    await waitFor(() => expect(what()).toHaveValue("Copper fittings"));
    expect(readReceipt).toHaveBeenCalledWith("b64", "image/jpeg");
    expect(screen.getByLabelText("Supplier")).toHaveValue("Reece");
    expect(total()).toHaveValue("158.4");
    expect(screen.getByLabelText("GST")).toHaveValue("14.4");
    expect(screen.getByText("Shell Mona Vale, 16 Oct.jpg")).toBeInTheDocument();
    expect(screen.getByText("Photo, 0.9 MB. Read into the form.")).toBeInTheDocument();
  });

  it("leaves the receipt and an empty form when the read fails, and says so", async () => {
    readReceipt.mockResolvedValue({ ok: false, reason: "Tiff declined to read this file." });
    const user = userEvent.setup();
    draw();
    await user.upload(picker(), photo());
    expect(await screen.findByRole("alert")).toHaveTextContent("Couldn't read that receipt");
    expect(what()).toHaveValue("");
    expect(screen.getByText("Shell Mona Vale, 16 Oct.jpg")).toBeInTheDocument();
  });

  it("scans PDFs like any other receipt", async () => {
    readReceipt.mockResolvedValue({ ...READ, category: "materials", description: "Copper fittings" });
    const user = userEvent.setup();
    draw();
    expect(picker().accept).toContain("application/pdf");
    await user.upload(picker(), pdf());
    await waitFor(() => expect(what()).toHaveValue("Copper fittings"));
    expect(readReceipt.mock.calls[0][1]).toBe("application/pdf");
    expect(screen.getByText("reece-invoice.pdf")).toBeInTheDocument();
    expect(screen.getByText(/^PDF, /)).toBeInTheDocument();
  });
});

describe("attaching a receipt", () => {
  it("offers an attach control after Enter it myself", async () => {
    const user = userEvent.setup();
    draw();
    await user.click(screen.getByRole("button", { name: "Enter it myself" }));
    expect(screen.getByText("No receipt attached")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Attach a receipt" })).toBeInTheDocument();
  });

  it("does NOT re-scan what you attach from the form", async () => {
    const user = userEvent.setup();
    draw();
    await user.click(screen.getByRole("button", { name: "Enter it myself" }));
    await user.type(what(), "Brazing rods");
    await user.upload(picker(), photo());
    expect(readReceipt).not.toHaveBeenCalled();
    expect(what()).toHaveValue("Brazing rods");
    expect(screen.getByRole("button", { name: "Replace" })).toBeInTheDocument();
  });

  it("sends the attached file with the claim", async () => {
    const user = userEvent.setup();
    draw();
    await user.click(screen.getByRole("button", { name: "Enter it myself" }));
    await user.type(what(), "Brazing rods");
    await user.type(total(), "48.90");
    await user.upload(picker(), photo());
    await user.click(screen.getByRole("button", { name: "Send claim" }));
    await waitFor(() => expect(submit).toHaveBeenCalled());
    expect(upload).toHaveBeenCalledWith(expect.any(File), "receipt");
    expect(submit.mock.calls[0][0]).toMatchObject({ documentIds: ["doc-1"], description: "Brazing rods", amount: 48.9 });
  });

  it("lets you take the receipt back off", async () => {
    const user = userEvent.setup();
    draw();
    await user.click(screen.getByRole("button", { name: "Enter it myself" }));
    await user.upload(picker(), photo());
    await user.click(screen.getByRole("button", { name: "Remove" }));
    expect(screen.getByText("No receipt attached")).toBeInTheDocument();
  });
});

describe("the claim", () => {
  it("holds Send until it has the two things a claim cannot be without", async () => {
    const user = userEvent.setup();
    draw();
    await user.click(screen.getByRole("button", { name: "Enter it myself" }));
    const send = () => screen.getByRole("button", { name: "Send claim" });
    expect(send()).toBeDisabled();
    expect(screen.getByText("Say what it was for")).toBeInTheDocument();
    await user.type(what(), "Fittings");
    expect(send()).toBeDisabled();
    expect(screen.getByText("Add how much it cost")).toBeInTheDocument();
    await user.type(total(), "45");
    expect(send()).toBeEnabled();
  });

  it("picks the date with the app's calendar, never a native date input", async () => {
    const user = userEvent.setup();
    draw();
    await user.click(screen.getByRole("button", { name: "Enter it myself" }));
    expect(document.querySelector('input[type="date"]')).toBeNull();
    expect(document.querySelector(".datef")).not.toBeNull();
    expect(document.querySelector("select")).toBeNull();
  });

  it("says what pressing the button will do, and flips with the payer", async () => {
    const user = userEvent.setup();
    draw();
    await user.click(screen.getByRole("button", { name: "Enter it myself" }));
    expect(screen.getByRole("button", { name: "Send claim" })).toBeInTheDocument();
    await user.click(screen.getByRole("radio", { name: "Company card" }));
    expect(screen.getByRole("button", { name: "Save the receipt" })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Send claim" })).toBeNull();
  });

  it("starts on the payer of the door you came through, and sends it", async () => {
    const user = userEvent.setup();
    draw({ payer: "company" });
    expect(screen.getByRole("radio", { name: "Company card" })).toHaveAttribute("aria-checked", "true");
    await user.click(screen.getByRole("button", { name: "Enter it myself" }));
    await user.type(what(), "Makita drill");
    await user.type(total(), "289");
    await user.click(screen.getByRole("button", { name: "Save the receipt" }));
    await waitFor(() => expect(submit).toHaveBeenCalledWith(expect.objectContaining({ paidWith: "company", job: null })));
  });

  it("keeps you where you were: closes, says so, and its Undo cancels the claim", async () => {
    const user = userEvent.setup();
    const { onClose, onSaved, onUndone } = draw();
    await user.click(screen.getByRole("button", { name: "Enter it myself" }));
    await user.type(what(), "Brazing rods");
    await user.type(total(), "48.90");
    await user.click(screen.getByRole("button", { name: "Send claim" }));
    await waitFor(() => expect(onClose).toHaveBeenCalled());
    expect(onSaved).toHaveBeenCalledWith("own");
    expect(push).not.toHaveBeenCalled();
    expect(toast).toHaveBeenCalledWith("Claim sent", expect.any(Function));
    await act(async () => {
      await toast.mock.calls[0][1]();
    });
    expect(cancel).toHaveBeenCalledWith("c1");
    expect(onUndone).toHaveBeenCalled();
  });

  it("says why when the server refuses, and stays open", async () => {
    submit.mockResolvedValue({ ok: false, error: "That date is in the future." });
    const user = userEvent.setup();
    const { onClose } = draw();
    await user.click(screen.getByRole("button", { name: "Enter it myself" }));
    await user.type(what(), "Brazing rods");
    await user.type(total(), "48.90");
    await user.click(screen.getByRole("button", { name: "Send claim" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("That date is in the future.");
    expect(onClose).not.toHaveBeenCalled();
    expect(toast).not.toHaveBeenCalled();
  });
});

/* ONE TANK, ONE RECORD (lib/fleet/fuel-handoff). */
describe("a fuel docket", () => {
  it("goes to the vehicle instead of raising a claim of its own", async () => {
    const user = userEvent.setup();
    draw();
    await user.click(screen.getByRole("button", { name: "Enter it myself" }));
    await pickCategory(user, "Fuel");
    await user.type(total(), "158.40");
    await user.click(screen.getByRole("button", { name: "Log it on the vehicle" }));
    await waitFor(() => expect(push).toHaveBeenCalledWith("/dashboard/my-vehicle"));
    expect(submit).not.toHaveBeenCalled();
    expect(JSON.parse(sessionStorage.getItem("heytiff.fleet.fuel.v1") ?? "{}")).toMatchObject({ cost: "158.40", paidWith: "own" });
  });

  it("reads the litres and the ABN with the fuel log's own reader, and takes them across with the docket", async () => {
    readReceipt.mockResolvedValue(READ);
    readFuel.mockResolvedValue({ ok: true, litres: 72.5, cost: 158.4, station: "Shell", date: "2026-10-16", gst: 14.4, abn: "51824753556" });
    const user = userEvent.setup();
    draw();
    await user.upload(camera(), photo());
    await waitFor(() => expect(screen.getByLabelText("Litres")).toHaveValue("72.5"));
    expect(readFuel).toHaveBeenCalledWith("b64", "image/jpeg");
    expect(screen.getByLabelText("Supplier ABN")).toHaveValue("51824753556");
    await user.type(screen.getByLabelText("Note"), "Van 4");
    await user.click(screen.getByRole("button", { name: "Log it on the vehicle" }));
    await waitFor(() => expect(push).toHaveBeenCalledWith("/dashboard/my-vehicle"));
    expect(upload).toHaveBeenCalledWith(expect.any(File), "fuel_receipt");
    expect(JSON.parse(sessionStorage.getItem("heytiff.fleet.fuel.v1") ?? "{}")).toMatchObject({
      cost: "158.4",
      gst: "14.4",
      station: "Shell Mona Vale",
      purchasedOn: "2026-10-16",
      abn: "51824753556",
      litres: "72.5",
      note: "Van 4",
      receiptDocumentId: "doc-1",
    });
  });

  it("reads a receipt already attached when Fuel is chosen, into the empty fields only", async () => {
    readFuel.mockResolvedValue({ ok: true, litres: 40, cost: null, station: null, date: null, gst: null, abn: "51824753556" });
    const user = userEvent.setup();
    draw();
    await user.click(screen.getByRole("button", { name: "Enter it myself" }));
    await user.upload(picker(), photo());
    await pickCategory(user, "Fuel");
    await waitFor(() => expect(screen.getByLabelText("Litres")).toHaveValue("40"));
    expect(readReceipt).not.toHaveBeenCalled();
    expect(readFuel).toHaveBeenCalledTimes(1);
  });

  it("leaves every other category filing a claim", async () => {
    const user = userEvent.setup();
    draw();
    await user.click(screen.getByRole("button", { name: "Enter it myself" }));
    expect(screen.queryByRole("button", { name: "Log it on the vehicle" })).toBeNull();
    expect(screen.queryByLabelText("Litres")).toBeNull();
    expect(readFuel).not.toHaveBeenCalled();
  });
});

/* THE JOB (rule 51): filled in when the form opens on one, clearable, and
   searchable as today's job picker searched. */
describe("the job", () => {
  it("finds open work by any word on it, and sends kind and id, never the label", async () => {
    const user = userEvent.setup();
    draw();
    await user.click(screen.getByRole("button", { name: "Enter it myself" }));
    await user.type(screen.getByPlaceholderText("Not for a job"), "mona vale");
    await user.click(screen.getByRole("button", { name: /Northgate Realty/ }));
    expect(screen.getByText("#1042, Northgate Realty, Quarterly service")).toBeInTheDocument();
    await user.type(what(), "Copper fittings");
    await user.type(total(), "84.50");
    await user.click(screen.getByRole("button", { name: "Send claim" }));
    await waitFor(() => expect(submit).toHaveBeenCalledWith(expect.objectContaining({ job: { kind: "visit", id: "v1" }, description: "Copper fittings" })));
    expect(toast).toHaveBeenCalledWith("Claim sent for #1042, Northgate Realty, Quarterly service", expect.any(Function));
  });

  it("lets you take the job back off", async () => {
    const user = userEvent.setup();
    draw();
    await user.click(screen.getByRole("button", { name: "Enter it myself" }));
    await user.type(screen.getByPlaceholderText("Not for a job"), "Acme");
    await user.click(screen.getByRole("button", { name: /Acme Industrial/ }));
    expect(screen.getByText("Acme Industrial, Plant room")).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Clear the job" }));
    expect(screen.getByPlaceholderText("Not for a job")).toBeInTheDocument();
  });

  it("says nothing at all when there is no open work", async () => {
    const user = userEvent.setup();
    draw({ jobs: [] });
    await user.click(screen.getByRole("button", { name: "Enter it myself" }));
    expect(screen.queryByLabelText("Job")).toBeNull();
  });
});

/* A JOB'S ADD › COST: the same form, "Add a cost", the job filled in. */
describe("Add a cost, from a job", () => {
  it("opens on the job, above the receipt, and reads the open work itself", async () => {
    draw({ job: SM8, given: false });
    expect(screen.getByRole("dialog", { name: "Add a cost" })).toBeInTheDocument();
    expect(screen.getByText(SM8.label)).toBeInTheDocument();
    await waitFor(() => expect(facts).toHaveBeenCalled());
  });

  it("names a ServiceM8 job in the claim's words, as the cost lane does, and links nothing", async () => {
    const user = userEvent.setup();
    draw({ job: SM8, given: false, payer: "company" });
    await user.click(screen.getByRole("button", { name: "Enter it myself" }));
    await user.type(what(), "Copper fittings and flux");
    await user.type(total(), "184.50");
    await user.click(screen.getByRole("button", { name: "Add cost" }));
    await waitFor(() => expect(submit).toHaveBeenCalled());
    expect(submit.mock.calls[0][0]).toMatchObject({
      job: null,
      description: "Copper fittings and flux, for Job 3209, Richards Building, North Narrabeen",
      paidWith: "company",
    });
    expect(toast).toHaveBeenCalledWith(`Cost added for ${SM8.label}`, expect.any(Function));
  });

  it("links a visit or a project the claim can hold", async () => {
    const user = userEvent.setup();
    draw({ job: { kind: "project", id: "p1", label: "Acme Industrial, Plant room" } });
    await user.click(screen.getByRole("button", { name: "Enter it myself" }));
    await user.type(what(), "Flux");
    await user.type(total(), "12");
    await user.click(screen.getByRole("button", { name: "Send claim" }));
    await waitFor(() => expect(submit).toHaveBeenCalledWith(expect.objectContaining({ job: { kind: "project", id: "p1" }, description: "Flux" })));
  });

  it("clears to a claim for no job, and keeps the field to find another", async () => {
    const user = userEvent.setup();
    draw({ job: SM8 });
    await user.click(screen.getByRole("button", { name: "Clear the job" }));
    expect(screen.queryByText(SM8.label)).toBeNull();
    expect(screen.getByPlaceholderText("Not for a job")).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Enter it myself" }));
    await user.type(what(), "Flux");
    await user.type(total(), "12");
    await user.click(screen.getByRole("button", { name: "Send claim" }));
    await waitFor(() => expect(submit).toHaveBeenCalledWith(expect.objectContaining({ job: null, description: "Flux" })));
  });
});
