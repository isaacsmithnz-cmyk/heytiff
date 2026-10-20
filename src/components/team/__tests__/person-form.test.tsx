import { act, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { AddPersonButton, PersonForm } from "../person-form";
import { WindowsContext } from "@/components/records/records-context";

/* createInvite is a server action — mocked, never called for real. The form's
   whole job is: offer only the roles the server allowed, hand the action the
   values, and be honest about what came back. */
const createInvite = jest.fn(async () => ({ ok: true }) as { ok: boolean; error?: string });
/* The address resolution — what the typed address already means in this
   workspace. Mocked for the same reason: the form's job is to ASK and to be
   honest about the answer, not to know the answer. */
const lookupInvitee = jest.fn(async () => ({ kind: "new" }) as Record<string, unknown>);
jest.mock("@/app/actions/invite", () => ({
  createInvite: (...a: unknown[]) => createInvite(...(a as [])),
  lookupInvitee: (...a: unknown[]) => lookupInvitee(...(a as [])),
}));

const refresh = jest.fn();
jest.mock("next/navigation", () => ({ useRouter: () => ({ push: jest.fn(), refresh }) }));

const toast = jest.fn();

beforeEach(() => {
  createInvite.mockClear();
  createInvite.mockResolvedValue({ ok: true });
  lookupInvitee.mockClear();
  lookupInvitee.mockResolvedValue({ kind: "new" });
  refresh.mockClear();
  toast.mockClear();
});

function setup(
  roles: string[] = ["admin", "staff"],
  prefill?: { email?: string; staffProfileId?: string; name?: string },
) {
  const onClose = jest.fn();
  render(
    <WindowsContext.Provider value={{ toast } as never}>
      <PersonForm roles={roles} onClose={onClose} prefill={prefill} />
    </WindowsContext.Provider>,
  );
  return { onClose, user: userEvent.setup() };
}

const emailField = () => screen.getByLabelText("Email address") as HTMLInputElement;
const send = () => screen.getByRole("button", { name: "Send invite" });
const roleOptions = () => screen.getAllByRole("radio").map((r) => r.textContent);
const chosenRole = () => screen.getAllByRole("radio").find((r) => r.getAttribute("aria-checked") === "true")?.textContent;

describe("Add a person", () => {
  it("offers exactly the roles it was given", () => {
    setup();
    expect(roleOptions()).toEqual(["Staff", "Admin"]);
    expect(chosenRole()).toBe("Staff"); // defaults to the least privileged
  });

  it("offers staff only for a delegated inviter", () => {
    setup(["staff"]);
    expect(roleOptions()).toEqual(["Staff"]);
  });

  it("submits the name, email and role, then closes, refreshes and says so, with no Undo", async () => {
    const { onClose, user } = setup();
    await user.type(screen.getByLabelText("Name"), "Dan Whitfield");
    await user.type(emailField(), "new@heytiff.co");
    await user.click(screen.getByRole("radio", { name: "Admin" }));
    await user.click(send());

    expect(createInvite).toHaveBeenCalledWith({
      email: "new@heytiff.co",
      role: "admin",
      name: "Dan Whitfield",
      staffProfileId: undefined,
    });
    expect(onClose).toHaveBeenCalled();
    expect(refresh).toHaveBeenCalled();
    // the letter has gone: withdrawing it is the invite row's Revoke
    expect(toast).toHaveBeenCalledWith("Invite sent to new@heytiff.co");
  });

  it("sends on Enter in a field, as the old form did", async () => {
    const { user } = setup(["staff"]);
    await user.type(emailField(), "new@heytiff.co{Enter}");
    expect(createInvite).toHaveBeenCalledTimes(1);
  });

  it("prefilled from an unclaimed card: address editable, card id rides the submit", async () => {
    const { user } = setup(["staff"], { email: "dan@acme.com", staffProfileId: "card-7", name: "Dan Smith" });

    // the claim is legible before anyone presses anything
    expect(screen.getByText(/attaches to Dan Smith's card/)).toBeInTheDocument();

    // remote systems hold stale addresses — the prefill is a start, not a lock
    expect(emailField().value).toBe("dan@acme.com");
    await user.clear(emailField());
    await user.type(emailField(), "dan.personal@gmail.com");
    await user.click(send());

    expect(createInvite).toHaveBeenCalledWith({
      email: "dan.personal@gmail.com",
      role: "staff",
      name: undefined,
      staffProfileId: "card-7",
    });
  });

  it("offers no name field when the invite claims a card", () => {
    // The card is the org's own answer to who this person is, and the action
    // discards anything typed here — so the field is absent rather than ignored.
    setup(["staff"], { email: "dan@acme.com", staffProfileId: "card-7", name: "Dan Whitfield" });
    expect(screen.queryByLabelText("Name")).toBeNull();
  });

  it("sends no name rather than an empty one", async () => {
    const { user } = setup(["staff"]);
    await user.type(emailField(), "new@heytiff.co");
    await user.click(send());
    expect(createInvite).toHaveBeenCalledWith(expect.objectContaining({ name: undefined }));
  });

  it("a plain invite still submits without any card id", async () => {
    const { user } = setup(["staff"]);
    await user.type(emailField(), "new@heytiff.co");
    await user.click(send());
    expect(createInvite).toHaveBeenCalledWith({
      email: "new@heytiff.co",
      role: "staff",
      name: undefined,
      staffProfileId: undefined,
    });
  });

  it("shows the action's error on the address and stays open", async () => {
    createInvite.mockResolvedValue({ ok: false, error: "You can't invite someone at that role." });
    const { onClose, user } = setup();
    await user.type(emailField(), "new@heytiff.co");
    await user.click(send());

    expect(await screen.findByText("You can't invite someone at that role.")).toBeInTheDocument();
    expect(emailField()).toHaveAttribute("aria-invalid", "true");
    expect(onClose).not.toHaveBeenCalled();
    expect(refresh).not.toHaveBeenCalled();
    expect(toast).not.toHaveBeenCalled();
  });

  it("won't submit an empty email", async () => {
    const { user } = setup();
    expect(send()).toBeDisabled();
    await user.click(send());
    expect(createInvite).not.toHaveBeenCalled();
  });

  it("closes on Cancel without inviting anyone", async () => {
    const { onClose, user } = setup();
    await user.click(screen.getByRole("button", { name: "Cancel" }));
    expect(onClose).toHaveBeenCalled();
    expect(createInvite).not.toHaveBeenCalled();
  });
});

/* The letter is posted by the action. The form says so when it went, and
   stays open only where the inviter has something left to do. */
describe("Add a person — what the letter did", () => {
  it("closes when the invitation was sent", async () => {
    createInvite.mockResolvedValue({ ok: true, delivery: { sent: true, to: "new@hire.com" } } as never);
    const { onClose, user } = setup();
    await user.type(emailField(), "new@hire.com");
    await user.click(send());
    expect(onClose).toHaveBeenCalled();
    expect(toast).toHaveBeenCalledWith("Invite sent to new@hire.com");
  });

  /* The invite EXISTS either way — the row is the invitation and the post is
     only its delivery — so this names the route that does not depend on mail
     rather than reading as a failure. */
  it("stays open and points at the link when the post didn't go", async () => {
    createInvite.mockResolvedValue({
      ok: true,
      delivery: { sent: false, to: "new@hire.com", reason: "failed" },
    } as never);
    const { onClose, user } = setup();
    await user.type(emailField(), "new@hire.com");
    await user.click(send());

    expect(onClose).not.toHaveBeenCalled();
    expect(screen.getByText(/Invite created/)).toBeInTheDocument();
    expect(screen.getByText(/their row on Team/)).toBeInTheDocument();
  });

  it("says so plainly where there is no mailer at all", async () => {
    createInvite.mockResolvedValue({
      ok: true,
      delivery: { sent: false, to: "new@hire.com", reason: "unconfigured" },
    } as never);
    const { user } = setup();
    await user.type(emailField(), "new@hire.com");
    await user.click(send());
    expect(screen.getByText(/Email isn't set up in this environment/)).toBeInTheDocument();
  });
});

/* THE ADDRESS RESOLVES BEFORE ANYTHING IS COMMITTED: an unclaimed card holding
   the address is named here, so this door and the card's row never make two
   people. */
describe("Add a person — what that address already means", () => {
  const type = async (user: ReturnType<typeof userEvent.setup>, v: string) => user.type(emailField(), v);

  it("says nothing for an address it knows nothing about", async () => {
    const { user } = setup();
    await type(user, "new@hire.com");
    await waitFor(() => expect(lookupInvitee).toHaveBeenCalledWith("new@hire.com"));
    expect(document.body.textContent).not.toMatch(/Attaches to/);
  });

  it("does not ask until the address could be one", async () => {
    const { user } = setup();
    await type(user, "dan@");
    expect(lookupInvitee).not.toHaveBeenCalled();
  });

  it("names the card it will attach to, and where that card came from", async () => {
    lookupInvitee.mockResolvedValue({ kind: "card", staffProfileId: "card-1", name: "Dan Reilly", importedFrom: "ServiceM8" });
    const { user } = setup();
    await type(user, "dan@reilly.com");
    await waitFor(() =>
      expect(document.body.textContent).toContain("Attaches to Dan Reilly's card (from ServiceM8), no second record."),
    );
    expect(document.querySelector(".mk-records-res .pt-dot--green")).toBeTruthy();
  });

  /* The line that says "attaches to Dan's card" has to be the button that
     does it. */
  it("carries the resolved card on the submit", async () => {
    lookupInvitee.mockResolvedValue({ kind: "card", staffProfileId: "card-1", name: "Dan Reilly", importedFrom: null });
    const { user } = setup();
    await type(user, "dan@reilly.com");
    await waitFor(() => expect(document.body.textContent).toMatch(/Attaches to/));
    await user.click(send());
    expect(createInvite).toHaveBeenCalledWith(expect.objectContaining({ email: "dan@reilly.com", staffProfileId: "card-1" }));
  });

  it("prefers the card the row named over the one the address found", async () => {
    lookupInvitee.mockResolvedValue({ kind: "card", staffProfileId: "found-by-address", name: "Someone Else", importedFrom: null });
    const { user } = setup(["staff"], { staffProfileId: "from-the-row", name: "Dan Reilly" });
    await type(user, "dan@reilly.com");
    await waitFor(() => expect(lookupInvitee).toHaveBeenCalled());
    await user.click(send());
    expect(createInvite).toHaveBeenCalledWith(expect.objectContaining({ staffProfileId: "from-the-row" }));
  });

  it.each([
    [{ kind: "member", name: "Dan Reilly" }, "Dan Reilly already has an account here."],
    [{ kind: "pending" }, "An invitation is already open for this address"],
    [{ kind: "ambiguous", count: 2 }, "2 unclaimed cards hold this address"],
  ])("warns before the press, not after the refusal (%#)", async (found, said) => {
    lookupInvitee.mockResolvedValue(found as Record<string, unknown>);
    const { user } = setup();
    await type(user, "dan@reilly.com");
    await waitFor(() => expect(document.body.textContent).toContain(said));
    expect(document.querySelector(".mk-records-res .pt-dot--orange")).toBeTruthy();
  });

  /* THE RACE: a slow reply for a half-typed address must not land after the
     finished one's and describe somebody else. */
  it("drops an answer that arrives for an address no longer typed", async () => {
    let releaseFirst: (v: Record<string, unknown>) => void = () => {};
    lookupInvitee
      .mockImplementationOnce(() => new Promise<Record<string, unknown>>((res) => (releaseFirst = res)))
      .mockResolvedValue({ kind: "new" });

    const { user } = setup();
    await type(user, "dan@reilly.com");
    await waitFor(() => expect(lookupInvitee).toHaveBeenCalledTimes(1));
    await type(user, "x");
    await waitFor(() => expect(lookupInvitee).toHaveBeenCalledTimes(2));

    // released only AFTER the fresh answer landed: the sequence that hurts
    await act(async () => {
      releaseFirst({ kind: "card", staffProfileId: "stale", name: "Stale Person", importedFrom: null });
    });
    expect(document.body.textContent).not.toContain("Stale Person");
  });
});

/* Two bare words are not a description of a permission, and the choice is
   made HERE. */
describe("Add a person — the roles explain themselves", () => {
  it("describes the chosen role, and re-describes it when it changes", async () => {
    const { user } = setup();
    expect(screen.getByText("Field worker — own data only")).toBeInTheDocument();
    await user.click(screen.getByRole("radio", { name: "Admin" }));
    expect(screen.getByText("Manage the team — approve & assign")).toBeInTheDocument();
    expect(screen.queryByText("Field worker — own data only")).not.toBeInTheDocument();
  });
});

/* THE DOOR (rule 52): Team's Add a person opens this form over Team. */
describe("Team's Add a person", () => {
  it("opens the form, and Cancel puts it away", async () => {
    render(<AddPersonButton roles={["staff"]} />);
    const user = userEvent.setup();
    expect(screen.queryByRole("dialog")).toBeNull();
    await user.click(screen.getByRole("button", { name: "Add a person" }));
    expect(screen.getByRole("dialog", { name: "Add a person" })).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Cancel" }));
    expect(screen.queryByRole("dialog")).toBeNull();
  });
});
