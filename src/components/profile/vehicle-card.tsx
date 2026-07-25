"use client";

import { Icon } from "@/components/shell/icon";
import { displayName, fmtKm, modelLabel, serviceKmLeft, vehicleChips } from "@/components/fleet/logic";
import { Plate } from "@/components/fleet/plate";
import { daysDuration } from "@/lib/format/duration";
import { StaticCard } from "./section-card";
import type { AssignedVehicle } from "./types";

/* Assigned vehicle — a straight port of the old markup.

   Fleet is the single source of the assignment: this card derives, it never
   stores, and there is nothing to edit here. Manage it in Assets → Fleet. */
export function VehicleCard({ assigned }: { assigned: AssignedVehicle | null }) {
  return (
    <StaticCard icon="truck" title="Assigned vehicle" sub="Linked from Fleet — manage in Assets">
      {assigned ? <Assigned av={assigned} /> : <Empty />}
    </StaticCard>
  );
}

function Empty() {
  return (
    <div className="ro-empty">
      <span className="ei">
        <Icon name="car" size={20} />
      </span>
      <b>No vehicle assigned</b>
      <em>
        Assign a vehicle to this staff member from Assets → Fleet to show rego, service status and
        fuel here.
      </em>
    </div>
  );
}

/* The JSX twin of `inHtml` — "in 6 weeks", number carrying the weight and the
   unit sitting back. Same shape, same classes; the HTML-string original exists
   for the screens that still compose markup, and this card no longer does. */
function InDuration({ days }: { days: number }) {
  const d = daysDuration(days);
  if (d.unit === "") return <>{d.label}</>;
  return (
    <>
      in {d.value}
      <span className="dur-u">{d.unit}</span>
    </>
  );
}

function Assigned({ av }: { av: AssignedVehicle }) {
  const v = av.vehicle;
  const chips = vehicleChips(v, av.openIssues);
  const left = serviceKmLeft(v);
  const lastFuel = av.lastFuel;

  return (
    <div className="pveh">
      <div className="pvh">
        <span className="pvi">
          <Icon name="truck" size={20} />
        </span>
        <span>
          <b>
            {displayName(v)} · {modelLabel(v)}
          </b>
          <em>
            <Plate plate={v.plate} state={v.plateState} size="sm" />
          </em>
        </span>
      </div>
      <div className="pvchips">
        {chips.length === 0 ? (
          <span className="dchip ok">
            <Icon name="check" size={12} />
            All good
          </span>
        ) : (
          chips.map((c) => (
            <span key={c.label} className={`dchip ${c.state}`}>
              <Icon name={c.state === "bad" ? "alert" : "clock"} size={12} />
              {c.label}
            </span>
          ))
        )}
      </div>
      <div className="pvfacts">
        <span>
          <em>Odometer</em>
          <b>{fmtKm(v.odometer)} km</b>
        </span>
        <span>
          <em>Next service</em>
          <b>{left < 0 ? `${fmtKm(-left)} km overdue` : `in ${fmtKm(left)} km`}</b>
        </span>
        <span>
          <em>Rego</em>
          <b>{v.regoDays < 0 ? "expired" : <InDuration days={v.regoDays} />}</b>
        </span>
        <span>
          <em>Last fuel</em>
          <b>{lastFuel ? `${lastFuel.litres} L · ${lastFuel.when}` : "—"}</b>
        </span>
      </div>
    </div>
  );
}
