"use client";

import { useCallback, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import {
  addLog as addLogAction,
  assignVehicle as assignVehicleAction,
  attachFinanceDocument as attachFinanceDocumentAction,
  attachPolicyDocument as attachPolicyDocumentAction,
  attachPurchaseDocument as attachPurchaseDocumentAction,
  deleteLog as deleteLogAction,
  editLog as editLogAction,
  recordFinance as recordFinanceAction,
  recordRenewal as recordRenewalAction,
  removeVehicle as removeVehicleAction,
  resolveIssue as resolveIssueAction,
  saveVehicle as saveVehicleAction,
  setRenewalReminder as setRenewalReminderAction,
  setVehiclePhoto as setVehiclePhotoAction,
} from "@/app/actions/fleet";
import type { FinanceInput, LogEdit, RenewalInput } from "@/app/actions/fleet";
import type { StoredDocument } from "@/lib/documents/query";
import type { RenewalReminder } from "@/lib/fleet/reminders";
import type { AiValuation, NewLog, RenewalKind, Vehicle, VehicleFinance, VehicleLog, VehiclePolicy } from "./logic";

/* Fleet state. The localStorage overlay (ht_fleet_v1) is gone — server data
   arrives as props and every mutation is a server action followed by
   router.refresh(), which re-runs the page's query and re-renders with what
   the database actually stored.

   Why no optimistic local copy: the server owns derivations the client can't
   reproduce honestly (the odometer roll-forward, the service-cycle reset) and
   refusals the client shouldn't pre-empt. Showing a guess and correcting it a
   moment later is how a rejected log briefly looks accepted. Actions carry a
   `pending` flag instead, and `error` surfaces the server's refusal verbatim. */

export type FleetActions = {
  pending: boolean;
  error: string | null;
  clearError: () => void;
  saveVehicle: (v: Vehicle, purchaseInvoiceId?: string, initialRenewal?: Omit<RenewalInput, "vehicleId">) => void;
  recordRenewal: (input: RenewalInput) => void;
  /** Files another piece of paper under a renewal that already exists. */
  attachPolicyDocument: (policyId: string, documentId: string) => void;
  /** The photo on the card — an already-uploaded vehicle_photo document. */
  setVehiclePhoto: (vehicleId: string, documentId: string) => void;
  /** A finance agreement, scanned or typed; the newest becomes the one in force. */
  recordFinance: (input: FinanceInput) => void;
  /** Another piece of paper under an agreement that already exists. */
  attachFinanceDocument: (financeId: string, documentId: string) => void;
  /** A purchase invoice filed against the vehicle from the Financials screen. */
  attachPurchaseDocument: (vehicleId: string, documentId: string) => void;
  /** A REMIND ME chip: on creates the viewer's reminder task, off deletes it. */
  setRenewalReminder: (vehicleId: string, kind: RenewalKind, leadDays: number, on: boolean) => void;
  removeVehicle: (id: string) => void;
  assignVehicle: (id: string, staffId: string | null) => void;
  addLog: (log: NewLog) => void;
  editLog: (logId: string, patch: LogEdit) => void;
  deleteLog: (logId: string) => void;
  resolveIssue: (logId: string) => void;
};

/** The register's view: the whole payload plus the actions. The staff lens
    deliberately takes neither — it gets its own narrow props. */
export type FleetState = FleetActions & {
  vehicles: Vehicle[];
  logs: VehicleLog[];
  aiValues: Record<string, AiValuation>;
  documents: Record<string, StoredDocument[]>;
  policies: Record<string, VehiclePolicy[]>;
  /** Finance agreements on file, per vehicle, newest first. */
  finance: Record<string, VehicleFinance[]>;
  /** The viewer's own renewal reminders, per vehicle. */
  reminders: Record<string, RenewalReminder[]>;
};

type Result = { ok: true } | { ok: false; error: string };

export function useFleetActions(): FleetActions {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [error, setError] = useState<string | null>(null);

  const run = useCallback(
    (action: () => Promise<Result>) => {
      setError(null);
      start(async () => {
        const res = await action();
        if (res.ok) router.refresh();
        else setError(res.error);
      });
    },
    [router],
  );

  return {
    pending,
    error,
    clearError: useCallback(() => setError(null), []),
    recordRenewal: useCallback((input: RenewalInput) => run(() => recordRenewalAction(input)), [run]),
    saveVehicle: useCallback(
      (v: Vehicle, purchaseInvoiceId?: string, initialRenewal?: Omit<RenewalInput, "vehicleId">) =>
        run(() => saveVehicleAction(v, purchaseInvoiceId, initialRenewal)),
      [run],
    ),
    attachPolicyDocument: useCallback(
      (policyId: string, documentId: string) => run(() => attachPolicyDocumentAction(policyId, documentId)),
      [run],
    ),
    setVehiclePhoto: useCallback(
      (vehicleId: string, documentId: string) => run(() => setVehiclePhotoAction(vehicleId, documentId)),
      [run],
    ),
    recordFinance: useCallback((input: FinanceInput) => run(() => recordFinanceAction(input)), [run]),
    attachFinanceDocument: useCallback(
      (financeId: string, documentId: string) => run(() => attachFinanceDocumentAction(financeId, documentId)),
      [run],
    ),
    attachPurchaseDocument: useCallback(
      (vehicleId: string, documentId: string) => run(() => attachPurchaseDocumentAction(vehicleId, documentId)),
      [run],
    ),
    setRenewalReminder: useCallback(
      (vehicleId: string, kind: RenewalKind, leadDays: number, on: boolean) =>
        run(() => setRenewalReminderAction(vehicleId, kind, leadDays, on)),
      [run],
    ),
    removeVehicle: useCallback((id: string) => run(() => removeVehicleAction(id)), [run]),
    assignVehicle: useCallback(
      (id: string, staffId: string | null) => run(() => assignVehicleAction(id, staffId)),
      [run],
    ),
    addLog: useCallback((log: NewLog) => run(() => addLogAction(log)), [run]),
    editLog: useCallback(
      (logId: string, patch: LogEdit) => run(() => editLogAction(logId, patch)),
      [run],
    ),
    deleteLog: useCallback((logId: string) => run(() => deleteLogAction(logId)), [run]),
    resolveIssue: useCallback((logId: string) => run(() => resolveIssueAction(logId)), [run]),
  };
}
