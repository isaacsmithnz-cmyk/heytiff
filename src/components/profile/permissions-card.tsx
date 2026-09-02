"use client";

import { Icon } from "@/components/shell/icon";
import type { Capability } from "@/lib/permissions";
import { ROLE_COPY, ROLE_ORDER, type Role } from "@/lib/roles-shared";
import { SectionCard, StaticCard, type SectionBodyContext } from "./section-card";
import { Detail, DetailPanel, DetailPanels } from "./detail";
import type { PermissionsCtx, SaveSection } from "./types";

/* The words come from ROLE_COPY now — the same sentences the invite modal
   shows, because the choice is made THERE and explained here, and two
   descriptions of one grant is how they drift. Only the dot colour is this
   screen's own; it is decoration on a swatch, not state. */
const ROLE_DOT: Record<Role, string> = {
  staff: "#00A389",
  admin: "#2E68FF",
  owner: "#8A2BE2",
};

const ROLES: [Role, string, string, string][] = ROLE_ORDER.map((r) => [
  r,
  ROLE_COPY[r].label,
  ROLE_COPY[r].blurb,
  ROLE_DOT[r],
]);

/* Labels say "everyone's" where the capability gates the team-wide view only —
   revoking it never touches the person's own timesheet or own vehicle, which
   are intrinsic. */
const ACCESS: [Capability, string, string][] = [
  ["toolbox", "Toolbox", "Calculators & references"],
  ["studio", "Design Studio", "Create & edit VRF designs"],
  ["tiff", "Library", "Ask the company's manuals, specs & SOPs"],
  ["tiff_manage", "Library — manage", "Add & edit library documents"],
  ["workboard", "Workboard", "See the projects & maintenance board"],
  ["workboard_manage", "Workboard — manage", "Create & edit projects, agreements & visits"],
  ["workboard_money", "Workboard — money", "Job values, claims & what's been paid"],
  ["team", "Team directory", "View & manage other staff records"],
  ["timepay_all", "Time & Pay — everyone's", "All timesheets, leave & expenses"],
  ["approvals", "Approvals", "Approve hours, leave & expenses"],
  ["assets_all", "Assets — whole register", "Full fleet & equipment"],
  ["financials", "Financials", "Other people's pay, rates & charge-out"],
  ["permissions", "Permissions", "Change other people's access"],
  ["invites", "Invites", "Invite & offboard staff — staff role only"],
];

export function permissionsValues(ctx: PermissionsCtx): Record<string, string> {
  const out: Record<string, string> = { org_role: ctx.role ?? "" };
  for (const [cap] of ACCESS) out[`cap_${cap}`] = ctx.caps.has(cap) ? "on" : "off";
  return out;
}

/* Role + access.

   This card saves through the SAME saveStaffSection as every other admin card,
   with section "permissions" — the action routes it to its own memberships
   path with its own ownership guards, and re-decides everything decided here.
   The role selector stays VISIBLE when it's locked: hiding it would leave an
   admin unable to see why someone has the access they have. */
export function PermissionsCard({ ctx, onSave }: { ctx: PermissionsCtx; onSave: SaveSection }) {
  const values = permissionsValues(ctx);
  const pill = (
    <span className="pill2 adminpill">
      <Icon name="lock" size={11} />
      Admin only
    </span>
  );
  const note = ctx.lockedReason ? (
    <div className="ro-empty" style={{ marginBottom: 18 }}>
      <span className="ei">
        <Icon name="lock" size={20} />
      </span>
      <b>Read-only</b>
      <em>{ctx.lockedReason}</em>
    </div>
  ) : null;

  /* READ MODE IS FACTS, EDIT MODE IS CONTROLS — and that distinction is older
     than the edit-in-place refactor. This card once showed its locked state as
     a row of dead toggles, switches you cannot flick, which read as broken
     rather than as read-only. So the access rows still say "On"/"Off" when you
     are reading and only become switches when you are choosing. A disabled
     toggle is not a value.

     What the refactor adds is that they are the SAME ROWS either way: one list,
     one set of labels, and the mode changes what sits in the value slot. See
     detail.tsx.

     THE ROLE IS THE EXCEPTION, and for the same reason the emergency card is:
     its control is a three-card picker on a full-width grid, not something
     that fits a value slot. It gets a plain panel, and the panel goes from
     showing the one role to offering all three. The card object is identical
     in both — only how many of them there are changes. */
  const role = ROLES.find((r) => r[0] === values.org_role);

  const sectionBody = ({ editing, draft, set }: SectionBodyContext) => (
    <>
      {note}
      <DetailPanels>
        <DetailPanel title="Role" wide plain>
          <div className={editing ? "permroles" : "permroles one"}>
            {editing
              ? ROLES.map((r) => {
                  const on = r[0] === draft.org_role;
                  // the selector stays VISIBLE when it is locked: hiding it
                  // would leave an admin unable to see why someone has the
                  // access they have
                  const locked = !ctx.canChangeRole;
                  return (
                    <label
                      key={r[0]}
                      className={`permrole${on ? " on" : ""}${locked ? " locked" : ""}`}
                    >
                      <input
                        type="radio"
                        name="org_role"
                        value={r[0]}
                        checked={on}
                        disabled={locked}
                        onChange={() => set("org_role", r[0])}
                      />
                      <span className="prdot" style={{ background: r[3] }} />
                      <span className="prk">
                        <b>{r[1]}</b>
                        <em>{r[2]}</em>
                      </span>
                      <span className="prcheck">
                        <Icon name="check" size={14} />
                      </span>
                    </label>
                  );
                })
              : role && (
                  /* a div, not a label with a radio in it — reading, there is
                     nothing to choose and nothing to click */
                  <div className="permrole on">
                    <span className="prdot" style={{ background: role[3] }} />
                    <span className="prk">
                      <b>{role[1]}</b>
                      <em>{role[2]}</em>
                    </span>
                  </div>
                )}
          </div>
        </DetailPanel>

        <DetailPanel title="Access" wide split>
          {ACCESS.map(([cap, label, hint]) => {
            const on = (editing ? draft : values)[`cap_${cap}`] === "on";
            // owner-tier rows render locked for a delegated manager, matching
            // what canSetCapability will actually accept
            const locked = !ctx.settable.has(cap);
            return (
              <Detail
                key={cap}
                label={label}
                editing={editing}
                value={
                  <span className={on ? "ro-state ok" : "ro-state mute"}>{on ? "On" : "Off"}</span>
                }
                /* the hint is guidance for CHOOSING, so it rides along only
                   while you are — twelve two-line rows would double the height
                   of a panel whose read job is to be scanned */
                sub={
                  editing
                    ? `${hint}${locked ? " · owner-granted" : ""}`
                    : locked
                      ? "owner-granted"
                      : undefined
                }
                control={
                  <button
                    type="button"
                    className={`toggle${on ? " on" : ""}`}
                    role="switch"
                    aria-checked={on}
                    aria-label={label}
                    disabled={locked}
                    onClick={() => !locked && set(`cap_${cap}`, on ? "off" : "on")}
                  />
                }
              />
            );
          })}
        </DetailPanel>
      </DetailPanels>
    </>
  );

  /* The locked card has no edit cycle at all, so it renders the same body with
     `editing` nailed shut rather than keeping a second copy of the read view
     around to drift. */
  const readOnlyBody = sectionBody({
    editing: false,
    edit: () => {},
    draft: values,
    set: () => {},
    setMany: () => {},
    invalid: () => false,
    saving: false,
    errorFor: () => null,
  });

  if (!ctx.editable) {
    return (
      <StaticCard
        variant="section"
        icon="usershield"
        iconStyle={{ background: "rgba(138,43,226,.12)", color: "#8A2BE2" }}
        title="Permissions"
        sub="Role & what this person can access"
        pill={pill}
      >
        {readOnlyBody}
      </StaticCard>
    );
  }

  return (
    <SectionCard
      variant="section"
      icon="usershield"
      iconStyle={{ background: "rgba(138,43,226,.12)", color: "#8A2BE2" }}
      title="Permissions"
      sub="Role & what this person can access"
      pill={pill}
      values={values}
      onSave={(fields) => onSave("permissions", fields)}
      body={sectionBody}
    />
  );
}
