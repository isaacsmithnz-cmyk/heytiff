import type { ReactNode } from "react";

/* STATE IS A WORD (docs/design.md, rules 16 to 18). Good in green, needs a
   look in orange, wrong or late in red, and for your information grey, so
   blue never means a state (17). Red only means wrong (16). Never a pill or
   a fill (rule 47): a dot and a word in the hue's word value, 13 at 500.

   A dot always sits beside a word that says what it means (17), so the dot
   is hidden from a screen reader and the word carries it. The dot takes any
   of the eight because a job's colour is a dot too (18); a state takes only
   the four that mean something. */

export type Hue = "red" | "orange" | "yellow" | "green" | "blue" | "purple" | "pink" | "grey";
export type Tone = "wrong" | "look" | "good" | "info";

const TONE_HUE: Record<Tone, Hue> = { wrong: "red", look: "orange", good: "green", info: "grey" };

/** The hue a state is drawn in. */
export const stateTone = (tone: Tone): Hue => TONE_HUE[tone];

export function Dot({ hue, className }: { hue: Hue; className?: string }) {
  return <span className={["pt-dot", `pt-dot--${hue}`, className].filter(Boolean).join(" ")} aria-hidden="true" />;
}

export function StateWord({ tone, children, className }: { tone: Tone; children: ReactNode; className?: string }) {
  return (
    <span className={["pt-state", `pt-state--${tone}`, className].filter(Boolean).join(" ")}>
      <Dot hue={stateTone(tone)} />
      <span className="pt-state__word">{children}</span>
    </span>
  );
}
