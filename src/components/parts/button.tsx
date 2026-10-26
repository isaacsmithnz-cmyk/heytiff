import Link from "next/link";
import type { AnchorHTMLAttributes, ButtonHTMLAttributes, ReactElement, ReactNode, Ref } from "react";
import { Icon } from "@/components/shell/icon";

/* THE BUTTONS (docs/design.md, rules 22 to 28). Main is blue with white
   words, one per area, and no button is black (22); second is white with a
   thin outline (23); quiet has no edge until you point at it (24); delete is
   a red word on the second button, and the red block only asks "are you
   sure" (25). Three heights, 32 in rows, 36 in forms, 44 on a phone (28).

   A hover is one change, a fill (23): the second, quiet and delete buttons
   take `--hov`, and the two solid ones keep their colour. A press moves 1px
   (old law 18) and changes nothing else, so blue never darkens. Blue is
   spelled `--press`, the token for the colour of pressing (rule 17).

   Every rule that sets what the `.fg button` reset clears (font, colour,
   fill, border, cursor) is two classes, (0,2,0), so it beats the reset's
   (0,1,1) inside the frame and in a portal alike. */

export type ButtonKind = "main" | "second" | "quiet" | "delete" | "danger";
export type ControlSize = 32 | 36 | 44;

type Common = {
  kind?: ButtonKind;
  size?: ControlSize;
  /** a leading glyph: a name from the app's Icon set, or an element */
  icon?: string | ReactElement;
  children: ReactNode;
  className?: string;
};

type AsButton = Common &
  Omit<ButtonHTMLAttributes<HTMLButtonElement>, "className" | "children"> & {
    href?: undefined;
    ref?: Ref<HTMLButtonElement>;
  };

type AsLink = Common &
  Omit<AnchorHTMLAttributes<HTMLAnchorElement>, "className" | "children" | "href"> & {
    href: string;
    disabled?: boolean;
    ref?: Ref<HTMLAnchorElement>;
  };

export type ButtonProps = AsButton | AsLink;

/** A path inside the app goes through next/link; anything else is a plain anchor. */
export const isInternalHref = (href: string) => href.startsWith("/") && !href.startsWith("//");

function lead(icon: Common["icon"], px: number) {
  if (icon === undefined) return null;
  return (
    <span className="pt-btn__icon" aria-hidden="true">
      {typeof icon === "string" ? <Icon name={icon} size={px} /> : icon}
    </span>
  );
}

export function buttonClass(kind: ButtonKind, size: ControlSize, extra?: string) {
  return ["pt-btn", `pt-btn--${size}`, `pt-btn--${kind}`, extra].filter(Boolean).join(" ");
}

export function Button(props: ButtonProps) {
  const { kind = "second", size = 36, icon, children, className } = props;
  const cls = buttonClass(kind, size, className);
  const body = (
    <>
      {lead(icon, size === 44 ? 20 : 16)}
      <span className="pt-btn__word">{children}</span>
    </>
  );

  if (props.href !== undefined) {
    const { kind: _k, size: _s, icon: _i, children: _c, className: _n, href, disabled, ...rest } = props;
    if (disabled) {
      // a link that can't be followed has no href, so nothing can follow it
      return (
        <a {...rest} className={cls} aria-disabled="true">
          {body}
        </a>
      );
    }
    if (isInternalHref(href)) {
      return (
        <Link {...rest} href={href} className={cls}>
          {body}
        </Link>
      );
    }
    return (
      <a {...rest} href={href} className={cls}>
        {body}
      </a>
    );
  }

  const { kind: _k, size: _s, icon: _i, children: _c, className: _n, href: _h, type = "button", ...rest } = props;
  return (
    <button {...rest} type={type} className={cls}>
      {body}
    </button>
  );
}

/* LINKS (rule 26). Ink, underlined: going somewhere, not doing something.
   It takes the size of the text it sits in, so it reads the same in a
   sentence and beside a button. */
export type LinkButtonProps = Omit<AnchorHTMLAttributes<HTMLAnchorElement>, "className" | "href"> & {
  href: string;
  children: ReactNode;
  className?: string;
  ref?: Ref<HTMLAnchorElement>;
};

export function LinkButton({ href, children, className, ...rest }: LinkButtonProps) {
  const cls = ["pt-link", className].filter(Boolean).join(" ");
  if (isInternalHref(href)) {
    return (
      <Link {...rest} href={href} className={cls}>
        {children}
      </Link>
    );
  }
  return (
    <a {...rest} href={href} className={cls}>
      {children}
    </a>
  );
}

/* ICON-ONLY (rule 27). Close, clear, the microphone and the ‹ › of a date,
   and a chat's Send and Minimise (Isaac, 20 October 2026: Tiff's chat as
   Claude's), and nothing else, so the glyph is one of those by type. Square, in
   the quiet dress, and its label is required: it is the button's only word
   for a screen reader, and a `title` is not a label (rule 25). */
export type IconGlyph = "close" | "clear" | "mic" | "earlier" | "later" | "send" | "minimise" | "add";

const GLYPH: Record<IconGlyph, string> = { close: "x", clear: "x", mic: "mic", earlier: "chevL", later: "chevR", send: "arrowUp", minimise: "minus", add: "plus" };

export type IconButtonProps = Omit<ButtonHTMLAttributes<HTMLButtonElement>, "className" | "children" | "aria-label"> & {
  glyph: IconGlyph;
  label: string;
  size?: ControlSize;
  /** quiet, or main for a chat's Send: blue once there is something to send */
  kind?: "quiet" | "main";
  className?: string;
  ref?: Ref<HTMLButtonElement>;
};

export function IconButton({ glyph, label, size = 36, kind = "quiet", className, type = "button", ...rest }: IconButtonProps) {
  return (
    <button {...rest} type={type} aria-label={label} className={buttonClass(kind, size, ["pt-btn--icon", className].filter(Boolean).join(" "))}>
      {lead(GLYPH[glyph], size === 32 ? 16 : 20)}
    </button>
  );
}
