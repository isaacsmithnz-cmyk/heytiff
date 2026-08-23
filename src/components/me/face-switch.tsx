"use client";

/* THE SWITCH INSIDE A FACE.

   Vehicle, Expenses and Notes each carried their own `ViewTabs` at the card's
   edge — Vehicle|History, Claims|Closed, Notes|Archived. All three are faces
   of the Me card now, and a card-edge strip inside a card-edge strip is not a
   control this app has: `wb2-vslide` IS the card's top edge for the width of
   the live tab, so the second one would be drawing an edge that isn't there.

   So the outer strip keeps the five destinations and the pair each one hides
   behind moves in here, onto `.seg` — the plain light segmented control the
   staff card already uses. The distinction it draws is real and worth keeping
   visible: every one of these three is "what I'm working on" beside "what I've
   put away", which is a filter on one list rather than a different screen.

   It is a real tablist, wired to a real panel, for the same reason ViewTabs is
   — the thing it switches has to announce itself as switching. */

export type Face = {
  key: string;
  label: string;
  /** Absent or zero renders nothing, as the strip's badges do — a grey 0 on
      every switch is noise, and an empty face already says "none". */
  count?: number;
  /** Appended to the accessible name so the number is not a bare digit. */
  countLabel?: (n: number) => string;
};

export function FaceSwitch({
  items,
  active,
  onGo,
  ariaLabel,
  idPrefix,
  panelPrefix,
}: {
  items: readonly Face[];
  active: string;
  onGo: (key: string) => void;
  ariaLabel: string;
  /** `${idPrefix}-${key}` — the button's own id. */
  idPrefix: string;
  /** `${panelPrefix}-${key}` — what it controls. */
  panelPrefix: string;
}) {
  return (
    <div className="me-fsw" role="tablist" aria-label={ariaLabel}>
      <div className="seg">
        {items.map((f) => {
          const on = f.key === active;
          const count = f.count ?? 0;
          return (
            <button
              key={f.key}
              type="button"
              role="tab"
              id={`${idPrefix}-${f.key}`}
              aria-selected={on}
              aria-controls={`${panelPrefix}-${f.key}`}
              /* Only the live one is in the tab order; the arrows walk the
                 rest, which is what a tablist owes a keyboard. */
              tabIndex={on ? 0 : -1}
              className={on ? "on" : undefined}
              onClick={() => onGo(f.key)}
              onKeyDown={moveFocus}
            >
              {f.label}
              {count > 0 && (
                <>
                  <i className="segn" aria-hidden="true">
                    {count}
                  </i>
                  {f.countLabel && <span className="sr-only"> — {f.countLabel(count)}</span>}
                </>
              )}
            </button>
          );
        })}
      </div>
    </div>
  );
}

/** Left/right (and Home/End) walk the switch, as a tablist should. */
function moveFocus(e: React.KeyboardEvent<HTMLButtonElement>) {
  const keys = ["ArrowLeft", "ArrowRight", "Home", "End"];
  if (!keys.includes(e.key)) return;
  const strip = e.currentTarget.closest(".me-fsw");
  if (!strip) return;
  const tabs = [...strip.querySelectorAll<HTMLButtonElement>('[role="tab"]')];
  const i = tabs.indexOf(e.currentTarget);
  if (i < 0) return;
  e.preventDefault();
  const next =
    e.key === "Home"
      ? 0
      : e.key === "End"
        ? tabs.length - 1
        : (i + (e.key === "ArrowRight" ? 1 : -1) + tabs.length) % tabs.length;
  tabs[next].focus();
}
