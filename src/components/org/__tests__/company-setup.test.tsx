import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { EMPTY_SETUP_DRAFT } from "@/lib/org/setup";
import type { SaveResult } from "../types";

/* First-run setup — one draft across two steps, one save at the end.

   What this file pins: the required name is enforced before the wizard
   advances, a bad ABN never leaves the browser, stepping back loses nothing,
   the finish sends the per-section payloads (and only those), and a save
   rejected by the server lands the person on the STEP that holds the field
   it names — not on whichever step pressed the button. */

const replace = jest.fn();
jest.mock("next/navigation", () => ({ useRouter: () => ({ replace }) }));

import { CompanySetup } from "../company-setup";

const onComplete = jest.fn<
  Promise<SaveResult>,
  [Record<string, string>, Record<string, string>]
>(async () => ({ ok: true }));
const onSkip = jest.fn<Promise<SaveResult>, []>(async () => ({ ok: true }));

function mount(initial = EMPTY_SETUP_DRAFT) {
  return render(<CompanySetup initial={initial} actions={{ onComplete, onSkip }} />);
}

beforeEach(() => {
  replace.mockClear();
  onComplete.mockReset().mockResolvedValue({ ok: true });
  onSkip.mockReset().mockResolvedValue({ ok: true });
});

it("opens on the business step with the name required", () => {
  mount();
  expect(screen.getByRole("heading", { name: "Your business" })).toBeInTheDocument();
  expect(screen.getByLabelText(/Business name/)).toBeInTheDocument();
});

it("won't advance without a business name", async () => {
  const user = userEvent.setup();
  mount();
  await user.click(screen.getByRole("button", { name: "Continue" }));
  expect(screen.getByRole("alert")).toHaveTextContent("Give the business a name");
  // still on step 1 — the contact fields never rendered
  expect(screen.queryByLabelText("Suburb")).not.toBeInTheDocument();
});

/* The same checksum the action runs, run here first — the action is not
   called at all and the ABN box is the one that gets marked. */
it("answers a bad ABN on the field without leaving the browser", async () => {
  const user = userEvent.setup();
  mount();
  await user.type(screen.getByLabelText(/Business name/), "Smith Air");
  await user.type(screen.getByLabelText("ABN"), "51824753557");
  await user.click(screen.getByRole("button", { name: "Continue" }));
  expect(screen.getByRole("alert")).toHaveTextContent("That ABN doesn't check out");
  expect(screen.getByLabelText("ABN")).toHaveAttribute("aria-invalid", "true");
  expect(onComplete).not.toHaveBeenCalled();
});

it("finishes with the per-section payloads and heads to the dashboard", async () => {
  const user = userEvent.setup();
  mount();
  await user.type(screen.getByLabelText(/Business name/), "Smith Air");
  await user.type(screen.getByLabelText("ABN"), "51 824 753 556");
  await user.click(screen.getByRole("button", { name: "Yes" }));
  await user.click(screen.getByRole("button", { name: "Continue" }));

  await user.type(screen.getByLabelText("Suburb"), "Ringwood");
  await user.selectOptions(screen.getByLabelText(/State/), "VIC");
  await user.click(screen.getByRole("button", { name: "Finish setup" }));

  expect(onComplete).toHaveBeenCalledWith(
    {
      trading_name: "Smith Air",
      legal_name: "",
      abn: "51 824 753 556",
      gst_registered: "Yes",
    },
    { email: "", phone: "", address: "", suburb: "Ringwood", state: "VIC", postcode: "" }
  );
  expect(replace).toHaveBeenCalledWith("/dashboard");
});

it("keeps every word across Back and forward again", async () => {
  const user = userEvent.setup();
  mount();
  await user.type(screen.getByLabelText(/Business name/), "Smith Air");
  await user.click(screen.getByRole("button", { name: "Continue" }));
  await user.type(screen.getByLabelText("Suburb"), "Ringwood");

  await user.click(screen.getByRole("button", { name: "← Back" }));
  expect(screen.getByLabelText(/Business name/)).toHaveValue("Smith Air");

  await user.click(screen.getByRole("button", { name: "Continue" }));
  expect(screen.getByLabelText("Suburb")).toHaveValue("Ringwood");
});

/* The server names columns; the wizard shows one step at a time. The error
   must land beside its field, which here means going BACK a step. */
it("returns to the step a rejected save names", async () => {
  onComplete.mockResolvedValue({
    ok: false,
    error: "That ABN doesn't check out — it should be 11 digits.",
    fields: ["abn"],
  });
  const user = userEvent.setup();
  mount({ ...EMPTY_SETUP_DRAFT, trading_name: "Smith Air" });
  await user.click(screen.getByRole("button", { name: "Continue" }));
  await user.click(screen.getByRole("button", { name: "Finish setup" }));

  expect(await screen.findByRole("alert")).toHaveTextContent("That ABN doesn't check out");
  expect(screen.getByLabelText("ABN")).toHaveAttribute("aria-invalid", "true");
  expect(replace).not.toHaveBeenCalled();
});

it("skips out through the recorded exit", async () => {
  const user = userEvent.setup();
  mount();
  await user.click(screen.getByRole("button", { name: /Skip for now/ }));
  expect(onSkip).toHaveBeenCalled();
  expect(replace).toHaveBeenCalledWith("/dashboard");
});

it("shows a refused skip instead of navigating", async () => {
  onSkip.mockResolvedValue({ ok: false, error: "Only an owner can change organisation settings." });
  const user = userEvent.setup();
  mount();
  await user.click(screen.getByRole("button", { name: /Skip for now/ }));
  expect(await screen.findByRole("alert")).toHaveTextContent("Only an owner");
  expect(replace).not.toHaveBeenCalled();
});
