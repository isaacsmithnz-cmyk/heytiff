"use client";

import { useEffect, useState } from "react";
import { createPortal } from "react-dom";
import { scanInProgress } from "@/components/record-modal/scan-card";
import type { StoredDocument } from "@/lib/documents/query";
import { uploadFile } from "@/lib/documents/upload-client";
import type { FleetActions } from "../fleet-state";
import type {
  AiValuation,
  FleetStaff,
  Vehicle,
  VehicleFinance,
  VehicleLog,
  VehiclePolicy,
} from "../logic";
import { addKindOf, addScreen, isAddScreen, isLogScreen, logIdOf, logScreen, type Screen } from "./derive";
import { EntryScreen } from "./entry-screen";
import { FinancialsScreen } from "./financials-screen";
import { LogScreen } from "./log-screen";
import { MainScreen } from "./main-screen";
import { RenewalScreen } from "./renewal-screen";
import { ServicesScreen } from "./services-screen";
import { SubHeader } from "@/components/record-modal/parts";

/* The vehicle modal: one modal, eight kinds of screen, one `screen` value.

   It replaces a stack of separate modals — detail, renewal, renewal history,
   the service history, and now logging — that each portalled over the last.
   A door in the compliance list moves the screen, a row in the history opens
   the entry it names, the + menu opens a logging screen, and the back
   chevron, Cancel and every save move it back. Nothing is fetched here: the
   register hands down everything the vehicle owns (logs, documents,
   policies, valuation) and every write is one of its actions followed by
   router.refresh(), the same as everywhere else in the fleet.

   The two flows the register still owns as their own modals — the vehicle
   form and the correction — open OVER this one, because they existed first
   and the form is used from the register's own Add vehicle too.

   THE WAY BACK IS ONE STEP DEEP. An entry can be opened from the card's
   history or from the services screen, and Back returns to whichever it
   was; the services screen goes back to the card. `from` remembers the one
   screen underneath — a trail would be a second navigation model for a modal
   that is at most two screens deep. */

export type { Screen } from "./derive";
export { addScreen, logScreen } from "./derive";

export function VehicleModal({
  vehicle,
  logs,
  eco,
  valuation,
  valuationIsStale,
  documents,
  policies,
  finance,
  staff,
  today,
  warnDays,
  fleet,
  initialScreen = "main",
  onClose,
  onEdit,
  onCorrect,
}: {
  vehicle: Vehicle;
  logs: VehicleLog[];
  eco: Record<string, number>;
  valuation?: AiValuation;
  valuationIsStale?: boolean;
  documents: StoredDocument[];
  policies: VehiclePolicy[];
  finance: VehicleFinance[];
  staff: FleetStaff[];
  today: string;
  warnDays: number;
  fleet: FleetActions;
  initialScreen?: Screen;
  onClose: () => void;
  onEdit: () => void;
  onCorrect: (log: VehicleLog) => void;
}) {
  const [screen, setScreen] = useState<Screen>(initialScreen);
  /* Where Back goes. A service entry the register reopens (after a
     correction) belongs under the services screen; everything else under the
     card. Opening a screen from another sets it. */
  const [from, setFrom] = useState<Screen>(() => {
    if (!isLogScreen(initialScreen)) return "main";
    return logs.find((l) => l.id === logIdOf(initialScreen))?.kind === "service" ? "services" : "main";
  });
  const open = (next: Screen) => {
    setFrom(screen);
    setScreen(next);
  };
  const back = () => {
    setScreen(from);
    setFrom("main");
  };

  /* Escape leaves the way the back chevron does: a sub-screen goes back, the
     main screen closes. Two or three presses to get out from anywhere, never a
     surprise dismissal mid-form. While a scan is in progress it does nothing,
     and nor does a click on the backdrop: the renewal and financials screens
     hold the scan panel, and leaving one threw away a document already read
     and uploaded — see scanInProgress. The back chevron still goes back. */
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== "Escape") return;
      if (scanInProgress()) return;
      if (screen === "main") onClose();
      else {
        setScreen(from);
        setFrom("main");
      }
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [screen, from, onClose]);

  const setPhoto = async (file: File) => {
    const up = await uploadFile(file, "vehicle_photo").catch(() => null);
    if (up?.ok) fleet.setVehiclePhoto(vehicle.id, up.file.documentId);
  };

  return createPortal(
    <div className="vm-ov" onClick={() => (scanInProgress() ? undefined : onClose())}>
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
            warnDays={warnDays}
            error={fleet.error}
            onOpen={open}
            onEdit={onEdit}
            onRemove={() => {
              fleet.removeVehicle(vehicle.id);
              onClose();
            }}
            onClose={onClose}
            onStatus={(status) => fleet.saveVehicle({ ...vehicle, status })}
            onAssign={(sid) => fleet.assignVehicle(vehicle.id, sid)}
            onOdometer={(odo) => fleet.addLog({ vehicleId: vehicle.id, kind: "odo", odo })}
            onPhoto={(file) => void setPhoto(file)}
          />
        ) : screen === "services" ? (
          <ServicesScreen
            vehicle={vehicle}
            logs={logs}
            today={today}
            warnDays={warnDays}
            error={fleet.error}
            onBack={back}
            onLog={() => open(addScreen("service"))}
            onOpen={(log) => open(logScreen(log.id))}
          />
        ) : isAddScreen(screen) ? (
          <LogScreen
            key={screen}
            vehicle={vehicle}
            kind={addKindOf(screen)}
            today={today}
            pending={fleet.pending}
            error={fleet.error}
            onBack={back}
            onSave={(log) => {
              fleet.addLog(log);
              back();
            }}
          />
        ) : isLogScreen(screen) ? (
          (() => {
            const entry = logs.find((l) => l.id === logIdOf(screen));
            return entry ? (
              <EntryScreen
                vehicle={vehicle}
                log={entry}
                eco={eco[entry.id]}
                documents={documents}
                today={today}
                error={fleet.error}
                onBack={back}
                onCorrect={onCorrect}
                onResolve={fleet.resolveIssue}
                onAttach={fleet.attachLogDocument}
              />
            ) : (
              /* Removed from under us — a correction that deleted it, another
                 tab. Nothing to show but the way back. */
              <>
                <SubHeader eyebrow={vehicle.name || vehicle.plate} title="Entry" onBack={back} />
                <div className="vm-body">
                  <div className="vm-empty">That entry is no longer in the history.</div>
                </div>
              </>
            );
          })()
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
            onBack={back}
            onSaveVehicle={(v) => fleet.saveVehicle(v)}
            onRecordFinance={(input) => {
              fleet.recordFinance({ ...input, vehicleId: vehicle.id });
              back();
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
            warnDays={warnDays}
            documents={documents}
            policies={policies}
            pending={fleet.pending}
            error={fleet.error}
            onBack={back}
            onSave={(input) => {
              fleet.recordRenewal({ ...input, vehicleId: vehicle.id });
              back();
            }}
            onAttach={fleet.attachPolicyDocument}
          />
        )}
      </div>
    </div>,
    document.body,
  );
}
