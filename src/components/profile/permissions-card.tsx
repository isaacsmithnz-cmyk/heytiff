"use client";

import { Icon } from "@/components/shell/icon";
import type { Capability } from "@/lib/permissions";
import type { Role } from "@/lib/roles-shared";
import { SectionCard, StaticCard } from "./section-card";
import { Detail, DetailPanel, DetailPanels } from "./detail";
import type { PermissionsCtx, SaveSection } from "./types";

const ROLES: [Role, string, string, string][] = [
  ["staff", "Staff", "Field worker — own data only", "#00A389"],
  ["admin", "Admin", "Manage the team — approve & assign", "#2E68FF"],
  ["owner", "Owner", "Full access incl. pay & financials", "#8A2BE2"],
];

/* Labels say "everyone's" where the capability gates the team-wide view only —
   revoking it never touches the person's own timesheet or own vehicle, which
   are intrinsic. */
const ACCESS: [Capability, string, string][] = [
  ["toolbox", "Toolbox", "Calculators & references"],
  ["studio", "Design Studio", "Create & edit VRF designs"],
  ["tiff", "Tiff AI", "Assistant & knowledge base"],
  ["tiff_manage", "Tiff AI — manage", "Add & edit knowledge-base documents"],
  ["workboard", "Workboard", "See the projects & maintenance board"],
  ["workboard_manage", "Workboard — manage", "Create & edit projects, agreements & visits"],
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

  /* READ MODE IS FACTS, EDIT MODE IS CONTROLS. This card used to show its
     locked state as a row of dead toggles — switches you cannot flick, which
     read as broken rather than as read-only. Read mode now answers the two
     questions plainly: what role, and what can they reach. */
  const role = ROLES.find((r) => r[0] === values.org_role);
  const readBody = (
    <>
      {note}
      <DetailPanels>
        <DetailPanel title="Role">
          <Detail
            label="Role"
            value={
              role ? (
                <span className="ro-state">
                  <span className="prdot" style={{ background: role[3] }} />
                  {role[1]}
                </span>
              ) : (
                ""
              )
            }
            sub={role?.[2]}
          />
        </DetailPanel>

        <DetailPanel title="Access" wide split>
          {ACCESS.map(([cap, label]) => {
            const on = values[`cap_${cap}`] === "on";
            return (
              <Detail
                key={cap}
                label={label}
                value={
                  <span className={on ? "ro-state ok" : "ro-state mute"}>{on ? "On" : "Off"}</span>
                }
                sub={ctx.settable.has(cap) ? undefined : "owner-granted"}
              />
            );
          })}
        </DetailPanel>
      </DetailPanels>
    </>
  );

  /* Edit mode only — read mode is `readBody` above. Every role is offered here
     (you are choosing) and every toggle is live unless the capability is one
     this viewer may not set. */
  const body = (draft: Record<string, string>, set: (k: string, v: string) => void) => (
    <>
      {note}
      <div className="field" style={{ marginBottom: 20 }}>
        <label>Role</label>
        <div className="permroles">
          {ROLES.map((r) => {
            const on = r[0] === draft.org_role;
            const locked = !ctx.canChangeRole;
            return (
              <label key={r[0]} className={`permrole${on ? " on" : ""}${locked ? " locked" : ""}`}>
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
          })}
        </div>
      </div>
      <div className="field">
        <label>
          Access{" "}
          <span className="help" style={{ fontWeight: 500, marginLeft: 4 }}>
            — fine-tune what the role can reach
          </span>
        </label>
        <div className="accessgrid">
          {ACCESS.map(([cap, label, hint]) => {
            const on = draft[`cap_${cap}`] === "on";
            // owner-tier rows render locked for a delegated manager, matching
            // what canSetCapability will actually accept
            const locked = !ctx.settable.has(cap);
            return (
              <div key={cap} className={`togrow${locked ? " locked" : ""}`}>
                <div className="tk">
                  <b>{label}</b>
                  <em>
                    {hint}
                    {locked ? " · owner-granted" : ""}
                  </em>
                </div>
                <button
                  type="button"
                  className={`toggle${on ? " on" : ""}`}
                  role="switch"
                  aria-checked={on}
                  aria-label={label}
                  disabled={locked}
                  onClick={() => !locked && set(`cap_${cap}`, on ? "off" : "on")}
                />
              </div>
            );
          })}
        </div>
      </div>
    </>
  );

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
        {readBody}
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
      read={readBody}
      edit={({ draft, set }) => body(draft, set)}
    />
  );
}
