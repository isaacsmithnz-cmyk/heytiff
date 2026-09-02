import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { StartScreen, type StartState } from "../start-screen";

/* The screen for a signed-in person who belongs to nowhere — a state that used
   to be impossible because signing in founded a company on their behalf.

   What these pin is the ORDER OF THE DOORS. The overwhelmingly common reason
   to land here is an invitation, so an invite leads and founding a company is
   the quiet alternative; with nothing waiting the founding door is the loud
   one. Getting that backwards recreates the original bug by hand — someone
   who was invited presses "Create a company" and owns a phantom workspace. */

const push = jest.fn();
const refresh = jest.fn();
jest.mock("next/navigation", () => ({ useRouter: () => ({ push, refresh }) }));

const onCreate = jest.fn(async () => ({ ok: true }) as { ok: boolean; error?: string });

beforeEach(() => {
  push.mockClear();
  refresh.mockClear();
  onCreate.mockClear();
  onCreate.mockResolvedValue({ ok: true });
});

const setup = (state: StartState, email: string | null = "new@hire.com") => {
  render(
    <StartScreen
      state={state}
      email={email}
      onCreate={onCreate as unknown as () => Promise<{ ok: true }>}
    />,
  );
  return userEvent.setup();
};

/* Interpolated names sit in their own text nodes, so a regex across the
   sentence never matches with getByText. The rendered words are what matter
   here, not which element holds them. */
const words = () => document.body.textContent ?? "";

const INVITE: StartState = {
  kind: "invite",
  company: "Diamond Air",
  role: "Staff",
  token: "tok-abc",
};

describe("an invitation is waiting", () => {
  it("names the company and the role, and links at the accept route", () => {
    setup(INVITE);

    expect(words()).toContain("Diamond Air has invited you to join as Staff");
    expect(screen.getByRole("link", { name: /Join Diamond Air/ })).toHaveAttribute(
      "href",
      "/invite/accept?token=tok-abc",
    );
  });

  /* Never removed: being invited somewhere is not a reason you may not also
     run your own business. Just not the loud one. */
  it("still offers founding, as the second door", () => {
    setup(INVITE);
    expect(screen.getByRole("button", { name: /Create a company instead/ })).toBeInTheDocument();
  });

  it("survives an org that never set a trading name", () => {
    setup({ ...INVITE, company: null });
    expect(screen.getByRole("link", { name: /Join the team/ })).toBeInTheDocument();
    expect(screen.queryByText(/null/)).not.toBeInTheDocument();
  });
});

describe("the invitation expired", () => {
  /* The renewal is one press on the inviter's end, and that is invisible from
     this side — without it the reader's options are wait or give up. */
  it("says who to ask and what to ask for, and offers no dead link", () => {
    setup({ kind: "expired", company: "Diamond Air" });

    expect(words()).toContain("Diamond Air invited you");
    expect(words()).toContain("renew it from their Team page");
    expect(screen.queryByRole("link", { name: /Join/ })).not.toBeInTheDocument();
  });
});

describe("nothing is waiting", () => {
  it("leads with founding a company", async () => {
    const user = setup({ kind: "none" });

    await user.click(screen.getByRole("button", { name: /Create a company/ }));

    expect(onCreate).toHaveBeenCalledTimes(1);
    expect(push).toHaveBeenCalledWith("/welcome");
  });

  /* The one fact nobody can see from here: an invitation is bound to an
     address, and this is the address they arrived on. Someone waiting on an
     invite sitting in a different inbox has no other way to learn that. */
  it("names the address an invitation would have to be sent to", () => {
    setup({ kind: "none" });
    expect(screen.getByText("new@hire.com")).toBeInTheDocument();
  });

  it("shows what went wrong and stays put", async () => {
    onCreate.mockResolvedValue({ ok: false, error: "Couldn't create your company." });
    const user = setup({ kind: "none" });

    await user.click(screen.getByRole("button", { name: /Create a company/ }));

    expect(screen.getByText("Couldn't create your company.")).toBeInTheDocument();
    expect(push).not.toHaveBeenCalled();
  });
});

describe("every state", () => {
  /* Signing in with the wrong Google account is the other way to land here,
     and without a way out the screen is a dead end for anyone who did. */
  it.each([
    ["invite", INVITE],
    ["expired", { kind: "expired", company: "Diamond Air" } as StartState],
    ["member", { kind: "member" } as StartState],
    ["none", { kind: "none" } as StartState],
  ])("offers a way out of the wrong account (%s)", (_label, state) => {
    setup(state as StartState);
    expect(screen.getByRole("link", { name: "Sign out" })).toHaveAttribute("href", "/auth/logout");
  });
});
