import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { Servicem8Screen } from "../servicem8-screen";
import { toView, type ConnectionRow } from "@/lib/integrations/connection";
import { SM8_SCOPE_LIST } from "@/lib/integrations/providers";

/* The ServiceM8 screen's guards, which are STRICTER than Xero's for one
   reason: disconnecting here deletes a whole mirror of somebody's client
   book, where Xero's drops credentials only.

   Both halves come from a real accident (2026-08-10): a live business account
   was connected instead of a dev one, because OAuth authorises whichever
   account the BROWSER is signed into and never asks — and the success notice
   named nothing, so the wrong account looked exactly like the right one. */

const disconnect = jest.fn();
const syncNow = jest.fn();
const refresh = jest.fn();

jest.mock("@/app/actions/integrations", () => ({
  disconnectServiceM8Action: (...args: unknown[]) => disconnect(...args),
  syncServiceM8NowAction: (...args: unknown[]) => syncNow(...args),
}));
jest.mock("next/navigation", () => ({ useRouter: () => ({ push: jest.fn(), refresh }) }));

const ACCOUNT = "Diamond Air Solutions Pty LTD";

const row = (over: Partial<ConnectionRow> = {}): ConnectionRow => ({
  id: "c1",
  org_id: "org1",
  provider: "servicem8",
  status: "connected",
  tenant_id: "v1",
  tenant_name: ACCOUNT,
  tenants: [{ tenantId: "v1", tenantName: ACCOUNT }],
  scopes: SM8_SCOPE_LIST.join(" "),
  access_token_enc: "v1.a.b.c",
  refresh_token_enc: "v1.d.e.f",
  expires_at: null,
  connected_by_user_id: "auth0|isaac",
  connected_at: "2026-08-10T10:25:00.000Z",
  updated_at: null,
  last_error: null,
  ...over,
});

const ready = { configured: true, sealed: true, notice: null } as const;

const openConfirm = async (user: ReturnType<typeof userEvent.setup>) =>
  user.click(screen.getByText("Disconnect"));

beforeEach(() => {
  disconnect.mockReset().mockResolvedValue({ ok: true });
  syncNow.mockReset().mockResolvedValue({ ok: true });
  refresh.mockReset();
});

describe("before connecting", () => {
  it("warns which account consent will use — before the button, not after", () => {
    render(<Servicem8Screen connection={null} {...ready} />);

    expect(
      screen.getByText(/whichever ServiceM8 account this browser is already signed in to/i),
    ).toBeInTheDocument();
    expect(screen.getByText(/won't ask you to choose/i)).toBeInTheDocument();
    // and how to avoid it, not just that it happens
    expect(screen.getByText(/private window/i)).toBeInTheDocument();
  });

  it("has nothing to disconnect", () => {
    render(<Servicem8Screen connection={null} {...ready} />);
    expect(screen.queryByText("Disconnect")).not.toBeInTheDocument();
  });
});

describe("connected — the warning names the account", () => {
  it("says what this workspace is currently connected to, so a reconnect isn't blind", () => {
    render(<Servicem8Screen connection={toView(row())} {...ready} />);
    expect(screen.getByText(/currently connected to/i)).toBeInTheDocument();
    expect(screen.getAllByText(ACCOUNT).length).toBeGreaterThan(1);
  });
});

describe("disconnect — the only control here that deletes", () => {
  it("spells out that the mirror goes too, and that a reconnect rebuilds it", async () => {
    const user = userEvent.setup();
    render(<Servicem8Screen connection={toView(row())} {...ready} />);
    await openConfirm(user);

    expect(screen.getByText(/Every mirrored row goes with them/i)).toBeInTheDocument();
    expect(screen.getByText(/rebuilds the mirror/i)).toBeInTheDocument();
    // ServiceM8 has no revoke endpoint — the one step we can't do for them
    expect(screen.getByText(/add-ons/i)).toBeInTheDocument();
  });

  it("refuses until the account name is typed", async () => {
    const user = userEvent.setup();
    render(<Servicem8Screen connection={toView(row())} {...ready} />);
    await openConfirm(user);

    const go = screen.getByText("Yes, disconnect") as HTMLButtonElement;
    expect(go.disabled).toBe(true);

    await user.click(go);
    expect(disconnect).not.toHaveBeenCalled();

    await user.type(screen.getByRole("textbox"), ACCOUNT);
    expect((screen.getByText("Yes, disconnect") as HTMLButtonElement).disabled).toBe(false);

    await user.click(screen.getByText("Yes, disconnect"));
    await waitFor(() => expect(disconnect).toHaveBeenCalledTimes(1));
  });

  it("refuses a name that is merely close", async () => {
    const user = userEvent.setup();
    render(<Servicem8Screen connection={toView(row())} {...ready} />);
    await openConfirm(user);

    await user.type(screen.getByRole("textbox"), "Diamond Air");
    expect((screen.getByText("Yes, disconnect") as HTMLButtonElement).disabled).toBe(true);
    expect(disconnect).not.toHaveBeenCalled();
  });

  it("accepts the name in any case, with tidy spacing — it's a read-this check, not a typing test", async () => {
    const user = userEvent.setup();
    render(<Servicem8Screen connection={toView(row())} {...ready} />);
    await openConfirm(user);

    await user.type(screen.getByRole("textbox"), "  diamond air solutions pty ltd ");
    expect((screen.getByText("Yes, disconnect") as HTMLButtonElement).disabled).toBe(false);
  });

  it("hides Reconnect while confirming, so the two can't be misclicked", async () => {
    const user = userEvent.setup();
    render(<Servicem8Screen connection={toView(row())} {...ready} />);
    await openConfirm(user);

    expect(screen.queryByText("Reconnect")).not.toBeInTheDocument();
  });

  it("lets you back out, and clears what was typed", async () => {
    const user = userEvent.setup();
    render(<Servicem8Screen connection={toView(row())} {...ready} />);
    await openConfirm(user);

    await user.type(screen.getByRole("textbox"), ACCOUNT);
    await user.click(screen.getByText("Keep it"));
    expect(disconnect).not.toHaveBeenCalled();

    // reopening must not arrive pre-armed from the last attempt
    await openConfirm(user);
    expect((screen.getByRole("textbox") as HTMLInputElement).value).toBe("");
    expect((screen.getByText("Yes, disconnect") as HTMLButtonElement).disabled).toBe(true);
  });

  it("surfaces a refused disconnect rather than claiming success", async () => {
    disconnect.mockResolvedValue({ ok: false, error: "Only an owner can change connected apps." });
    const user = userEvent.setup();
    render(<Servicem8Screen connection={toView(row())} {...ready} />);
    await openConfirm(user);

    await user.type(screen.getByRole("textbox"), ACCOUNT);
    await user.click(screen.getByText("Yes, disconnect"));

    expect(
      await screen.findByText("Only an owner can change connected apps."),
    ).toBeInTheDocument();
    expect(refresh).not.toHaveBeenCalled();
  });
});

/* Shared accounts are legitimate and invisible — every uniqueness rule in the
   integrations area is scoped to ONE workspace, so a second workspace can
   mirror this same account and nothing would ever say so. This line says so.
   It informs; it never blocks, because refusing would strand people who share
   an account on purpose. */
describe("this account is connected elsewhere", () => {
  it("says how many other workspaces hold it, and what that means", () => {
    render(<Servicem8Screen connection={toView(row())} elsewhere={2} {...ready} />);

    expect(screen.getByText(/2 other HeyTiff workspaces/)).toBeInTheDocument();
    expect(screen.getByText(/mirrors its own copy/i)).toBeInTheDocument();
    // the reassurance that stops it reading as "your data is at risk here"
    expect(screen.getByText(/disconnecting here doesn't affect theirs/i)).toBeInTheDocument();
    // and the one action that actually ends someone else's access
    expect(screen.getByText(/remove HeyTiff's access from inside ServiceM8/i)).toBeInTheDocument();
  });

  it("says workspace, singular, for one", () => {
    render(<Servicem8Screen connection={toView(row())} elsewhere={1} {...ready} />);
    expect(screen.getByText(/1 other HeyTiff workspace$/)).toBeInTheDocument();
  });

  it("stays silent for the ordinary case", () => {
    render(<Servicem8Screen connection={toView(row())} elsewhere={0} {...ready} />);
    expect(screen.queryByText(/other HeyTiff workspace/)).not.toBeInTheDocument();
  });

  it("never blocks — Reconnect and Disconnect are both still offered", () => {
    render(<Servicem8Screen connection={toView(row())} elsewhere={3} {...ready} />);
    expect(screen.getByText("Reconnect")).toBeInTheDocument();
    expect(screen.getByText("Disconnect")).toBeInTheDocument();
  });

  it("gets out of the way once you are confirming a disconnect", async () => {
    const user = userEvent.setup();
    render(<Servicem8Screen connection={toView(row())} elsewhere={2} {...ready} />);
    await user.click(screen.getByText("Disconnect"));

    // the confirm has its own consequences to read; two notices compete
    expect(screen.queryByText(/other HeyTiff workspaces/)).not.toBeInTheDocument();
  });
});
