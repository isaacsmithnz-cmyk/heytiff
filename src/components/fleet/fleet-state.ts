"use client";

import { useCallback, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import {
  addLog as addLogAction,
  assignVehicle as assignVehicleAction,
  deleteLog as deleteLogAction,
  editLog as editLogAction,
  removeVehicle as removeVehicleAction,
  resolveIssue as resolveIssueAction,
  saveVehicle as saveVehicleAction,
} from "@/app/actions/fleet";
import type { LogEdit } from "@/app/actions/fleet";
import type { StoredDocument } from "@/lib/documents/query";
import type { AiValuation, NewLog, Vehicle, VehicleLog } from "./logic";

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
  saveVehicle: (v: Vehicle, purchaseInvoiceId?: string) => void;
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
    saveVehicle: useCallback(
      (v: Vehicle, purchaseInvoiceId?: string) => run(() => saveVehicleAction(v, purchaseInvoiceId)),
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
