import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { XeroScreen } from "../xero-screen";
import { toView, type ConnectionRow } from "@/lib/integrations/connection";
import { XERO_SCOPES, XERO_SCOPE_LIST } from "@/lib/integrations/providers";

const disconnect = jest.fn();
const setTenant = jest.fn();
const refresh = jest.fn();

jest.mock("@/app/actions/integrations", () => ({
  disconnectXeroAction: (...args: unknown[]) => disconnect(...args),
  setXeroTenantAction: (...args: unknown[]) => setTenant(...args),
}));
jest.mock("next/navigation", () => ({ useRouter: () => ({ push: jest.fn(), refresh }) }));

const row = (over: Partial<ConnectionRow> = {}): ConnectionRow => ({
  id: "c1",
  org_id: "org1",
  provider: "xero",
  status: "connected",
  tenant_id: "t1",
  tenant_name: "Acme Air Pty Ltd",
  tenants: [{ tenantId: "t1", tenantName: "Acme Air Pty Ltd" }],
  scopes: XERO_SCOPE_LIST.join(" "),
  access_token_enc: "v1.a.b.c",
  refresh_token_enc: "v1.d.e.f",
  expires_at: null,
  connected_by_user_id: "auth0|isaac",
  connected_at: "2026-07-20T03:00:00.000Z",
  updated_at: null,
  last_error: null,
  ...over,
});

const ready = { configured: true, sealed: true, notice: null } as const;

beforeEach(() => {
  disconnect.mockReset().mockResolvedValue({ ok: true });
  setTenant.mockReset().mockResolvedValue({ ok: true });
  refresh.mockReset();
});

describe("XeroScreen — before connecting", () => {
  it("offers Connect, and points it at the OAuth route", () => {
    render(<XeroScreen connection={null} {...ready} />);

    const connect = screen.getByText("Connect to Xero").closest("a");
    expect(connect).toHaveAttribute("href", "/api/integrations/xero/connect");
    expect(screen.getByText("Not connected")).toBeInTheDocument();
    expect(screen.queryByText("Disconnect")).not.toBeInTheDocument();
  });

  /* The ask has to be visible BEFORE the button is pressed, not after — that
     is the entire argument for rendering the scope list from the same array
     the consent URL is built from. */
  it("shows every scope it will ask for, with its reason", () => {
    render(<XeroScreen connection={null} {...ready} />);

    for (const s of XERO_SCOPES) {
      expect(screen.getByText(s.scope)).toBeInTheDocument();
      expect(screen.getByText(s.why)).toBeInTheDocument();
    }
  });

  it("names only the areas Xero actually feeds — Expenses joins with its read", () => {
    render(<XeroScreen connection={null} {...ready} />);

    for (const area of ["Time & Pay", "Rate Calculator"]) {
      expect(screen.getAllByText(area).length).toBeGreaterThan(0);
    }
    expect(screen.queryByText("Expenses")).not.toBeInTheDocument();
  });
});

describe("XeroScreen — deployment isn't set up", () => {
  /* A customer supplies NO Xero credentials — one HeyTiff-owned app serves every
     workspace — so this state must read as "ours to finish", never as a job the
     owner has been handed. (The env-var detail below is dev-only; NODE_ENV is
     "test" here, which is why these tests can still see it.) */
  it("tells the owner there's nothing for them to do", () => {
    render(<XeroScreen connection={null} configured={false} sealed={false} notice={null} />);

    expect(screen.getByText(/Nothing for you to set up/)).toBeInTheDocument();
    expect(screen.queryByText(/you need to|supply|enter your Xero/i)).not.toBeInTheDocument();
  });

  it("hides Connect and says which piece is missing", () => {
    render(<XeroScreen connection={null} configured={false} sealed notice={null} />);

    expect(screen.queryByText("Connect to Xero")).not.toBeInTheDocument();
    expect(screen.getByText("XERO_CLIENT_ID")).toBeInTheDocument();
    expect(screen.queryByText("INTEGRATIONS_TOKEN_KEY")).not.toBeInTheDocument();
  });

  it("refuses to connect without a token key, and says why", () => {
    render(<XeroScreen connection={null} configured sealed={false} notice={null} />);

    expect(screen.queryByText("Connect to Xero")).not.toBeInTheDocument();
    expect(screen.getByText("INTEGRATIONS_TOKEN_KEY")).toBeInTheDocument();
  });
});

describe("XeroScreen — connected", () => {
  it("names the linked organisation and who connected it", () => {
    render(<XeroScreen connection={toView(row(), "Isaac Smith")} {...ready} />);

    // twice now: the status heading, and the consent warning naming what
    // this workspace is currently connected to
    expect(screen.getAllByText("Acme Air Pty Ltd").length).toBeGreaterThan(0);
    expect(screen.getByText("Isaac Smith")).toBeInTheDocument();
    expect(screen.getByText("Reconnect")).toBeInTheDocument();
  });

  it("makes disconnect take two clicks", async () => {
    const user = userEvent.setup();
    render(<XeroScreen connection={toView(row())} {...ready} />);

    await user.click(screen.getByText("Disconnect"));
    expect(disconnect).not.toHaveBeenCalled();

    await user.click(screen.getByText("Yes, disconnect"));
    await waitFor(() => expect(disconnect).toHaveBeenCalledTimes(1));
    expect(refresh).toHaveBeenCalled();
  });

  it("lets you back out of disconnecting", async () => {
    const user = userEvent.setup();
    render(<XeroScreen connection={toView(row())} {...ready} />);

    await user.click(screen.getByText("Disconnect"));
    await user.click(screen.getByText("Keep it"));

    expect(disconnect).not.toHaveBeenCalled();
    expect(screen.getByText("Disconnect")).toBeInTheDocument();
  });

  it("surfaces a refused disconnect rather than claiming success", async () => {
    disconnect.mockResolvedValue({ ok: false, error: "Only an owner can change connected apps." });
    const user = userEvent.setup();
    render(<XeroScreen connection={toView(row())} {...ready} />);

    await user.click(screen.getByText("Disconnect"));
    await user.click(screen.getByText("Yes, disconnect"));

    expect(
      await screen.findByText("Only an owner can change connected apps."),
    ).toBeInTheDocument();
    expect(refresh).not.toHaveBeenCalled();
  });

  it("marks the scopes an older grant predates", () => {
    render(<XeroScreen connection={toView(row({ scopes: "openid offline_access" }))} {...ready} />);
    expect(screen.getAllByText("Not granted yet").length).toBeGreaterThan(0);
  });

  it("shows the grant's own error when it needs reconnecting", () => {
    render(
      <XeroScreen
        connection={toView(row({ status: "needs_reauth", last_error: "Xero declined to renew." }))}
        {...ready}
      />,
    );
    expect(screen.getByText("Xero declined to renew.")).toBeInTheDocument();
  });
});

/* A stored connection can be unexpired and still useless — revoked from Xero's
   own Connected Apps screen. The reach line is the difference between "we have
   a row" and "the grant actually reads", and it must not overstate either way. */
describe("XeroScreen — what the grant can actually see", () => {
  it("reports what the live read found", () => {
    render(<XeroScreen connection={toView(row())} configured sealed notice={null} reach={{ ok: true, employees: 9 }} />);
    expect(screen.getByText("9 employees visible")).toBeInTheDocument();
  });

  it("says so plainly when the read failed, rather than showing zero", () => {
    render(
      <XeroScreen
        connection={toView(row())}
        configured
        sealed
        notice={null}
        reach={{ ok: false, error: "The Xero connection needs reconnecting." }}
      />,
    );
    expect(screen.getByText("Couldn't read")).toBeInTheDocument();
    expect(screen.queryByText(/0 employees/)).not.toBeInTheDocument();
  });

  it("points at where the matching happens once there are people to match", () => {
    render(<XeroScreen connection={toView(row())} configured sealed notice={null} reach={{ ok: true, employees: 9 }} />);
    expect(screen.getByText("Time & Pay settings").closest("a")).toHaveAttribute(
      "href",
      "/dashboard/timepay",
    );
  });

  it("offers no such pointer when the payroll is empty", () => {
    render(<XeroScreen connection={toView(row())} configured sealed notice={null} reach={{ ok: true, employees: 0 }} />);
    expect(screen.getByText("0 employees visible")).toBeInTheDocument();
    expect(screen.queryByText("Time & Pay settings")).not.toBeInTheDocument();
  });

  it("shows nothing at all when there was no grant to read through", () => {
    render(<XeroScreen connection={null} configured sealed notice={null} reach={null} />);
    expect(screen.queryByText("Payroll")).not.toBeInTheDocument();
  });
});

describe("XeroScreen — more than one Xero organisation", () => {
  const many = row({
    tenants: [
      { tenantId: "t1", tenantName: "Acme Air Pty Ltd" },
      { tenantId: "t2", tenantName: "Acme Plumbing Pty Ltd" },
    ],
  });

  it("stays out of the way when the grant covers only one", () => {
    render(<XeroScreen connection={toView(row())} {...ready} />);
    expect(screen.queryByText("Xero organisation")).not.toBeInTheDocument();
  });

  it("offers a picker, and only saves a different choice", async () => {
    const user = userEvent.setup();
    render(<XeroScreen connection={toView(many)} {...ready} />);

    // the current one is already selected, so the button has nothing to do
    expect(screen.getByText("Use this organisation")).toBeDisabled();

    await user.click(screen.getByLabelText("Acme Plumbing Pty Ltd"));
    await user.click(screen.getByText("Use this organisation"));

    await waitFor(() => expect(setTenant).toHaveBeenCalledWith("t2"));
    expect(refresh).toHaveBeenCalled();
  });
});

describe("XeroScreen — the redirect's outcome", () => {
  it("says so when a connection just succeeded", () => {
    render(
      <XeroScreen
        connection={toView(row())}
        configured
        sealed
        notice={{ kind: "ok", text: "Xero is connected." }}
      />,
    );
    expect(screen.getByText("Xero is connected.")).toBeInTheDocument();
  });

  it("says so when it didn't", () => {
    render(
      <XeroScreen
        connection={null}
        configured
        sealed
        notice={{ kind: "error", text: "You cancelled the Xero connection, so nothing changed." }}
      />,
    );
    expect(
      screen.getByText("You cancelled the Xero connection, so nothing changed."),
    ).toBeInTheDocument();
  });
});

/* The guards that came out of a real accident: on 2026-08-10 a live business
   ServiceM8 account was connected instead of a dev one, because OAuth follows
   the BROWSER's session and never asks which account you meant — and the
   success notice named nothing, so it looked identical to the right outcome.
   Xero consents the same way, so it carries the same warning. */
describe("XeroScreen — connect and disconnect guards", () => {
  it("warns that the browser session decides the account, before the button", () => {
    render(<XeroScreen connection={null} {...ready} />);
    expect(screen.getByText(/whichever Xero account this browser is already signed in to/i))
      .toBeInTheDocument();
    // the escape hatch is named, not just the hazard
    expect(screen.getByText(/private window/i)).toBeInTheDocument();
  });

  it("names the current account in the warning, so a reconnect can't be blind", () => {
    render(<XeroScreen connection={toView(row())} {...ready} />);
    expect(screen.getByText(/currently connected to/i)).toBeInTheDocument();
  });

  it("spells out what a disconnect does and does NOT take", async () => {
    const user = userEvent.setup();
    render(<XeroScreen connection={toView(row())} {...ready} />);
    await user.click(screen.getByText("Disconnect"));

    expect(screen.getByText(/stored credentials are deleted/i)).toBeInTheDocument();
    // the reassurance is as load-bearing as the warning
    expect(screen.getByText(/Nothing in Xero itself changes/i)).toBeInTheDocument();
    expect(screen.getByText(/stay matched/i)).toBeInTheDocument();
  });

  it("hides Connect and Reconnect while confirming, so the two can't be misclicked", async () => {
    const user = userEvent.setup();
    render(<XeroScreen connection={toView(row())} {...ready} />);
    await user.click(screen.getByText("Disconnect"));

    expect(screen.queryByText("Reconnect")).not.toBeInTheDocument();
  });

  it("does NOT ask Xero to be typed out — no mirror to lose here", async () => {
    const user = userEvent.setup();
    render(<XeroScreen connection={toView(row())} {...ready} />);
    await user.click(screen.getByText("Disconnect"));

    expect(screen.queryByRole("textbox")).not.toBeInTheDocument();
    expect((screen.getByText("Yes, disconnect") as HTMLButtonElement).disabled).toBe(false);
  });
});
