import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { InviteModal } from "../invite-modal";

/* createInvite is a server action — mocked, never called for real. The modal's
   whole job is: offer only the roles the server allowed, hand the action the
   two values, and be honest about what came back. */
const createInvite = jest.fn(async () => ({ ok: true }) as { ok: boolean; error?: string });
jest.mock("@/app/actions/invite", () => ({ createInvite: (...a: unknown[]) => createInvite(...(a as [])) }));

const refresh = jest.fn();
jest.mock("next/navigation", () => ({ useRouter: () => ({ push: jest.fn(), refresh }) }));

beforeEach(() => {
  createInvite.mockClear();
  createInvite.mockResolvedValue({ ok: true });
  refresh.mockClear();
});

function setup(roles: string[] = ["admin", "staff"]) {
  const onClose = jest.fn();
  render(<InviteModal roles={roles} onClose={onClose} />);
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

  it("submits the email and role, then closes and refreshes", async () => {
    const { onClose, user } = setup();
    await user.type(screen.getByPlaceholderText("name@company.com"), "new@heytiff.co");
    await user.selectOptions(screen.getByRole("combobox"), "admin");
    await user.click(screen.getByRole("button", { name: /Send invitation/ }));

    expect(createInvite).toHaveBeenCalledWith({ email: "new@heytiff.co", role: "admin" });
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
      staffProfileId: "card-7",
    });
  });

  it("a plain invite still submits without any card id", async () => {
    const { user } = setup(["staff"]);
    await user.type(screen.getByPlaceholderText("name@company.com"), "new@heytiff.co");
    await user.click(screen.getByRole("button", { name: /Send invitation/ }));

    expect(createInvite).toHaveBeenCalledWith({
      email: "new@heytiff.co",
      role: "staff",
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
