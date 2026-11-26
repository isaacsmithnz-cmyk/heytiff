import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { FirstRun, type FirstRunActions, type Step } from "../first-run";

/* The web's first run, as the phone's: its steps in the phone's order and
   words, the name the one thing insisted on, Skip on every other step, and
   the stamps at the end. */

const replace = jest.fn();
jest.mock("next/navigation", () => ({ useRouter: () => ({ replace, push: jest.fn(), refresh: jest.fn() }) }));
jest.mock("@/components/address/address-field", () => ({
  AddressField: ({ name, value, onChange }: { name: string; value: string; onChange: (v: string) => void }) => (
    <input id={name} aria-label={name} value={value} onChange={(e) => onChange(e.target.value)} />
  ),
}));
jest.mock("@/components/record-modal/scan-card", () => ({ ScanCard: () => <div>scan</div> }));

const actions = {
  save: jest.fn(async () => ({ ok: true }) as const),
  team: jest.fn(async () => ({ ok: true, sent: 1, failed: [] }) as const),
  finish: jest.fn(async () => ({ ok: true }) as const),
  readLicence: jest.fn(),
  addLicence: jest.fn(),
};

beforeEach(() => {
  replace.mockClear();
  Object.values(actions).forEach((f) => f.mockClear());
});

const setup = (steps: Step[], details: Record<string, string> = {}) => {
  render(
    <FirstRun
      steps={steps}
      org="Demo Air Conditioning"
      initialDetails={details}
      initialBusiness={{ trading_name: "Demo Air Conditioning" }}
      relationships={["Partner", "Parent"]}
      licenceKinds={["Refrigerant handling licence", "Driver licence"]}
      staffId="card-sam"
      today="2026-11-26"
      addressLookup={false}
      actions={actions as unknown as FirstRunActions}
    />
  );
  return userEvent.setup();
};
const heading = () => screen.getByRole("heading", { level: 1 }).textContent;

test("joining a team: Your details, Emergency contact, Licences, then Home", async () => {
  const user = setup(["details", "emergency", "licences"], { first_name: "Sam", last_name: "Carter" });
  expect(heading()).toBe("Your details");
  await user.click(screen.getByRole("button", { name: "Continue" }));
  expect(actions.save).toHaveBeenCalledWith("details", expect.objectContaining({ first_name: "Sam", last_name: "Carter" }));
  expect(heading()).toBe("Emergency contact");
  expect(document.body.textContent).toContain("Who Demo Air Conditioning calls if you're hurt on a job.");
  await user.click(screen.getByRole("button", { name: "Skip" }));
  expect(heading()).toBe("Licences");
  expect(screen.getAllByRole("button", { name: "Add photo" })).toHaveLength(2);
  await user.click(screen.getByRole("button", { name: "Open Home" }));
  expect(actions.finish).toHaveBeenCalled();
  expect(replace).toHaveBeenCalledWith("/dashboard");
});

test("the name is the one thing insisted on, and a birthday has to be a real one", async () => {
  const user = setup(["details", "emergency"]);
  await user.click(screen.getByRole("button", { name: "Continue" }));
  expect(document.body.textContent).toContain("Add your first and last name.");
  expect(actions.save).not.toHaveBeenCalled();
  await user.type(screen.getByLabelText("First name"), "Sam");
  await user.type(screen.getByLabelText("Last name"), "Carter");
  await user.type(screen.getByLabelText("Date of birth"), "31022000");
  expect((screen.getByLabelText("Date of birth") as HTMLInputElement).value).toBe("31/02/2000");
  await user.click(screen.getByRole("button", { name: "Continue" }));
  expect(document.body.textContent).toContain("Check your date of birth");
  expect(actions.save).not.toHaveBeenCalled();
});

test("starting a business: how customers reach you, your details, your team, then what's left", async () => {
  const user = setup(["contact", "details", "team", "ready"], { first_name: "Jordan", last_name: "Lee" });
  expect(heading()).toBe("How customers reach you");
  await user.click(screen.getByRole("button", { name: "Continue" }));
  expect(actions.save).toHaveBeenCalledWith("contact", expect.anything());
  await user.click(screen.getByRole("button", { name: "Continue" }));
  expect(heading()).toBe("Your team");
  await user.type(screen.getByLabelText("Email"), "sam@example.com");
  await user.click(screen.getByRole("button", { name: "Send 1 invitation" }));
  expect(actions.team).toHaveBeenCalledWith([{ name: "", email: "sam@example.com", role: "staff" }]);
  expect(heading()).toBe("You're set up");
  expect(document.body.textContent).toContain("1 invited");
  expect(screen.getByRole("link", { name: "Connect ServiceM8" }).getAttribute("href")).toBe("/dashboard/admin/integrations/servicem8");
  expect(screen.queryByRole("button", { name: "Skip" })).toBeNull();
});
