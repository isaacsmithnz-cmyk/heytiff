"use client";

import Link from "next/link";
import { useState } from "react";
import { Button } from "@/components/parts/button";
import { Chooser } from "@/components/parts/chooser";
import { StateWord, type Tone } from "@/components/parts/state";
import { useToast } from "@/components/parts/toast";
import { Group, Setting, Wrong } from "@/components/settings/parts";
import { auDayOf, fmtAuWeekdayDate } from "@/lib/au-dates";
import { XERO_SCOPES } from "@/lib/integrations/providers";
import type { ConnectionView } from "@/lib/integrations/connection";
import { disconnectXeroAction, setXeroTenantAction } from "@/app/actions/integrations";
import { ConnectDialog, DisconnectDialog, NotSwitchedOn, Permissions, Said, useIntegrationAct } from "./int-parts";
import { PeopleReview } from "./people-review";
import type { XeroProps, XeroReach } from "./types";

/* SETTINGS › INTEGRATIONS, XERO (v2, 25 October 2026; the mock's Xero
   group). Someone is about to hand over their accounting system, so two
   things here refuse to be vague: which organisation, said on the row with
   its health, and what HeyTiff can see, every permission with the sentence
   that explains it, from the same list the consent URL is built from.

   A disconnect drops credentials only: no mirror to lose, and the staff
   matches survive so a reconnect restores them, so it doesn't ask for the
   name. */

const START = "/api/integrations/xero/connect";

/** The connection's health in one word: green only when it reads. */
export function xeroHealth(connection: ConnectionView | null, reach: XeroReach | null | undefined): { tone: Tone; word: string } | null {
  if (!connection) return null;
  if (connection.status === "needs_reauth") return { tone: "wrong", word: "Needs reconnecting" };
  if (connection.missing.length > 0) return { tone: "look", word: "Missing access" };
  if (reach && !reach.ok) return { tone: "look", word: "Can't be read" };
  return { tone: "good", word: "Connected" };
}

export function XeroGroup({ connection, configured, sealed, notice, reach, people, elsewhere = 0 }: XeroProps) {
  const act = useIntegrationAct();
  const toast = useToast();
  const [dialog, setDialog] = useState<"connect" | "disconnect" | null>(null);
  const [gone, setGone] = useState<string | null>(null);

  const ready = configured && sealed;
  const connected = connection !== null;
  const attention = connection !== null && (connection.status === "needs_reauth" || connection.missing.length > 0);
  const health = xeroHealth(connection, reach);
  const missing = connection?.missing ?? [];
  const short = XERO_SCOPES.filter((s) => missing.includes(s.scope)).length;
  const permsLine = `${XERO_SCOPES.length} permissions${connected ? (short > 0 ? `, ${short} not granted yet` : ", all granted") : ""}`;

  const disconnect = () =>
    act.run(
      "disconnect",
      () => disconnectXeroAction(),
      () => null,
      (note) => {
        setGone(note ?? null);
        setDialog(null);
      },
    );

  /* Which organisation, when the grant covers more than one: it saves on
     pick, and its Undo picks the one before. */
  const pickTenant = (tenantId: string) => {
    const was = connection?.tenantId ?? null;
    const name = connection?.tenants.find((t) => t.tenantId === tenantId)?.tenantName ?? "that organisation";
    if (!was || tenantId === was) return;
    act.run(
      "tenant",
      () => setXeroTenantAction(tenantId),
      () => null,
      () =>
        toast({
          text: `Using ${name}`,
          undo: () => {
            void setXeroTenantAction(was);
          },
        }),
    );
  };

  const line = connection
    ? [
        connection.status === "needs_reauth" ? connection.lastError ?? "This connection needs reconnecting." : null,
        connection.connectedAt
          ? `Connected ${fmtAuWeekdayDate(auDayOf(connection.connectedAt))}${connection.connectedByName ? ` by ${connection.connectedByName}` : ""}.`
          : null,
        /* proof the grant READS, not just that it exists: revoked from
           Xero's own Connected Apps screen, it is still stored and unexpired */
        reach ? (reach.ok ? `${reach.employees} employee${reach.employees === 1 ? "" : "s"} visible in payroll.` : "Payroll couldn't be read.") : null,
      ]
        .filter(Boolean)
        .join(" ")
    : null;

  return (
    <Group
      heading="Xero"
      anchor="xero"
      tools={
        connected && reach?.ok && reach.employees > 0 ? (
          <Link href="/dashboard/team?view=timesheets" className="st2-link">
            Match payroll in Timesheets
          </Link>
        ) : undefined
      }
    >
      {notice && (notice.kind === "error" ? <Wrong>{notice.text}</Wrong> : <Said tone="good">{notice.text}</Said>)}
      {gone && <Said tone="info">{gone}</Said>}

      {connected ? (
        <Setting name={connection.tenantName ?? "Connected"} line={line || undefined}>
          <span className="st2-rowend">
            {health && (
            <StateWord tone={health.tone} className="st2-int-word">
              {health.word}
            </StateWord>
          )}
            {ready && attention && (
              <Button kind="xero" size={32} onClick={() => setDialog("connect")}>
                Reconnect Xero
              </Button>
            )}
            <Button kind="delete" size={32} onClick={() => setDialog("disconnect")}>
              Disconnect Xero
            </Button>
          </span>
        </Setting>
      ) : (
        <Setting name="Not connected">
          {ready && (
            <Button kind="xero" size={32} onClick={() => setDialog("connect")}>
              Connect Xero
            </Button>
          )}
        </Setting>
      )}
      {!ready && (
        <NotSwitchedOn
          label="Xero"
          missing={[...(configured ? [] : ["XERO_CLIENT_ID / XERO_CLIENT_SECRET / APP_BASE_URL"]), ...(sealed ? [] : ["INTEGRATIONS_TOKEN_KEY"])]}
        />
      )}
      {act.error && dialog === null && <Wrong>{act.error}</Wrong>}

      {connected && elsewhere > 0 && (
        <Said tone="info">
          {`This Xero organisation is also connected to ${elsewhere} other HeyTiff workspace${elsewhere === 1 ? "" : "s"}. Each one reads it for itself, and disconnecting here doesn't affect theirs. If that isn't expected, remove HeyTiff's access from inside Xero.`}
        </Said>
      )}

      {connected && connection.tenants.length > 1 && (
        <Setting name="Organisation">
          <Chooser
            className="st2-int-choose"
            aria-label="Xero organisation"
            options={connection.tenants.map((t) => ({ value: t.tenantId, label: t.tenantName }))}
            value={connection.tenantId}
            disabled={act.busy}
            onChange={pickTenant}
          />
        </Setting>
      )}

      {connected && people && <PeopleReview provider="xero" {...people} />}
      <Permissions
        line={permsLine}
        groups={[{ label: "Reads", list: XERO_SCOPES }]}
        connected={connected}
        missing={missing}
        open={!connected || attention}
      />

      {dialog === "connect" && (
        <ConnectDialog label="Xero" startHref={START} accountName={connection?.tenantName ?? null} onClose={() => setDialog(null)} />
      )}
      {dialog === "disconnect" && (
        <DisconnectDialog
          label="Xero"
          accountName={connection?.tenantName ?? null}
          consequences={[
            "HeyTiff's stored credentials are deleted, and Xero is told the authorisation is finished.",
            "Nothing in Xero itself changes: HeyTiff only ever reads it.",
            "Staff matched to payroll employees stay matched, so reconnecting the same organisation restores them.",
          ]}
          busy={act.pending === "disconnect"}
          error={act.error}
          onConfirm={disconnect}
          onClose={() => setDialog(null)}
        />
      )}
    </Group>
  );
}
