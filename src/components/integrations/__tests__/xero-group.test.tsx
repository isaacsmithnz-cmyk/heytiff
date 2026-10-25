import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { ReactElement } from "react";
import { ToastProvider } from "@/components/parts/toast";
import { XeroGroup } from "../xero-group";
import { toView, type ConnectionRow } from "@/lib/integrations/connection";
import { XERO_SCOPES, XERO_SCOPE_LIST } from "@/lib/integrations/providers";

/* Settings › Integrations, the Xero group (v2, 25 October 2026). Someone
   is about to hand over their accounting system, so it refuses to be vague
   about which organisation and about every permission it asks for; and its
   disconnect drops credentials only, so it asks for no name. */

const disconnect = jest.fn();
const setTenant = jest.fn();
const refresh = jest.fn();

jest.mock("@/app/actions/integrations", () => ({
  disconnectXeroAction: (...args: unknown[]) => disconnect(...args),
  setXeroTenantAction: (...args: unknown[]) => setTenant(...args),
}));
jest.mock("@/app/actions/staff-import", () => ({}));
jest.mock("next/navigation", () => ({ useRouter: () => ({ push: jest.fn(), refresh }) }));

const ORG = "Acme Air Pty Ltd";

const row = (over: Partial<ConnectionRow> = {}): ConnectionRow => ({
  id: "c1",
  org_id: "org1",
  provider: "xero",
  status: "connected",
  tenant_id: "t1",
  tenant_name: ORG,
  tenants: [{ tenantId: "t1", tenantName: ORG }],
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
const show = (ui: ReactElement) => render(<ToastProvider>{ui}</ToastProvider>);
type Props = Parameters<typeof XeroGroup>[0];
const group = (props: Partial<Props> = {}) => show(<XeroGroup connection={toView(row())} {...ready} {...props} />);
const dialog = () => screen.getByRole("dialog");
const connectionRow = () => screen.getByText(ORG, { selector: ".st2-sett" }).closest(".st2-set") as HTMLElement;
const lineOf = (el: HTMLElement) => el.querySelector(".st2-sets")?.textContent ?? "";

beforeEach(() => {
  disconnect.mockReset().mockResolvedValue({ ok: true });
  setTenant.mockReset().mockResolvedValue({ ok: true });
  refresh.mockReset();
});

describe("before connecting", () => {
  it("offers Connect, and warns which account consent will use before pointing at the route", async () => {
    const user = userEvent.setup();
    group({ connection: null });
    expect(screen.getByText("Not connected")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /Disconnect/ })).not.toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Connect Xero" }));
    expect(within(dialog()).getByText(/whichever Xero account this browser is already signed in to/i)).toBeInTheDocument();
    // the escape hatch is named, not just the hazard
    expect(within(dialog()).getByText(/private window/i)).toBeInTheDocument();
    expect(within(dialog()).getByRole("link", { name: "Continue to Xero" })).toHaveAttribute("href", "/api/integrations/xero/connect");
  });

  /* The ask is visible BEFORE the button is pressed: the whole argument for
     rendering the list from the array the consent URL is built from. */
  it("shows every permission it will ask for, with its reason and what it is for", () => {
    group({ connection: null });
    for (const s of XERO_SCOPES) {
      expect(screen.getByText(s.scope)).toBeInTheDocument();
      expect(screen.getByText(s.area ? `${s.area}. ${s.why}` : s.why)).toBeInTheDocument();
    }
    // only the areas Xero actually feeds
    expect(screen.queryByText(/Expenses/)).not.toBeInTheDocument();
  });
});

describe("a deployment that isn't set up", () => {
  /* A customer supplies NO Xero credentials, so this reads as ours to
     finish, never as a job the owner has been handed. */
  it("tells the owner there's nothing for them to do", () => {
    group({ connection: null, configured: false, sealed: false });
    expect(screen.getByText(/Nothing for you to set up/)).toBeInTheDocument();
    expect(screen.queryByText(/you need to|supply|enter your Xero/i)).not.toBeInTheDocument();
  });

  it("hides Connect and says which piece is missing", () => {
    const { unmount } = group({ connection: null, configured: false, sealed: true });
    expect(screen.queryByRole("button", { name: "Connect Xero" })).not.toBeInTheDocument();
    expect(screen.getByText(/XERO_CLIENT_ID/)).toBeInTheDocument();
    expect(screen.queryByText(/INTEGRATIONS_TOKEN_KEY/)).not.toBeInTheDocument();
    unmount();
    group({ connection: null, configured: true, sealed: false });
    expect(screen.queryByRole("button", { name: "Connect Xero" })).not.toBeInTheDocument();
    expect(screen.getByText(/INTEGRATIONS_TOKEN_KEY/)).toBeInTheDocument();
  });
});

describe("connected", () => {
  it("names the organisation, who connected it and when, and says it is connected in green", () => {
    group({ connection: toView(row(), "Isaac Smith") });
    expect(lineOf(connectionRow())).toMatch(/^Connected Mon 20 July? 2026 by Isaac Smith\./);
    expect(within(connectionRow()).getByText("Connected").closest(".pt-state")).toHaveClass("pt-state--good");
    // a whole grant has nothing to reconnect for
    expect(screen.queryByRole("button", { name: "Reconnect Xero" })).not.toBeInTheDocument();
  });

  it("makes disconnect take two presses, names what it does and does NOT take, and asks for no name", async () => {
    const user = userEvent.setup();
    group();
    await user.click(screen.getByRole("button", { name: "Disconnect Xero" }));
    expect(disconnect).not.toHaveBeenCalled();
    expect(within(dialog()).getByText(/stored credentials are deleted/i)).toBeInTheDocument();
    // the reassurance is as load-bearing as the warning
    expect(within(dialog()).getByText(/Nothing in Xero itself changes/i)).toBeInTheDocument();
    expect(within(dialog()).getByText(/stay matched/i)).toBeInTheDocument();
    expect(within(dialog()).queryByRole("textbox")).not.toBeInTheDocument();

    await user.click(within(dialog()).getByRole("button", { name: "Disconnect Xero" }));
    await waitFor(() => expect(disconnect).toHaveBeenCalledTimes(1));
    expect(refresh).toHaveBeenCalled();
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  });

  it("lets you back out of disconnecting", async () => {
    const user = userEvent.setup();
    group();
    await user.click(screen.getByRole("button", { name: "Disconnect Xero" }));
    await user.click(within(dialog()).getByRole("button", { name: "Keep it" }));
    expect(disconnect).not.toHaveBeenCalled();
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  });

  it("surfaces a refused disconnect rather than claiming success", async () => {
    disconnect.mockResolvedValue({ ok: false, error: "Only an owner can change connected apps." });
    const user = userEvent.setup();
    group();
    await user.click(screen.getByRole("button", { name: "Disconnect Xero" }));
    await user.click(within(dialog()).getByRole("button", { name: "Disconnect Xero" }));
    expect(await within(dialog()).findByText("Only an owner can change connected apps.")).toBeInTheDocument();
    expect(refresh).not.toHaveBeenCalled();
  });

  it("marks the permissions an older grant predates, opens the list, and offers Reconnect", async () => {
    const user = userEvent.setup();
    group({ connection: toView(row({ scopes: "openid offline_access" })) });
    expect(screen.getAllByText("Not granted yet").length).toBeGreaterThan(0);
    expect(within(connectionRow()).getByText("Missing access").closest(".pt-state")).toHaveClass("pt-state--look");
    await user.click(screen.getByRole("button", { name: "Reconnect Xero" }));
    expect(within(dialog()).getByText(/currently connected to/i)).toHaveTextContent(ORG);
  });

  it("shows the grant's own reason when it needs reconnecting, in red", () => {
    group({ connection: toView(row({ status: "needs_reauth", last_error: "Xero declined to renew." })) });
    expect(lineOf(connectionRow())).toMatch(/^Xero declined to renew\./);
    expect(within(connectionRow()).getByText("Needs reconnecting").closest(".pt-state")).toHaveClass("pt-state--wrong");
  });
});

/* A stored connection can be unexpired and still useless — revoked from
   Xero's own Connected Apps screen. The read is the difference between "we
   have a row" and "the grant actually reads". */
describe("what the grant can actually see", () => {
  it("reports what the live read found, and points at where payroll is matched", () => {
    group({ reach: { ok: true, employees: 9 } });
    expect(lineOf(connectionRow())).toMatch(/9 employees visible in payroll\.$/);
    expect(screen.getByRole("link", { name: "Match payroll in Timesheets" })).toHaveAttribute("href", "/dashboard/team?view=timesheets");
  });

  it("says so plainly when the read failed, rather than showing zero", () => {
    group({ reach: { ok: false, error: "The Xero connection needs reconnecting." } });
    expect(lineOf(connectionRow())).toMatch(/Payroll couldn't be read\.$/);
    expect(lineOf(connectionRow())).not.toMatch(/0 employees/);
    expect(within(connectionRow()).getByText("Can't be read")).toBeInTheDocument();
  });

  it("offers no pointer when the payroll is empty", () => {
    group({ reach: { ok: true, employees: 0 } });
    expect(lineOf(connectionRow())).toMatch(/0 employees visible in payroll\./);
    expect(screen.queryByRole("link", { name: /Timesheets/ })).not.toBeInTheDocument();
  });

  it("says nothing at all when there was no grant to read through", () => {
    group({ connection: null, reach: null });
    expect(screen.queryByText(/visible in payroll|Payroll couldn't be read/)).not.toBeInTheDocument();
  });
});

describe("more than one Xero organisation", () => {
  const many = row({
    tenants: [
      { tenantId: "t1", tenantName: ORG },
      { tenantId: "t2", tenantName: "Acme Plumbing Pty Ltd" },
    ],
  });

  it("stays out of the way when the grant covers only one", () => {
    group();
    expect(screen.queryByRole("combobox", { name: "Xero organisation" })).not.toBeInTheDocument();
  });

  it("picks the books on choosing, with an Undo, and only for a different one", async () => {
    const user = userEvent.setup();
    group({ connection: toView(many) });
    await user.click(screen.getByRole("combobox", { name: "Xero organisation" }));
    await user.click(screen.getByRole("option", { name: "Acme Plumbing Pty Ltd" }));
    await waitFor(() => expect(setTenant).toHaveBeenCalledWith("t2"));
    expect(await screen.findByText("Using Acme Plumbing Pty Ltd")).toBeInTheDocument();
    expect(refresh).toHaveBeenCalled();
    await user.click(screen.getByRole("button", { name: "Undo" }));
    expect(setTenant).toHaveBeenLastCalledWith("t1");
  });
});

describe("the round trip's outcome", () => {
  it("says so when a connection just succeeded", () => {
    group({ notice: { kind: "ok", text: "Xero is connected." } });
    expect(screen.getByText("Xero is connected.").closest("p")).toHaveClass("st2-int-said--good");
  });

  it("says so when it didn't", () => {
    group({ connection: null, notice: { kind: "error", text: "You cancelled the Xero connection, so nothing changed." } });
    expect(screen.getByRole("alert")).toHaveTextContent("You cancelled the Xero connection, so nothing changed.");
  });
});

describe("this organisation is connected elsewhere", () => {
  it("says how many other workspaces hold it, and never blocks", () => {
    group({ elsewhere: 2 });
    expect(screen.getByText(/2 other HeyTiff workspaces/)).toHaveTextContent(/remove HeyTiff's access from inside Xero/);
    expect(screen.getByRole("button", { name: "Disconnect Xero" })).toBeInTheDocument();
  });
});
