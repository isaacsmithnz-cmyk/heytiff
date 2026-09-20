/* Shared chrome for Toolbox tool pages — back link, title, subtitle (the
   category eyebrow over the title is retired, law 10); children render below inside the shell's stagger wrapper. Each
   tool passes its category accent, exposed to the CSS as --tool-accent* so
   controls pick up the right colour without per-tool stylesheets.
   `compact` collapses the header to one tight block for tools that must fit
   a single viewport (the quick-check calculators). */

import Link from "next/link";
import { Icon } from "@/components/shell/icon";
import { ScreenBand, ScreenPanel } from "@/components/shell/screen-band";
import "./toolbox.css";

export function ToolPage({
  accent,
  accentInk,
  title,
  sub,
  compact = false,
  children,
}: {
  accent: string;
  /** darker readable shade of the accent for text on soft backgrounds */
  accentInk: string;
  title: string;
  sub?: string;
  /** tighter header for single-viewport tools */
  compact?: boolean;
  children: React.ReactNode;
}) {
  return (
    /* Paper to the frame, the tool's name in the band and the way back to the
       Toolbox on its own line above it — the Workboard's frame (2026-09-20).
       The line under the title stays with the tool, where it says what the
       tool does; the band is for its name. */
    <div className="page in full">
      <div className="wrap">
        {/* the per-tool accent went with the fold (ink and paper): the page is ink and paper like every other */}
        <div className="stg">
          <ScreenBand
            crumb={
              <Link href="/dashboard/toolbox" className="tback">
                <Icon name="chevL" size={15} />
                Toolbox
              </Link>
            }
            title={title}
          />
          <ScreenPanel>
            <div className={"tool" + (compact ? " compact" : "")}>
              {sub && <p className="tsub">{sub}</p>}
              {children}
            </div>
          </ScreenPanel>
        </div>
      </div>
    </div>
  );
}
