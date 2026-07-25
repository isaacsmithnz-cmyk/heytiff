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
    await user.click(screen.getByRole("button", { name: /Create invite/ }));

    expect(createInvite).toHaveBeenCalledWith({ email: "new@heytiff.co", role: "admin" });
    expect(onClose).toHaveBeenCalled();
    expect(refresh).toHaveBeenCalled();
  });

  it("shows the action's error and stays open", async () => {
    createInvite.mockResolvedValue({ ok: false, error: "You can't invite someone at that role." });
    const { onClose, user } = setup();
    await user.type(screen.getByPlaceholderText("name@company.com"), "new@heytiff.co");
    await user.click(screen.getByRole("button", { name: /Create invite/ }));

    expect(await screen.findByText("You can't invite someone at that role.")).toBeInTheDocument();
    expect(onClose).not.toHaveBeenCalled();
    expect(refresh).not.toHaveBeenCalled();
  });

  it("won't submit an empty email", async () => {
    const { user } = setup();
    await user.click(screen.getByRole("button", { name: /Create invite/ }));
    expect(createInvite).not.toHaveBeenCalled();
  });

  it("closes on the X without inviting anyone", async () => {
    const { onClose, user } = setup();
    await user.click(screen.getByLabelText("Close"));
    expect(onClose).toHaveBeenCalled();
    expect(createInvite).not.toHaveBeenCalled();
  });
});
