import Link from "next/link";
import type { ReactNode } from "react";
import { Dot, type Hue } from "./state";
import { Fade } from "./fade";

export { Dot, type Hue };

/* A ROW (rule 39): a time or a tick, a dot, the name in bold with a grey
   line under it, then a state word or one button on the right. 32 tall in
   a list (rule 28), hairlines between (rule 35). A row you can open is a
   link or a button whose box covers the row, so the whole row is the
   target and `end` sits above it, still its own button. */
export function Row({
  name,
  line,
  lead,
  dot,
  end,
  href,
  onClick,
  lines = 1,
}: {
  name: ReactNode;
  line?: ReactNode;
  /** a time, or a tick */
  lead?: ReactNode;
  dot?: Hue;
  /** a state word, or one button */
  end?: ReactNode;
  href?: string;
  onClick?: () => void;
  /** how many lines the name may run to before it fades; its grey line
      then gets two. One by default, as every list has it. */
  lines?: 1 | 2 | 3;
}) {
  const label = <Fade lines={lines}>{name}</Fade>;
  const hit = href ? (
    <Link href={href} className="pt-row-name pt-row-hit">
      {label}
    </Link>
  ) : onClick ? (
    <button type="button" onClick={onClick} className="pt-row-name pt-row-hit">
      {label}
    </button>
  ) : (
    <span className="pt-row-name">{label}</span>
  );
  return (
    <li className={["pt-row", href || onClick ? "pt-row--click" : null, lines > 1 ? "pt-row--wrap" : null].filter(Boolean).join(" ")}>
      {lead != null && <span className="pt-row-lead">{lead}</span>}
      {dot && <Dot hue={dot} />}
      <span className="pt-row-text">
        {hit}
        {line != null && (
          <span className="pt-row-line">
            <Fade lines={lines > 1 ? 2 : 1}>{line}</Fade>
          </span>
        )}
      </span>
      {end != null && <span className="pt-row-end">{end}</span>}
    </li>
  );
}

/** The list a row sits in. Name it, so a screen reader says what it is. */
export function RowList({ children, label }: { children: ReactNode; label?: string }) {
  return (
    <ul className="pt-rows" aria-label={label}>
      {children}
    </ul>
  );
}
