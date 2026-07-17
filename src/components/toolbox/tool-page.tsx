/* Shared chrome for Toolbox tool pages — back link, category eyebrow, title,
   subtitle; children render below inside the shell's stagger wrapper. Each
   tool passes its category accent, exposed to the CSS as --tool-accent* so
   controls pick up the right colour without per-tool stylesheets. */

import Link from "next/link";
import { Icon } from "@/components/shell/icon";
import "./toolbox.css";

export function ToolPage({
  category,
  accent,
  accentInk,
  title,
  sub,
  children,
}: {
  category: string;
  accent: string;
  /** darker readable shade of the accent for text on soft backgrounds */
  accentInk: string;
  title: string;
  sub: string;
  children: React.ReactNode;
}) {
  return (
    <div className="page in">
      <div className="wrap">
        <div
          className="tool"
          style={
            {
              "--tool-accent": accent,
              "--tool-accent-ink": accentInk,
              "--tool-accent-soft": accent + "1f",
              "--tool-accent-line": accent + "4d",
              "--tool-ring": accent + "2e",
            } as React.CSSProperties
          }
        >
          <div className="thead stg">
            <Link href="/dashboard/toolbox" className="tback">
              <Icon name="chevL" size={15} />
              Toolbox
            </Link>
            <div className="teyebrow" style={{ color: accentInk }}>
              <span className="edot" style={{ background: accent }} />
              {category}
            </div>
            <h1>{title}</h1>
            <p className="tsub">{sub}</p>
          </div>
          {children}
        </div>
      </div>
    </div>
  );
}
