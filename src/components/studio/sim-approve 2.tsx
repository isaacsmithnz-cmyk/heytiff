"use client";

/* "Ready to share" — the tick that lets a simulation leave the building.

   It lives HERE, in the simulation view, beside the thing it is judging. You
   open the simulation during the design phase, watch it run, and if it behaves
   you tick it. If there is no suitable simulation for this design, or it is not
   simulating correctly, you leave it off.

   What it gates is whether the simulation appears as an option on the Summary
   sheet and the customer's live link AT ALL — not a warning, not a disabled
   control, absent. Nothing on either sheet advertises a simulation the person
   reading it cannot open.

   Off by default, and you activate it every time: the tick pins to the design
   as it stands (sim-approval.ts), so any edit withdraws it. That is why this is
   a switch rather than a setting — it is a statement about one run of one
   floor, made now. */

export function SimApproveSwitch({
  on,
  floorName,
  /** true when the design has more than one floor that can simulate — the
      switch then has to say WHICH floor it is speaking for. With one floor
      there is nothing to disambiguate and the name is noise. */
  nameTheFloor,
  onChange,
}: {
  on: boolean;
  floorName: string;
  nameTheFloor: boolean;
  onChange: (on: boolean) => void;
}) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={on}
      className={`ds-simok${on ? " on" : ""}`}
      onClick={() => onChange(!on)}
    >
      <span className="ds-simok-box" aria-hidden>
        {on ? "✓" : ""}
      </span>
      <span className="ds-simok-t">
        Ready to share
        {nameTheFloor && <b>{floorName}</b>}
      </span>
    </button>
  );
}
