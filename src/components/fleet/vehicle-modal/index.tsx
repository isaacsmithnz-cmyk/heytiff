"use client";

import { useEffect, useState } from "react";
import { createPortal } from "react-dom";
import type { StoredDocument } from "@/lib/documents/query";
import { uploadFile } from "@/lib/documents/upload-client";
import type { RenewalReminder } from "@/lib/fleet/reminders";
import type { FleetActions } from "../fleet-state";
import type {
  AiValuation,
  FleetStaff,
  LogKind,
  Vehicle,
  VehicleFinance,
  VehicleLog,
  VehiclePolicy,
} from "../logic";
import type { Screen } from "./derive";
import { FinancialsScreen } from "./financials-screen";
import { MainScreen } from "./main-screen";
import { RenewalScreen } from "./renewal-screen";

/* The vehicle modal: one modal, five screens, one `screen` value.

   It replaces a stack of separate modals — detail, renewal, renewal history —
   that each portalled over the last. A door in the compliance list now moves
   the screen; the back chevron, Cancel and every save move it home. Nothing is
   fetched here: the register hands down everything the vehicle owns (logs,
   documents, policies, valuation) and every write is one of its actions
   followed by router.refresh(), the same as everywhere else in the fleet.

   The two flows the register still owns as their own modals — the vehicle
   form and the log modals — open OVER this one, because they existed first,
   they are used from other screens too, and a fuel docket's scan step is a
   whole modal of its own. */

export type { Screen } from "./derive";

export function VehicleModal({
  vehicle,
  logs,
  eco,
  valuation,
  valuationIsStale,
  documents,
  policies,
  finance,
  reminders,
  staff,
  today,
  fleet,
  initialScreen = "main",
  onClose,
  onEdit,
  onLog,
  onCorrect,
  onServiceHistory,
}: {
  vehicle: Vehicle;
  logs: VehicleLog[];
  eco: Record<string, number>;
  valuation?: AiValuation;
  valuationIsStale?: boolean;
  documents: StoredDocument[];
  policies: VehiclePolicy[];
  finance: VehicleFinance[];
  /** The viewer's own renewal reminders for this vehicle. */
  reminders: RenewalReminder[];
  staff: FleetStaff[];
  today: string;
  fleet: FleetActions;
  initialScreen?: Screen;
  onClose: () => void;
  onEdit: () => void;
  onLog: (kind: LogKind) => void;
  onCorrect: (log: VehicleLog) => void;
  onServiceHistory: () => void;
}) {
  const [screen, setScreen] = useState<Screen>(initialScreen);

  /* Escape leaves the way the back chevron does: a sub-screen goes home, the
     main screen closes. Two presses to get out from anywhere, never a surprise
     dismissal mid-form. */
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== "Escape") return;
      if (screen === "main") onClose();
      else setScreen("main");
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [screen, onClose]);

  const setPhoto = async (file: File) => {
    const up = await uploadFile(file, "vehicle_photo").catch(() => null);
    if (up?.ok) fleet.setVehiclePhoto(vehicle.id, up.file.documentId);
  };

  return createPortal(
    <div className="vm-ov" onClick={onClose}>
      <div className="vm" role="dialog" aria-modal="true" aria-label={vehicle.name || vehicle.plate} onClick={(e) => e.stopPropagation()}>
        {screen === "main" ? (
          <MainScreen
            vehicle={vehicle}
            logs={logs}
            eco={eco}
            valuation={valuation}
            valuationIsStale={valuationIsStale}
            documents={documents}
            policies={policies}
            finance={finance}
            staff={staff}
            today={today}
            error={fleet.error}
            onOpen={(s) => setScreen(s)}
            onServiceHistory={onServiceHistory}
            onEdit={onEdit}
            onRemove={() => {
              fleet.removeVehicle(vehicle.id);
              onClose();
            }}
            onClose={onClose}
            onStatus={(status) => fleet.saveVehicle({ ...vehicle, status })}
            onAssign={(sid) => fleet.assignVehicle(vehicle.id, sid)}
            onLog={onLog}
            onOdometer={(odo) => fleet.addLog({ vehicleId: vehicle.id, kind: "odo", odo })}
            onPhoto={(file) => void setPhoto(file)}
            onResolve={fleet.resolveIssue}
            onCorrect={onCorrect}
          />
        ) : screen === "financials" ? (
          <FinancialsScreen
            vehicle={vehicle}
            today={today}
            valuation={valuation}
            valuationIsStale={valuationIsStale}
            documents={documents}
            policies={policies}
            logs={logs}
            finance={finance}
            pending={fleet.pending}
            error={fleet.error}
            onBack={() => setScreen("main")}
            onSaveVehicle={(v) => fleet.saveVehicle(v)}
            onRecordFinance={(input) => {
              fleet.recordFinance({ ...input, vehicleId: vehicle.id });
              setScreen("main");
            }}
            onAttachFinance={fleet.attachFinanceDocument}
            onAttachInvoice={(documentId) => fleet.attachPurchaseDocument(vehicle.id, documentId)}
          />
        ) : (
          <RenewalScreen
            key={screen}
            vehicle={vehicle}
            kind={screen}
            today={today}
            documents={documents}
            policies={policies}
            pending={fleet.pending}
            error={fleet.error}
            onBack={() => setScreen("main")}
            onSave={(input) => {
              fleet.recordRenewal({ ...input, vehicleId: vehicle.id });
              setScreen("main");
            }}
            onAttach={fleet.attachPolicyDocument}
            reminders={reminders.filter((r) => r.kind === screen)}
            onRemind={(lead, on) => fleet.setRenewalReminder(vehicle.id, screen, lead, on)}
          />
        )}
      </div>
    </div>,
    document.body,
  );
}
