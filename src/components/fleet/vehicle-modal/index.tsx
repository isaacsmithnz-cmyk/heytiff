"use client";

import { useState } from "react";
import { scanInProgress } from "@/components/record-modal/scan-card";
import { Button } from "@/components/parts/button";
import { FrameFoot, FrameTitle, Nothing, RecordFrame } from "@/components/record-modal/parts";
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

/* The vehicle modal: one modal, eight kinds of screen, one `screen` value.

   It replaces a stack of separate modals — detail, renewal, renewal history,
   the service history, and now logging — that each portalled over the last.
   A door in the compliance list moves the screen, a row in the history opens
   the entry it names, the + menu opens a logging screen, and the back
   chevron and every save move it back. Nothing is fetched here: the
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
   that is at most two screens deep.

   It wears the record window (record-modal/parts, the old-modals mock of
   27 October 2026): one Dialog that stays open while the screens change,
   each screen writing its own title and foot. */

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
  single = false,
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
  /** One screen and no card under it: the vehicle's own page (v2) opens
      today's screens one at a time, so Back, Escape and every save close
      the dialog rather than stepping down to the card's main screen. */
  single?: boolean;
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
    if (single) return onClose();
    setScreen(from);
    setFrom("main");
  };

  /* Escape and the scrim leave the way Back does: a sub-screen goes back,
     the main screen closes. Two or three presses to get out from anywhere,
     never a surprise dismissal mid-form. While a scan is in progress they do
     nothing: the renewal and financials screens hold the scan panel, and
     leaving one threw away a document already read and uploaded — see
     scanInProgress. Back in the foot still goes back. */
  const softClose = () => {
    if (scanInProgress()) return;
    if (screen === "main" || single) onClose();
    else {
      setScreen(from);
      setFrom("main");
    }
  };
  /* Opened on its own from the vehicle's page, Back closes, and says so. */
  const backWord = single ? "Close" : "Back";

  const setPhoto = async (file: File) => {
    const up = await uploadFile(file, "vehicle_photo").catch(() => null);
    if (up?.ok) fleet.setVehiclePhoto(vehicle.id, up.file.documentId);
  };

  return (
    <RecordFrame width={screen === "main" ? 960 : 720} onClose={softClose}>
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
            backWord={backWord}
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
            backWord={backWord}
            onBack={back}
            onSave={(log) => fleet.addLog(log)}
            onSaved={back}
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
                backWord={backWord}
                onBack={back}
                onCorrect={onCorrect}
                onResolve={fleet.resolveIssue}
                onAttach={fleet.attachLogDocument}
              />
            ) : (
              /* Removed from under us — a correction that deleted it, another
                 tab. Nothing to show but the way back. */
              <>
                <FrameTitle>Entry</FrameTitle>
                <Nothing>That entry is no longer in the history.</Nothing>
                <FrameFoot>
                  <Button kind="quiet" onClick={back}>
                    {backWord}
                  </Button>
                </FrameFoot>
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
            backWord={backWord}
            onBack={back}
            onSaveVehicle={(v) => fleet.saveVehicle(v)}
            onRecordFinance={(input) => fleet.recordFinance({ ...input, vehicleId: vehicle.id })}
            onRecorded={back}
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
            backWord={backWord}
            onBack={back}
            onSave={(input) => fleet.recordRenewal({ ...input, vehicleId: vehicle.id })}
            onSaved={back}
            onAttach={fleet.attachPolicyDocument}
          />
        )}
    </RecordFrame>
  );
}
