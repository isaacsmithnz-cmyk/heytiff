import { initialsFrom } from "@/lib/staff/derive";

/* PEOPLE (docs/design.md, rule 38): initials on a light grey disc, ink
   letters at 600. The ground is `--sel`, the selected fill, so the disc
   still shows on a selected row. The initials are the Team directory's own
   (`initialsFrom`), so a person reads the same everywhere.

   Beside the person's name the disc says nothing new and is hidden;
   standing alone it is an image named for them. */

export type InitialsSize = 24 | 32 | 40;

export function Initials({
  name,
  size = 32,
  beside = false,
  className,
}: {
  name: string;
  size?: InitialsSize;
  /** the name is already written next to the disc */
  beside?: boolean;
  className?: string;
}) {
  const cls = ["pt-initials", `pt-initials--${size}`, className].filter(Boolean).join(" ");
  if (beside) {
    return (
      <span className={cls} aria-hidden="true">
        {initialsFrom(name)}
      </span>
    );
  }
  return (
    <span className={cls} role="img" aria-label={name.trim() || "Unnamed"}>
      {initialsFrom(name)}
    </span>
  );
}
