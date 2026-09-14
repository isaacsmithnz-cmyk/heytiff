import "./studio.css";

/* What the Design Studio's route holds while its page is still on its way
   (app/dashboard/studio/loading.tsx).

   The dashboard's own fallback is the shell's light PageSkeleton, and the
   Studio's start screen is dark: clicking Design used to paint a white
   skeleton on the light well, then snap to black when the page arrived. This
   is the same screen's own shapes instead, in the same places — the title
   and the one action in the hero column, the Recent and Library cards in the
   side — and it carries the `.dstudio` root, which is what studio.css keys
   the well's dissolve and the frame's dot grid on. So the well goes dark ON
   THE CLICK, and the page arriving only fills the shapes in.

   The bars are the Recent list's own `.ds-skb` sweep, and the Recent card's
   rows are the same three the list shows while it loads — so after the swap
   they are still there until the designs answer. Nothing here is real and
   nothing is interactive: a held place, not a preview. Static markup, no
   hooks, so the route can prerender it. */
export function StudioSkeleton() {
  return (
    <div className="page in" aria-busy="true" aria-live="polite">
      <div className="dstudio">
        <div className="ds-home">
          <div className="ds-home-stack">
            <span className="ds-sr" role="status">
              Opening the Design Studio
            </span>
            <section className="ds-hero" aria-hidden="true">
              <span className="ds-skb ds-skb-title" />
              <span className="ds-skb ds-skb-cta" />
            </section>
            <div className="ds-home-side" aria-hidden="true">
              <section className="ds-recent">
                <span className="ds-skb ds-skb-ct" />
                <span className="ds-skb ds-skb-tools" />
                <div className="ds-rlist">
                  {[0, 1, 2].map((i) => (
                    <div key={i} className="ds-rcard skel">
                      <span className="ds-rthumb ds-skb" />
                      <span className="ds-rbody">
                        <div className="ds-skb ds-skb-nm" />
                        <div className="ds-skb ds-skb-mt" />
                      </span>
                      <span className="ds-skb ds-skb-wh" />
                    </div>
                  ))}
                </div>
              </section>
              <section className="ds-lib">
                <span className="ds-skb ds-skb-ct" />
                {[0, 1, 2].map((i) => (
                  <span key={i} className="ds-skb ds-skb-sys" />
                ))}
              </section>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
