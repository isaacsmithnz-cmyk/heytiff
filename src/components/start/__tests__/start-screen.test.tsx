import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { StartScreen, type StartActions, type StartState } from "../start-screen";

/* The web's first door, as the phone's (Isaac, 26 November 2026: "make the
   web first run match the phone"). What these pin is the ORDER OF THE DOORS:
   an invitation leads; with nothing waiting, what that may mean (the wrong
   address) comes before the business's form, so nobody invited on another
   address makes a phantom workspace by pressing on. */

const push = jest.fn();
const refresh = jest.fn();
jest.mock("next/navigation", () => ({ useRouter: () => ({ push, refresh }) }));

const actions = {
  join: jest.fn(async () => ({ ok: true }) as const),
  ask: jest.fn(async () => ({ ok: true }) as const),
  confirm: jest.fn(async () => ({ ok: true }) as const),
  create: jest.fn(async () => ({ ok: true }) as const),
  save: jest.fn(async () => ({ ok: true }) as const),
};

beforeEach(() => {
  push.mockClear();
  Object.values(actions).forEach((f) => f.mockClear());
});

const setup = (state: StartState, email: string | null = "sam@example.com") => {
  render(<StartScreen state={state} email={email} actions={actions as unknown as StartActions} />);
  return userEvent.setup();
};
const words = () => document.body.textContent ?? "";

const INVITE: StartState = {
  kind: "invite",
  id: "inv-1",
  company: "Demo Air Conditioning",
  role: "Staff",
  roleBlurb: "Field worker, their own records only",
  inviter: "Jordan Lee",
  invitedOn: "2026-11-24T00:00:00Z",
};

test("an invitation leads: the business, who asked, the role in your words, and Join", async () => {
  const user = setup(INVITE);
  expect(screen.getByRole("heading", { name: "Join Demo Air Conditioning" })).toBeTruthy();
  expect(words()).toContain("added you as Staff on 24 Nov");
  expect(words()).toContain("Field worker, your own records only");
  await user.click(screen.getByRole("button", { name: "Join Demo Air Conditioning" }));
  expect(actions.join).toHaveBeenCalledWith("inv-1");
  expect(push).toHaveBeenCalledWith("/dashboard");
  expect(screen.queryByRole("button", { name: /Set up/ })).toBeNull();
});

test("nothing waiting says so first, and the business's form comes only after", async () => {
  const user = setup({ kind: "none" });
  expect(screen.getByRole("heading", { name: "No invitation for this address" })).toBeTruthy();
  expect(words()).toContain("Ask your boss to add sam@example.com");
  expect(screen.queryByLabelText("Business name")).toBeNull();
  await user.click(screen.getByRole("button", { name: "Set up my own business" }));
  expect(screen.getByRole("heading", { name: "Set up your business" })).toBeTruthy();
});

test("setting up makes the business, then names it, then goes on to the first run", async () => {
  const user = setup({ kind: "none" });
  await user.click(screen.getByRole("button", { name: "Set up my own business" }));
  await user.click(screen.getByRole("button", { name: "Continue" }));
  expect(words()).toContain("Give the business a name.");
  expect(actions.create).not.toHaveBeenCalled();
  await user.type(screen.getByLabelText("Business name"), "Demo Air Conditioning");
  await user.click(screen.getByRole("button", { name: "Continue" }));
  expect(actions.create).toHaveBeenCalled();
  expect(actions.save).toHaveBeenCalledWith("business", expect.objectContaining({ trading_name: "Demo Air Conditioning", gst_registered: "Yes" }));
  expect(push).toHaveBeenCalledWith("/welcome");
});

test("a run-out invitation asks the inviter by name", async () => {
  const user = setup({ kind: "expired", id: "inv-1", company: "Demo Air Conditioning", inviter: "Jordan Lee", invitedOn: "2026-11-12T00:00:00Z" });
  expect(screen.getByRole("heading", { name: "That invitation has run out" })).toBeTruthy();
  await user.click(screen.getByRole("button", { name: "Ask Jordan to resend it" }));
  expect(actions.ask).toHaveBeenCalledWith("inv-1");
  expect(words()).toContain("Asked. Jordan gets a notification.");
});

test("an address Auth0 hasn't confirmed is asked to confirm, and can have the email again", async () => {
  const user = setup({ kind: "confirm" });
  expect(screen.getByRole("heading", { name: "Confirm your email" })).toBeTruthy();
  await user.click(screen.getByRole("button", { name: "Send it again" }));
  expect(actions.confirm).toHaveBeenCalled();
  expect(words()).toContain("Sent. Check your inbox.");
});

test("every door says who's signed in, with a way out", () => {
  setup(INVITE);
  expect(words()).toContain("Signed in as sam@example.com.");
  expect(screen.getAllByRole("link", { name: "Sign out" }).length).toBeGreaterThan(0);
});
