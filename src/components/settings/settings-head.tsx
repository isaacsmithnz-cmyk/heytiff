import Link from "next/link";
import type { ReactNode } from "react";
import { Icon } from "@/components/shell/icon";
import { Fade } from "@/components/parts/fade";

/* A SETTINGS PAGE'S HEAD (v2; the screens with no board, 18 October:
   "the same head: 24px title, a grey fact line, the main button on the
   right"). The way back sits above the title, a link in ink (rule 26),
   because a setting is reached from Settings and the sidebar has no place
   for each one. The fact line is there only when it carries a fact (law
   15): a figure, a date or a name. What stood beside the title before
   (a button, a state word) is `tools`, on the right.

   It sits where ScreenBand sat, at the top of the page's column, so the
   panel under it keeps its own line and its scroll. */

export type Back = { href: string; label: string };

export const TO_SETTINGS: Back = { href: "/dashboard/admin", label: "Settings" };

export function SettingsHead({
  heading,
  facts,
  tools,
  back = TO_SETTINGS,
}: {
  /** the page's name, its h1 (not `title`: a title is a tooltip) */
  heading: ReactNode;
  /** the grey line under the title: a fact, or nothing */
  facts?: ReactNode;
  /** the main button, or a state word, on the right */
  tools?: ReactNode;
  /** where the page was reached from; null on Settings itself */
  back?: Back | null;
}) {
  return (
    <header className="st2-head">
      {back && (
        <Link href={back.href} className="st2-back">
          <Icon name="chevL" size={16} />
          <span className="st2-back-word">{back.label}</span>
        </Link>
      )}
      <div className="st2-top">
        <div className="st2-id">
          <h1 className="st2-h1">
            <Fade>{heading}</Fade>
          </h1>
          {facts != null && facts !== false && <p className="st2-facts">{facts}</p>}
        </div>
        {tools != null && tools !== false && <div className="st2-tools">{tools}</div>}
      </div>
    </header>
  );
}
