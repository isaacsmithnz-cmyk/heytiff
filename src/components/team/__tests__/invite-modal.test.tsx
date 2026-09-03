import { act, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { InviteModal } from "../invite-modal";

/* createInvite is a server action — mocked, never called for real. The modal's
   whole job is: offer only the roles the server allowed, hand the action the
   two values, and be honest about what came back. */
const createInvite = jest.fn(async () => ({ ok: true }) as { ok: boolean; error?: string });
/* The address resolution — what the typed address already means in this
   workspace. Mocked here for the same reason createInvite is: the modal's job
   is to ASK and to be honest about the answer, not to know the answer. */
const lookupInvitee = jest.fn(async () => ({ kind: "new" }) as Record<string, unknown>);
jest.mock("@/app/actions/invite", () => ({
  createInvite: (...a: unknown[]) => createInvite(...(a as [])),
  lookupInvitee: (...a: unknown[]) => lookupInvitee(...(a as [])),
}));

const refresh = jest.fn();
jest.mock("next/navigation", () => ({ useRouter: () => ({ push: jest.fn(), refresh }) }));

beforeEach(() => {
  createInvite.mockClear();
  createInvite.mockResolvedValue({ ok: true });
  lookupInvitee.mockClear();
  lookupInvitee.mockResolvedValue({ kind: "new" });
  refresh.mockClear();
});

function setup(
  roles: string[] = ["admin", "staff"],
  prefill?: { email?: string; staffProfileId?: string; name?: string },
) {
  const onClose = jest.fn();
  render(<InviteModal roles={roles} onClose={onClose} prefill={prefill} />);
  return { onClose, user: userEvent.setup() };
}

describe("InviteModal", () => {
  it("offers exactly the roles it was given", () => {
    setup();
    const select = screen.getByRole("combobox") as HTMLSelectElement;
    expect([...select.options].map((o) => o.textContent)).toEqual(["Admin", "Staff"]);
    expect(select.value).toBe("staff"); // defaults to the least privileged
  });

  it("offers staff only for a delegated inviter", () => {
    setup(["staff"]);
    const select = screen.getByRole("combobox") as HTMLSelectElement;
    expect([...select.options].map((o) => o.textContent)).toEqual(["Staff"]);
  });

  it("submits the name, email and role, then closes and refreshes", async () => {
    const { onClose, user } = setup();
    await user.type(screen.getByPlaceholderText("Dan Whitfield"), "Dan Whitfield");
    await user.type(screen.getByPlaceholderText("name@company.com"), "new@heytiff.co");
    await user.selectOptions(screen.getByRole("combobox"), "admin");
    await user.click(screen.getByRole("button", { name: /Send invitation/ }));

    expect(createInvite).toHaveBeenCalledWith({
      email: "new@heytiff.co",
      role: "admin",
      name: "Dan Whitfield",
      staffProfileId: undefined,
    });
    expect(onClose).toHaveBeenCalled();
    expect(refresh).toHaveBeenCalled();
  });

  it("prefilled from an unclaimed card: address editable, card id rides the submit", async () => {
    const onClose = jest.fn();
    render(
      <InviteModal
        roles={["staff"]}
        onClose={onClose}
        prefill={{ email: "dan@acme.com", staffProfileId: "card-7", name: "Dan Smith" }}
      />,
    );
    const user = userEvent.setup();

    // the claim is legible before anyone presses anything
    expect(screen.getByText(/attaches to Dan Smith's card/)).toBeInTheDocument();

    // remote systems hold stale addresses — the prefill is a start, not a lock
    const email = screen.getByPlaceholderText("name@company.com") as HTMLInputElement;
    expect(email.value).toBe("dan@acme.com");
    await user.clear(email);
    await user.type(email, "dan.personal@gmail.com");
    await user.click(screen.getByRole("button", { name: /Send invitation/ }));

    expect(createInvite).toHaveBeenCalledWith({
      email: "dan.personal@gmail.com",
      role: "staff",
      name: undefined,
      staffProfileId: "card-7",
    });
  });

  it("offers no name field when the invite claims a card", () => {
    // The card is the org's own answer to who this person is, and the action
    // discards anything typed here — so the field is absent rather than
    // ignored. The header already says whose card it attaches to.
    render(
      <InviteModal
        roles={["staff"]}
        onClose={jest.fn()}
        prefill={{ email: "dan@acme.com", staffProfileId: "card-7", name: "Dan Whitfield" }}
      />,
    );
    expect(screen.queryByPlaceholderText("Dan Whitfield")).toBeNull();
  });

  it("sends no name rather than an empty one", async () => {
    // "" is a value the action would have to decide about; nobody typing a
    // name is an absence.
    const { user } = setup(["staff"]);
    await user.type(screen.getByPlaceholderText("name@company.com"), "new@heytiff.co");
    await user.click(screen.getByRole("button", { name: /Send invitation/ }));

    expect(createInvite).toHaveBeenCalledWith(
      expect.objectContaining({ name: undefined }),
    );
  });

  it("a plain invite still submits without any card id", async () => {
    const { user } = setup(["staff"]);
    await user.type(screen.getByPlaceholderText("name@company.com"), "new@heytiff.co");
    await user.click(screen.getByRole("button", { name: /Send invitation/ }));

    expect(createInvite).toHaveBeenCalledWith({
      email: "new@heytiff.co",
      role: "staff",
      name: undefined,
      staffProfileId: undefined,
    });
  });

  it("shows the action's error and stays open", async () => {
    createInvite.mockResolvedValue({ ok: false, error: "You can't invite someone at that role." });
    const { onClose, user } = setup();
    await user.type(screen.getByPlaceholderText("name@company.com"), "new@heytiff.co");
    await user.click(screen.getByRole("button", { name: /Send invitation/ }));

    expect(await screen.findByText("You can't invite someone at that role.")).toBeInTheDocument();
    expect(onClose).not.toHaveBeenCalled();
    expect(refresh).not.toHaveBeenCalled();
  });

  it("won't submit an empty email", async () => {
    const { user } = setup();
    await user.click(screen.getByRole("button", { name: /Send invitation/ }));
    expect(createInvite).not.toHaveBeenCalled();
  });

  it("closes on the X without inviting anyone", async () => {
    const { onClose, user } = setup();
    await user.click(screen.getByLabelText("Close"));
    expect(onClose).toHaveBeenCalled();
    expect(createInvite).not.toHaveBeenCalled();
  });
});

/* The letter is posted by the action now. The modal's job is to be silent
   when that worked — the Pending tab behind it is the receipt — and to stay
   open only where the inviter has something left to do. */
describe("InviteModal — what the letter did", () => {
  it("closes without ceremony when the invitation was sent", async () => {
    createInvite.mockResolvedValue({
      ok: true,
      delivery: { sent: true, to: "new@hire.com" },
    } as never);
    const { onClose, user } = setup();

    await user.type(screen.getByPlaceholderText("name@company.com"), "new@hire.com");
    await user.click(screen.getByRole("button", { name: /Send invitation/ }));

    expect(onClose).toHaveBeenCalled();
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

    await user.type(screen.getByPlaceholderText("name@company.com"), "new@hire.com");
    await user.click(screen.getByRole("button", { name: /Send invitation/ }));

    expect(onClose).not.toHaveBeenCalled();
    expect(screen.getByText(/Invite created/)).toBeInTheDocument();
    expect(screen.getByText(/Pending invites tab/)).toBeInTheDocument();
  });

  it("says so plainly where there is no mailer at all", async () => {
    createInvite.mockResolvedValue({
      ok: true,
      delivery: { sent: false, to: "new@hire.com", reason: "unconfigured" },
    } as never);
    const { user } = setup();

    await user.type(screen.getByPlaceholderText("name@company.com"), "new@hire.com");
    await user.click(screen.getByRole("button", { name: /Send invitation/ }));

    expect(screen.getByText(/Email isn't set up in this environment/)).toBeInTheDocument();
  });
});

/* THE ADDRESS RESOLVES BEFORE ANYTHING IS COMMITTED.

   The screen used to take an address and say nothing about it until the action
   refused, and an unclaimed card holding that address — imported from
   ServiceM8, or pre-seeded — was invisible from here. Attaching to it meant
   knowing to start from the directory row instead: two doors whose difference
   was a duplicate person. */
describe("InviteModal — what that address already means", () => {
  const type = async (user: ReturnType<typeof userEvent.setup>, v: string) =>
    user.type(screen.getByPlaceholderText("name@company.com"), v);

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
    lookupInvitee.mockResolvedValue({
      kind: "card",
      staffProfileId: "card-1",
      name: "Dan Reilly",
      importedFrom: "ServiceM8",
    });
    const { user } = setup();
    await type(user, "dan@reilly.com");

    await waitFor(() =>
      expect(document.body.textContent).toContain(
        "Attaches to Dan Reilly's card (from ServiceM8) — no second record.",
      ),
    );
  });

  /* The button that says "attaches to Dan's card" has to be the button that
     does it — otherwise the line is a description of something else. */
  it("carries the resolved card on the submit", async () => {
    lookupInvitee.mockResolvedValue({
      kind: "card",
      staffProfileId: "card-1",
      name: "Dan Reilly",
      importedFrom: null,
    });
    const { user } = setup();
    await type(user, "dan@reilly.com");
    await waitFor(() => expect(document.body.textContent).toMatch(/Attaches to/));

    await user.click(screen.getByRole("button", { name: /Send invitation/ }));

    expect(createInvite).toHaveBeenCalledWith(
      expect.objectContaining({ email: "dan@reilly.com", staffProfileId: "card-1" }),
    );
  });

  /* A row the reader pointed at is a stronger statement of intent than an
     address lookup, and the action re-checks anything that has gone stale. */
  it("prefers the card the row named over the one the address found", async () => {
    lookupInvitee.mockResolvedValue({
      kind: "card",
      staffProfileId: "found-by-address",
      name: "Someone Else",
      importedFrom: null,
    });
    const { user } = setup(["staff"], { staffProfileId: "from-the-row", name: "Dan Reilly" });
    await type(user, "dan@reilly.com");
    await waitFor(() => expect(lookupInvitee).toHaveBeenCalled());

    await user.click(screen.getByRole("button", { name: /Send invitation/ }));

    expect(createInvite).toHaveBeenCalledWith(
      expect.objectContaining({ staffProfileId: "from-the-row" }),
    );
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
    expect(document.querySelector(".fl-res.warn")).toBeTruthy();
  });

  /* THE RACE THIS SCREEN WOULD OTHERWISE LOSE. A slow reply for a half-typed
     address lands after the reply for the finished one and describes somebody
     else — confidently, in a line the reader believes. */
  it("drops an answer that arrives for an address no longer typed", async () => {
    let releaseFirst: (v: Record<string, unknown>) => void = () => {};
    lookupInvitee
      .mockImplementationOnce(
        () => new Promise<Record<string, unknown>>((res) => (releaseFirst = res)),
      )
      .mockResolvedValue({ kind: "new" });

    const { user } = setup();
    await type(user, "dan@reilly.com");
    await waitFor(() => expect(lookupInvitee).toHaveBeenCalledTimes(1));

    // keep typing: the first request is now for an address nobody is asking about
    await type(user, "x");
    await waitFor(() => expect(lookupInvitee).toHaveBeenCalledTimes(2));

    /* ORDER IS THE WHOLE TEST. The stale answer is released only AFTER the
       fresh one has landed, because that is the sequence that hurts — a reply
       arriving last and overwriting a correct line with somebody else's name.
       Released before it, the fresh answer simply overwrites the stale one and
       the assertion passes whether the guard exists or not. */
    await act(async () => {
      releaseFirst({
        kind: "card",
        staffProfileId: "stale",
        name: "Stale Person",
        importedFrom: null,
      });
    });

    expect(document.body.textContent).not.toContain("Stale Person");
  });
});

/* Two bare words are not a description of a permission, and the choice is made
   HERE — often by someone who has never opened a staff card, which is the only
   other place these sentences appear. */
describe("InviteModal — the roles explain themselves", () => {
  it("describes the selected role, and re-describes it when it changes", async () => {
    const { user } = setup();
    expect(screen.getByText("Field worker — own data only")).toBeInTheDocument();

    await user.selectOptions(screen.getByRole("combobox"), "admin");

    expect(screen.getByText("Manage the team — approve & assign")).toBeInTheDocument();
    expect(screen.queryByText("Field worker — own data only")).not.toBeInTheDocument();
  });
});
