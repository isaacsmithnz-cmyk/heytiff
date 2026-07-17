"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import {
  EMPTY_OVERLAY,
  type FleetOverlay,
  type Vehicle,
  type VehicleLog,
  mergeFleet,
  mergeLogs,
  migrateVehicle,
} from "./logic";

/* localStorage stands in for the backend (matching timepay's ht_tp_* pattern):
   demo vehicles/logs come in as props and the overlay layers prototype edits,
   additions, removals and new logs on top. Read after mount so SSR stays stable. */

const LS_KEY = "ht_fleet_v1";

export type FleetState = {
  hydrated: boolean;
  vehicles: Vehicle[];
  logs: VehicleLog[];
  saveVehicle: (v: Vehicle) => void;
  removeVehicle: (id: string) => void;
  assignVehicle: (id: string, staffId: string | null) => void;
  addLog: (log: Omit<VehicleLog, "id" | "when" | "ago">) => void;
  resolveIssue: (logId: string) => void;
};

/** "Fri 17 Jul" — client-side, event-time only (never during render). */
function whenLabel(): string {
  return new Date()
    .toLocaleDateString("en-NZ", { weekday: "short", day: "numeric", month: "short" })
    .replace(",", "");
}

export function useFleetState(demoVehicles: Vehicle[], demoLogs: VehicleLog[]): FleetState {
  const [overlay, setOverlay] = useState<FleetOverlay>(EMPTY_OVERLAY);
  const [hydrated, setHydrated] = useState(false);

  useEffect(() => {
    try {
      const raw = localStorage.getItem(LS_KEY);
      if (raw) {
        const parsed = { ...EMPTY_OVERLAY, ...(JSON.parse(raw) as Partial<FleetOverlay>) };
        // older prototype builds stored v1 vehicle shapes — backfill v2 fields
        parsed.added = parsed.added.map(migrateVehicle);
        parsed.edited = Object.fromEntries(
          Object.entries(parsed.edited).map(([id, v]) => [id, migrateVehicle(v)]),
        );
        setOverlay(parsed);
      }
    } catch {
      /* corrupt prototype state — start clean */
    }
    setHydrated(true);
  }, []);

  const update = useCallback((fn: (prev: FleetOverlay) => FleetOverlay) => {
    setOverlay((prev) => {
      const next = fn(prev);
      try {
        localStorage.setItem(LS_KEY, JSON.stringify(next));
      } catch {
        /* storage full/blocked — keep in-memory state */
      }
      return next;
    });
  }, []);

  const vehicles = useMemo(() => mergeFleet(demoVehicles, overlay), [demoVehicles, overlay]);
  const logs = useMemo(() => mergeLogs(demoLogs, overlay), [demoLogs, overlay]);

  const demoIds = useMemo(() => new Set(demoVehicles.map((v) => v.id)), [demoVehicles]);

  const saveVehicle = useCallback(
    (v: Vehicle) => {
      update((o) =>
        demoIds.has(v.id)
          ? { ...o, edited: { ...o.edited, [v.id]: v } }
          : { ...o, added: [...o.added.filter((a) => a.id !== v.id), v] },
      );
    },
    [update, demoIds],
  );

  const removeVehicle = useCallback(
    (id: string) => {
      update((o) => ({
        ...o,
        removed: [...o.removed, id],
        added: o.added.filter((a) => a.id !== id),
        logs: o.logs.filter((l) => l.vehicleId !== id),
      }));
    },
    [update],
  );

  const assignVehicle = useCallback(
    (id: string, staffId: string | null) => {
      const v = vehicles.find((x) => x.id === id);
      if (v) saveVehicle({ ...v, assignedTo: staffId });
    },
    [vehicles, saveVehicle],
  );

  const addLog = useCallback(
    (log: Omit<VehicleLog, "id" | "when" | "ago">) => {
      const stamped: VehicleLog = { ...log, id: `pl-${Date.now()}`, when: whenLabel(), ago: 0 };
      update((o) => ({ ...o, logs: [stamped, ...o.logs] }));
      const v = vehicles.find((x) => x.id === log.vehicleId);
      if (!v || typeof log.odo !== "number") return;
      if (log.kind === "service") {
        // a completed service resets the cycle from its odo reading
        saveVehicle({ ...v, lastServiceOdo: log.odo, odometer: Math.max(v.odometer, log.odo) });
      } else if (log.odo > v.odometer) {
        // fuel/odo entries carry a reading — roll the vehicle's odometer forward
        saveVehicle({ ...v, odometer: log.odo });
      }
    },
    [update, vehicles, saveVehicle],
  );

  const resolveIssue = useCallback(
    (logId: string) => {
      update((o) =>
        o.logs.some((l) => l.id === logId)
          ? {
              ...o,
              logs: o.logs.map((l) => (l.id === logId ? { ...l, status: "resolved" as const } : l)),
            }
          : { ...o, resolved: [...o.resolved, logId] },
      );
    },
    [update],
  );

  return { hydrated, vehicles, logs, saveVehicle, removeVehicle, assignVehicle, addLog, resolveIssue };
}
