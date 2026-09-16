import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { StaffOnboarding, type OnboardingDraft } from "../staff-onboarding";

/* The first run's screen: what it offers back, what it insists on, and that
   both of its exits leave for Home. The writes themselves are the actions'
   (pinned in app/actions/__tests__/onboarding.test.ts). */

const replace = jest.fn();
jest.mock("next/navigation", () => ({ useRouter: () => ({ replace }) }));

const BLANK: OnboardingDraft = {
  first_name: "",
  last_name: "",
  preferred_name: "",
  birthday: "",
  phone: "",
  address: "",
  emergency_name: "",
  emergency_relationship: "",
  emergency_phone: "",
};

function setup(initial: Partial<OnboardingDraft> = {}, orgName: string | null = "Diamond Air Solutions") {
  const actions = {
    onComplete: jest.fn().mockResolvedValue({ ok: true }),
    onSkip: jest.fn().mockResolvedValue({ ok: true }),
  };
  render(<StaffOnboarding initial={{ ...BLANK, ...initial }} orgName={orgName} actions={actions} />);
  return { actions, user: userEvent.setup() };
}

beforeEach(() => replace.mockClear());

it("names the workspace being joined, and says nothing when it has no name", () => {
  setup();
  expect(screen.getByRole("heading", { level: 1, name: "Your details" })).toBeInTheDocument();
  expect(screen.getByText("Joining Diamond Air Solutions.")).toBeInTheDocument();
});

it("says nothing under the title for a workspace with no name yet", () => {
  setup({}, null);
  expect(screen.queryByText(/^Joining/)).not.toBeInTheDocument();
});

it("offers back what the card already holds, to be confirmed", () => {
  setup({ first_name: "luke", emergency_relationship: "Partner" });
  expect(screen.getByLabelText(/^First name/)).toHaveValue("luke");
  expect(screen.getByLabelText("Relationship")).toHaveValue("Partner");
});

/* The name is the one thing nothing else in the flow can answer. The screen
   says so on the fields, before a round trip, and sends nothing. */
it("insists on a first and last name before saving", async () => {
  const { actions, user } = setup({ first_name: "luke" });
  await user.click(screen.getByRole("button", { name: "Save details" }));
  expect(screen.getByRole("alert")).toHaveTextContent("Add your first and last name.");
  expect(screen.getByLabelText(/^Last name/)).toHaveAttribute("aria-invalid", "true");
  expect(screen.getByLabelText(/^First name/)).not.toHaveAttribute("aria-invalid");
  expect(actions.onComplete).not.toHaveBeenCalled();

  // typing is the correction
  await user.type(screen.getByLabelText(/^Last name/), "B");
  expect(screen.queryByRole("alert")).not.toBeInTheDocument();
});

it("saves the two groups it collects, and goes Home", async () => {
  const { actions, user } = setup();
  await user.type(screen.getByLabelText(/^First name/), "Luke");
  await user.type(screen.getByLabelText(/^Last name/), "Brennan");
  await user.type(screen.getByLabelText("Date of birth"), "11/02/1994");
  await user.type(screen.getByLabelText("Mobile"), "0412 345 678");
  await user.type(screen.getByLabelText("Name"), "Sam Brennan");
  await user.selectOptions(screen.getByLabelText("Relationship"), "Partner");
  await user.click(screen.getByRole("button", { name: "Save details" }));

  expect(actions.onComplete).toHaveBeenCalledWith(
    {
      first_name: "Luke",
      last_name: "Brennan",
      preferred_name: "",
      birthday: "11/02/1994",
      phone: "0412 345 678",
      address: "",
    },
    { emergency_name: "Sam Brennan", emergency_relationship: "Partner", emergency_phone: "" }
  );
  expect(replace).toHaveBeenCalledWith("/dashboard");
});

it("puts a rejected save beside the field it names", async () => {
  const { actions, user } = setup({ first_name: "Luke", last_name: "Brennan", birthday: "31/31/1994" });
  actions.onComplete.mockResolvedValue({
    ok: false,
    error: "Check the date format — use dd/mm/yyyy.",
    fields: ["birthday"],
  });
  await user.click(screen.getByRole("button", { name: "Save details" }));
  expect(screen.getByRole("alert")).toHaveTextContent("Check the date format — use dd/mm/yyyy.");
  expect(screen.getByLabelText("Date of birth")).toHaveAttribute("aria-invalid", "true");
  expect(replace).not.toHaveBeenCalled();
});

/* Skipping is an answer, not an escape hatch that loses the person: it asks
   nothing of the fields and goes straight Home. */
it("skips without a name, and goes Home", async () => {
  const { actions, user } = setup();
  await user.click(screen.getByRole("button", { name: "Skip for now" }));
  expect(actions.onSkip).toHaveBeenCalled();
  expect(actions.onComplete).not.toHaveBeenCalled();
  expect(replace).toHaveBeenCalledWith("/dashboard");
});
