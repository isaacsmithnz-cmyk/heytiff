import { useId, type ReactNode } from "react";
import { Icon } from "@/components/shell/icon";

/* ONE SECTION RECIPE, for every section of a job's Overview (Isaac, 25
   October 2026, "Yes, build the refined Overview A"). The head is 32 tall:
   a solid block of the section's colour with its icon in ink, Home's own
   (`.hm-blk`), then the title at 16, and at most one quiet or second
   button on the right (or the feed's soft tabs). Under it, its rows, each
   at least 32 tall with a hairline above the first and under each.

   The colours are Home's: To do yellow with a tick, the feed green with a
   bubble, as Home's Your feed. The Summary is pink: not blue (it means
   press), red (wrong) or orange (needs a look), and not purple, which is
   Home's Today. A project's page (project-detail-screen.tsx) wears the same
   recipe and takes purple and grey as well, as its mock draws them. */

export type SectionHue = "pink" | "yellow" | "green" | "purple" | "grey";

export function JobSection({
  name,
  icon,
  hue,
  action,
  className,
  children,
}: {
  /** The section's title. */
  name: string;
  icon: string;
  hue: SectionHue;
  /** On the head's right: one quiet or second button, or the feed's tabs. */
  action?: ReactNode;
  className?: string;
  children: ReactNode;
}) {
  const id = useId();
  return (
    <section className={["jov-sec", className].filter(Boolean).join(" ")} aria-labelledby={id}>
      <div className="jov-head">
        <span className={`hm-blk hm-blk--${hue}`} aria-hidden="true">
          <Icon name={icon} size={18} />
        </span>
        <h2 className="jov-title" id={id}>
          {name}
        </h2>
        {action && <div className="jov-headact">{action}</div>}
      </div>
      {children}
    </section>
  );
}
