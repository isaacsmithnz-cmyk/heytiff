"use server";

import { auth0 } from "@/lib/auth0";
import { can } from "@/lib/permissions-server";
import { getConnectionView } from "@/lib/integrations/store";
import { loadMaintenanceBoard } from "@/lib/workboard/board-query";
import { agreementCardOf, visitCardOf, type AgreementCard, type VisitCard } from "@/lib/workboard/maintenance-cards";
import { getSm8Timezone } from "@/lib/workboard/query";
import { todayInZone } from "@/lib/workboard/dates";

/* A MAINTENANCE VISIT OR A SERVICE AGREEMENT, opened where you are.

   The record host (components/records) opens a job by asking the mirror for
   its row; a visit and an agreement have no row of their own to ask for, so
   their card is built from the maintenance board's own dataset
   (lib/workboard/maintenance-cards) — the same facts the board hands its
   sheet. The board is read whole, as the Workboard reads it: one card is not
   worth a second set of queries that could disagree with the board's.

   Gated as the Workboard is: `workboard` to read. What the card then offers
   is the card's own business, from the grants the frame already holds. */

export type MaintenanceCardRead =
  | { kind: "visit"; card: VisitCard }
  | { kind: "agreement"; card: AgreementCard };

export async function openMaintenanceCard(
  kind: "visit" | "agreement",
  id: string,
): Promise<MaintenanceCardRead | null> {
  const session = await auth0.getSession();
  const orgId = session?.orgId as string | undefined;
  if (!orgId || !(await can("workboard"))) return null;
  const want = typeof id === "string" ? id.trim().slice(0, 80) : "";
  if (!want || (kind !== "visit" && kind !== "agreement")) return null;

  const view = await getConnectionView(orgId, "servicem8");
  const timezone = view ? await getSm8Timezone(orgId) : null;
  const today = todayInZone(timezone);
  const board = await loadMaintenanceBoard(orgId, today);

  if (kind === "visit") {
    const card = visitCardOf(board, want, today, view !== null);
    return card ? { kind, card } : null;
  }
  const card = agreementCardOf(board, want, today);
  return card ? { kind, card } : null;
}
