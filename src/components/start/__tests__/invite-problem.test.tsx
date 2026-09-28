import { render, screen } from "@testing-library/react";
import { InviteProblem, type InviteProblemReason } from "../invite-problem";

/* What an invitation link says when it cannot be accepted. It used to print a
   sentence off its own query string, in red on a blank page. Each reason now
   names its next step, and the words are the app's. */

const words = () => document.body.textContent ?? "";

const setup = (
  reason: InviteProblemReason,
  over: Partial<{ company: string | null; invitedEmail: string | null; signedInEmail: string | null }> = {},
) =>
  render(
    <InviteProblem
      reason={reason}
      company="Diamond Air Solutions"
      invitedEmail="ben@diamondairsolutions.com"
      signedInEmail={null}
      {...over}
    />,
  );

describe("signed in as somebody else", () => {
  it("names both addresses and offers the one door that fixes it", () => {
    setup("wrong_account", { signedInEmail: "ben.fletcher@gmail.com" });

    expect(screen.getByRole("heading", { name: "This invitation is for another address" })).toBeInTheDocument();
    expect(words()).toContain("It was sent to ben@diamondairsolutions.com and you’re signed in as ben.fletcher@gmail.com.");
    expect(words()).toContain("open the invitation from the email again");
    expect(screen.getByRole("link", { name: "Sign out" })).toHaveAttribute("href", "/auth/logout");
    // one Sign out, in the card — not a second in the footer
    expect(screen.getAllByRole("link", { name: "Sign out" })).toHaveLength(1);
  });
});

describe("expired", () => {
  it("says who can renew it, with the company named", () => {
    setup("expired");
    expect(words()).toContain("Diamond Air Solutions invited you, but invitations run out after seven days.");
    expect(words()).toContain("renew it from their Team page");
  });

  it("never shows the invited address", () => {
    setup("expired");
    expect(words()).not.toContain("ben@diamondairsolutions.com");
  });

  it("still reads as a sentence with no company", () => {
    setup("expired", { company: null });
    expect(words()).toContain("Ask whoever invited you to renew it from their Team page");
  });
});

describe("already used", () => {
  it("opens the workspace for somebody signed in", () => {
    setup("used", { signedInEmail: "ben@diamondairsolutions.com" });
    expect(screen.getByRole("link", { name: "Open HeyTiff" })).toHaveAttribute("href", "/dashboard");
    expect(words()).toContain("Signed in as ben@diamondairsolutions.com.");
  });

  it("offers sign-in to somebody who is not", () => {
    setup("used");
    expect(screen.getByRole("link", { name: "Sign in" })).toHaveAttribute("href", "/auth/login");
    expect(words()).toContain("sign in to open Diamond Air Solutions");
  });
});

describe("not found", () => {
  it("says the link does not work and who to ask", () => {
    setup("not_found", { company: null, invitedEmail: null });
    expect(screen.getByRole("heading", { name: "This invitation link doesn’t work" })).toBeInTheDocument();
    expect(words()).toContain("Ask whoever invited you to send it again.");
  });
});
