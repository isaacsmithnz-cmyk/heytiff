/* Integrations — the connected-apps index.

   Same object as the admin index one level up, so it is the same shape: a menu
   is rows, one card, hairline-separated, data-driven from PROVIDERS. What it
   adds is a STATE per row, because "Xero" and "Xero, connected to Acme Pty Ltd"
   are different rows to the person reading them.

   No "use client": these are links and a status word. */

import Link from "next/link";
import { Icon } from "@/components/shell/icon";
import { PROVIDERS } from "@/lib/integrations/providers";
import type { ConnectionView } from "@/lib/integrations/connection";

export type IntegrationsIndexProps = {
  /** Connection state per provider id — absent means never connected. */
  connections: Record<string, ConnectionView | undefined>;
};

/** The one line a row says about its state. Kept here rather than inline so
    the three cases stay visibly exhaustive. */
export function statusLabel(conn: ConnectionView | undefined): {
  text: string;
  tone: "on" | "warn" | "off";
} {
  if (!conn) return { text: "Not connected", tone: "off" };
  if (conn.status === "needs_reauth") return { text: "Needs reconnecting", tone: "warn" };
  if (conn.missing.length > 0) return { text: "Reconnect to finish", tone: "warn" };
  return { text: conn.tenantName ?? "Connected", tone: "on" };
}

export function IntegrationsIndex({ connections }: IntegrationsIndexProps) {
  return (
    <div className="page in">
      <div className="wrap">
        <div className="stg adm-stg">
          <div className="v2head" style={{ marginBottom: 10 }}>
            <div>
              <Link href="/dashboard/admin" className="int-back">
                <Icon name="chevL" size={15} />
                Admin
              </Link>
              <h1 style={{ margin: "10px 0 0" }}>
                Integrations
              </h1>
            </div>
          </div>
          <p className="int-lede">
            Apps this workspace is connected to. Connecting one lets HeyTiff read what it needs
            from a system the business already runs on, instead of asking anyone to keep two sets
            of numbers.
          </p>

          <div className="adm-card">
            {PROVIDERS.map((p) => {
              const state = statusLabel(connections[p.id]);
              return (
                <Link
                  className="adm-row"
                  href={`/dashboard/admin/integrations/${p.id}`}
                  key={p.id}
                >
                  <span
                    className="adm-ic"
                    style={{ background: p.accent + "1a", color: p.accent }}
                  >
                    <Icon name={p.icon} size={19} />
                  </span>
                  <span className="adm-main">
                    <b>{p.name}</b>
                    <em>{p.blurb}</em>
                  </span>
                  <span className={"int-pill " + state.tone}>
                    <span className="int-dot" />
                    {state.text}
                  </span>
                  <span className="adm-ch">
                    <Icon name="chevR" size={17} />
                  </span>
                </Link>
              );
            })}
          </div>

          {/* Says what the list is, rather than inventing a roadmap of apps
              nobody has committed to building. */}
          <p className="int-foot">
            More apps will appear here as they&apos;re wired up.
          </p>
        </div>
      </div>
    </div>
  );
}
