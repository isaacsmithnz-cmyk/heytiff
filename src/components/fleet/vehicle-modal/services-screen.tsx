"use client";

import { dateFromDays } from "@/lib/fleet/map";
import { Plate } from "../plate";
import {
  displayName,
  fmtKm,
  serviceDue,
  serviceDueKm,
  serviceDueText,
  type Vehicle,
  type VehicleLog,
} from "../logic";
import { fmtDay } from "./derive";
import { EventRow } from "./event-row";
import { Btn, Card, DetailGrid, Eyebrow, SubHeader, type DetailItem } from "@/components/record-modal/parts";

/* Every service this vehicle has had, and the cycle they set.

   This was a modal of its own over the vehicle card; it is a screen of the
   card now, like the renewals, so a service in the list can open on its own
   screen and come back here. What was deliberately kept from the modal: a
   service does not supersede the one before it — each stands on its own, the
   way a fuel docket does — so nothing here is tagged Current or Previous;
   that tag belongs only to paper that REPLACES paper. And "No services logged
   yet" is the honest line when the list is empty: the cycle is read off
   last_service_odo, which a manager can set by hand, so an empty list does
   not license the claim that the vehicle was never serviced. */
export function ServicesScreen({
  vehicle,
  logs,
  today,
  warnDays,
  error,
  onBack,
  onLog,
  onOpen,
}: {
  vehicle: Vehicle;
  /** This vehicle's logs — filtered to services here, so callers pass the lot. */
  logs: VehicleLog[];
  today: string;
  /** The org's expiry window — the service-by-date limit reads it. */
  warnDays: number;
  error: string | null;
  onBack: () => void;
  onLog: () => void;
  onOpen: (log: VehicleLog) => void;
}) {
  const services = [...logs.filter((l) => l.kind === "service")].sort((a, b) => a.ago - b.ago);
  const due = serviceDue(vehicle, warnDays);
  const dueKm = serviceDueKm(vehicle);
  /* Both limits, each stated only if it applies — the vehicle falls due on
     whichever arrives first, so showing one of them would be showing half the
     answer, and showing a limit it hasn't got would be inventing one. */
  const every = [
    vehicle.serviceIntervalKm != null && vehicle.motorised ? `${fmtKm(vehicle.serviceIntervalKm)} km` : null,
    vehicle.serviceIntervalMonths != null
      ? `${vehicle.serviceIntervalMonths} month${vehicle.serviceIntervalMonths === 1 ? "" : "s"}`
      : null,
  ]
    .filter(Boolean)
    .join(" or ");

  const cycle: DetailItem[] = [
    {
      label: "Next service",
      value: serviceDueText(vehicle, warnDays) ?? "No cycle set",
      tone: due.state === "ok" ? undefined : "warn",
    },
    ...(dueKm != null ? [{ label: "Due at", value: `${fmtKm(dueKm)} km` }] : []),
    every ? { label: "Every", value: every } : { label: "Every", value: "No interval set", tone: "faint" as const },
    ...(vehicle.lastServiceDays != null
      ? [{ label: "Last serviced", value: fmtDay(dateFromDays(-vehicle.lastServiceDays, today)) }]
      : []),
  ];

  return (
    <>
      <SubHeader
        eyebrow={displayName(vehicle)}
        title="Service"
        onBack={onBack}
        right={<Plate plate={vehicle.plate} state={vehicle.plateState} size="sm" />}
      />

      <div className="vm-body">
        {error && <div className="vm-err">{error}</div>}

        <div className={`vm-status ${due.state === "ok" ? "ok" : due.state}`}>
          <div className="vm-statusl grow">
            <DetailGrid cols={4} items={cycle} />
          </div>
          <div className="vm-statusr">
            <Btn kind="primary" icon="wrench" onClick={onLog}>
              Log service
            </Btn>
          </div>
        </div>

        <Card className="vm-histcard">
          <div className="vm-cardhead">
            <Eyebrow>Service history</Eyebrow>
          </div>
          {services.length === 0 ? (
            <div className="vm-empty">No services logged yet</div>
          ) : (
            services.map((l) => <EventRow key={l.id} log={l} onOpen={onOpen} />)
          )}
        </Card>
      </div>
    </>
  );
}
