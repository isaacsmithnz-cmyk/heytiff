import Link from "next/link";
import { Icon } from "@/components/shell/icon";
import { ScreenBand, ScreenPanel } from "@/components/shell/screen-band";
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
    /* Paper to the frame, the title in the band and the way back on its own
       line above it — the Workboard's frame (2026-09-20). */
    <div className="page in full">
      <div className="wrap">
        <div className="stg">
          <ScreenBand
            crumb={
              <Link href="/dashboard" className="int-back">
                <Icon name="chevL" size={15} />
                Home
              </Link>
            }
            title="Action required"
          />
          <ScreenPanel>

          {total === 0 ? (
            <div className="emptybox">
              <div className="ei">
                <Icon name="check" size={22} />
              </div>
              <b>Nothing needs attention</b>
              {/* The list is what makes this trustworthy, so it has to be
                  right: it used to enumerate its coverage and leave leave out
                  entirely, which invites you to rely on it for something it
                  never watched. */}
              <em>
                Licences, work rights, vehicle rego, insurance and services are all in date, and
                nobody is waiting on an answer from you. Anything expiring in the next 30 days shows
                up here — so does a timesheet sent back with a question, leave or an expense claim
                that came back declined, and anything waiting on you to approve.
              </em>
            </div>
          ) : (
            /* This was a `.card2` — the white card on the grey well. With the
               well gone it would be a box drawn around the whole page, so the
               tiles stand on the paper themselves. */
            <>
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
            </>
          )}
          </ScreenPanel>
        </div>
      </div>
    </div>
  );
}
