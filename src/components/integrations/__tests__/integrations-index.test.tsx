import { render, screen } from "@testing-library/react";
import { IntegrationsIndex, statusLabel } from "../integrations-index";
import { toView, type ConnectionRow } from "@/lib/integrations/connection";
import { XERO_SCOPE_LIST } from "@/lib/integrations/providers";

const row = (over: Partial<ConnectionRow> = {}): ConnectionRow => ({
  id: "c1",
  org_id: "org1",
  provider: "xero",
  status: "connected",
  tenant_id: "t1",
  tenant_name: "Acme Air Pty Ltd",
  tenants: [],
  scopes: XERO_SCOPE_LIST.join(" "),
  access_token_enc: null,
  refresh_token_enc: null,
  expires_at: null,
  connected_by_user_id: null,
  connected_at: null,
  updated_at: null,
  last_error: null,
  ...over,
});

describe("statusLabel", () => {
  it("says what a row's state is, in one word each", () => {
    expect(statusLabel(undefined)).toEqual({ text: "Not connected", tone: "off" });
    expect(statusLabel(toView(row()))).toEqual({ text: "Acme Air Pty Ltd", tone: "on" });
    expect(statusLabel(toView(row({ status: "needs_reauth" })))).toEqual({
      text: "Needs reconnecting",
      tone: "warn",
    });
  });

  /* A grant that predates a scope we now ask for still "works", so it would
     otherwise read as fine right up until the first call that needs it. */
  it("warns when a live grant is missing scopes we now ask for", () => {
    expect(statusLabel(toView(row({ scopes: "openid offline_access" })))).toEqual({
      text: "Reconnect to finish",
      tone: "warn",
    });
  });
});

describe("IntegrationsIndex", () => {
  it("lists every provider and links each into its screen", () => {
    render(<IntegrationsIndex connections={{}} />);

    expect(screen.getByText("Xero").closest("a")).toHaveAttribute(
      "href",
      "/dashboard/admin/integrations/xero",
    );
    expect(screen.getByText("ServiceM8").closest("a")).toHaveAttribute(
      "href",
      "/dashboard/admin/integrations/servicem8",
    );
    // One "Not connected" pill per provider row — the count IS the assertion.
    expect(screen.getAllByText("Not connected")).toHaveLength(2);
  });

  it("names the connected Xero organisation on its row only", () => {
    render(<IntegrationsIndex connections={{ xero: toView(row()) }} />);

    expect(screen.getByText("Acme Air Pty Ltd")).toBeInTheDocument();
    // ServiceM8's row still reads as unconnected — states don't bleed across.
    expect(screen.getAllByText("Not connected")).toHaveLength(1);
  });

  it("offers a way back to Admin", () => {
    render(<IntegrationsIndex connections={{}} />);
    expect(screen.getByText("Admin").closest("a")).toHaveAttribute("href", "/dashboard/admin");
  });
});
