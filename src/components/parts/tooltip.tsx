import { cloneElement, isValidElement, useId, type ReactElement, type ReactNode } from "react";

/* A TOOLTIP (docs/design.md, the guards: "the tooltip rule replaces" the
   browser's `title`). A few words on ink, over the thing it names, half a
   second after you point at it and at once when you reach it by keyboard.
   It describes; it never labels: an icon-only control still carries its
   own aria-label (rule 27), and the words here are tied to it with
   aria-describedby, so a screen reader hears them too, as `title` never
   reliably did. Plain CSS, so it costs nothing until it shows. */
export function Tooltip({
  label,
  children,
  side = "top",
}: {
  label: ReactNode;
  /** one element, which gets aria-describedby */
  children: ReactElement<{ "aria-describedby"?: string }>;
  side?: "top" | "bottom";
}) {
  const id = useId();
  const own = isValidElement(children) ? children.props["aria-describedby"] : undefined;
  return (
    <span className={`pt-tip pt-tip--${side}`}>
      {cloneElement(children, { "aria-describedby": own ? `${own} ${id}` : id })}
      <span role="tooltip" id={id} className="pt-tip-bubble">
        {label}
      </span>
    </span>
  );
}
