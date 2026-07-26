"use client";

import { Icon } from "@/components/shell/icon";
import { displayName, fmtKm, modelLabel, serviceKmLeft, vehicleChips } from "@/components/fleet/logic";
import { Plate } from "@/components/fleet/plate";
import { daysDuration } from "@/lib/format/duration";
import { StaticCard } from "./section-card";
import { Detail, DetailPanel, DetailPanels } from "./detail";
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
    <>
      {/* The chips stay above the panels, and stay chips: "Rego expired" is a
          STATE that wants to be seen before anything else on the card, not a
          value sitting patiently in a row. */}
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

      <DetailPanels>
        <DetailPanel title="Vehicle">
          <Detail label="Name" value={displayName(v)} />
          {/* the plate renders as itself — it's a value, not a layout. Labelled
              "Plate", because the Status panel below has a "Rego expiry" and two
              rows called "Rego" on one card is a coin toss for the reader. */}
          <Detail label="Plate" value={<Plate plate={v.plate} state={v.plateState} size="sm" />} />
          <Detail label="Make & model" value={modelLabel(v)} />
        </DetailPanel>

        <DetailPanel title="Status">
          <Detail label="Odometer" value={`${fmtKm(v.odometer)} km`} />
          <Detail
            label="Next service"
            value={
              left < 0 ? (
                <span className="ro-state bad">{fmtKm(-left)} km overdue</span>
              ) : (
                `in ${fmtKm(left)} km`
              )
            }
          />
          <Detail
            label="Rego expiry"
            value={
              v.regoDays < 0 ? (
                <span className="ro-state bad">Expired</span>
              ) : (
                <InDuration days={v.regoDays} />
              )
            }
          />
          <Detail
            label="Last fuel"
            value={lastFuel ? `${lastFuel.litres} L · ${lastFuel.when}` : ""}
          />
        </DetailPanel>
      </DetailPanels>
    </>
  );
}
