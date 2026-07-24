import { Icon } from "@/components/shell/icon";
import { ChipTile } from "./chip-tile";
import type { DashboardChips } from "@/lib/dashboard/assemble";

/* The full action-required board.

   The dashboard hero carries only the count; everything actually lives here, so
   nothing is silently truncated. Same split as the summary: what's yours is
   intrinsic, what's across the team arrives with `team` / `assets_all`, decided
   in assembleChips and never re-decided in the UI. */
export function ActionRequiredBoard({ chips }: { chips: DashboardChips }) {
  const total = chips.self.length + chips.team.length;

  return (
    <div className="page in">
      <div className="wrap">
        <div className="stg">
          <div className="v2head" style={{ marginBottom: 24, alignItems: "center" }}>
            <div style={{ flex: 1, minWidth: 0 }}>
              <a
                href="/dashboard"
                style={{
                  fontSize: 13,
                  fontWeight: 700,
                  color: "#9ca3af",
                  textDecoration: "none",
                  display: "inline-flex",
                  alignItems: "center",
                  gap: 4,
                  marginBottom: 12,
                }}
              >
                ← Dashboard
              </a>
              <h1 style={{ fontSize: 44, fontWeight: 800, letterSpacing: "-0.03em", margin: 0 }}>
                Action required
              </h1>
            </div>
          </div>

          {total === 0 ? (
            <div className="emptybox">
              <div className="ei">
                <Icon name="check" size={22} />
              </div>
              <b>Nothing needs attention</b>
              <em>
                Licences, work rights, vehicle rego, insurance and services are all in date. Anything
                expiring in the next 30 days shows up here.
              </em>
            </div>
          ) : (
            <div className="card2">
              {chips.self.length > 0 && (
                <>
                  {chips.team.length > 0 && <div className="dash-sub">Yours</div>}
                  <div className="dash-grid">
                    {chips.self.map((c) => (
                      <ChipTile key={c.key} chip={c} />
                    ))}
                  </div>
                </>
              )}
              {chips.team.length > 0 && (
                <>
                  <div className="dash-sub">Across the team</div>
                  <div className="dash-grid">
                    {chips.team.map((c) => (
                      <ChipTile key={c.key} chip={c} />
                    ))}
                  </div>
                </>
              )}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
