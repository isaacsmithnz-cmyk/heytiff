import type { ReactNode } from "react";
import { Icon } from "@/components/shell/icon";

/* A CARD'S NAME ON A JOB'S PAGE, IN ITS COLOUR (Isaac, 17 November 2026, the
   first-look fixes, https://claude.ai/artifact/7ijojbkVbMJUGasurPCvVF: "the
   job card changes to match are good"). Overview's, Scope's and Billing's
   cards name themselves in their hue's word value with their glyph beside
   (job-section.tsx); On site's and Files' cards, and the Plans and Designs
   under Scope, said theirs in black. On the job's page (`.jp-fit`, shell.css)
   the glyph shows and the name takes the hue; anywhere else a face is drawn
   the glyph stays hidden and the name stays ink, as it was. */

export type FaceHue = "purple" | "green" | "yellow" | "pink";

export function FaceTitle({
  as: Tag = "h3",
  className,
  icon,
  hue,
  children,
}: {
  as?: "h2" | "h3" | "b";
  className?: string;
  icon: string;
  hue: FaceHue;
  children: ReactNode;
}) {
  return (
    <Tag className={[className, "jt", `jt--${hue}`].filter(Boolean).join(" ")}>
      <span className="jt-ic" aria-hidden="true">
        <Icon name={icon} size={18} />
      </span>
      {children}
    </Tag>
  );
}
