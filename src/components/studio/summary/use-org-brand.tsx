"use client";

import { useEffect, useRef, useState } from "react";
import {
  BRAND_STALE_MS,
  BRAND_TTL_S,
  NO_BRAND,
  type OrgBrand,
} from "@/lib/org/brand";

/* THE COMPANY'S FACE ON A TAB THAT STAYS OPEN.

   THE FIRST ANSWER COMES WITH THE PAGE. This hook used to ask for the brand
   at mount, from the Summary sheet itself — and the Summary sheet mounts when
   you press Summary, so the whole chain (load the actions chunk, round-trip
   the server action, mint the signed link, fetch the image) started at the
   moment you were looking at the document. What you saw was the sheet arrive
   unbranded, sit there for a beat, and then RESHAPE: the brand colour decides
   whether there is a frame at all, and the frame's geometry travels with the
   colour, so the arriving letterhead moved every line on the page inward by
   the width of a frame that had not been there a second earlier. A document
   that lays itself out twice reads as broken, and the second layout is the
   one that is right.

   So the studio route reads the brand on the SERVER and hands it in, and the
   sheet's first paint is already framed, already marked. Nothing is fetched
   on mount any more.

   WHAT IS STILL A CLIENT'S JOB is the shelf life. The link is signed for six
   hours, which is longer than the sitting it has to survive but not longer
   than the tab: a studio tab is not left open and watched, it is left open
   and RETURNED TO, so this re-signs when somebody looks at the tab again
   after an hour away. That costs one read on return rather than a timer
   firing into an empty room.

   Fails soft in both directions. A caller with nothing to hand in (the tests,
   any surface that mounts this without a server read) gets the old behaviour
   — ask once at mount — and a session-less context lands on NO_BRAND, where
   every surface falls back to its own platform wording rather than an empty
   frame.

   Actions load lazily (the packActions pattern) so jsdom never parses the
   auth0 runtime. */

const orgActions = () => import("@/app/actions/org");

/* THE MARK IS FETCHED BEFORE THE SHEET IS OPENED. The brand arriving with the
   page fixes the layout jump, but the logo is a second request — and it is
   still made at the moment the masthead first renders, which is the moment
   you are looking at it. Priming the browser cache from wherever this hook is
   mounted (the studio holds it at the top, so: as soon as a design is open)
   means the img element finds its bytes already there.

   A bare `new Image()` and nothing else: no state, no render, no cleanup. The
   fetch it starts is the same one the element would make, so at worst it is
   early, and there is nothing to cancel — the browser drops an unreferenced
   image and keeps the response. */
function primeLogo(url: string | null) {
  if (!url || typeof window === "undefined") return;
  const img = new window.Image();
  img.src = url;
}

/** `served` — what the route already read on the server, signed for the same
    window this hook re-signs for. Omitted, the hook asks for it itself. */
export function useOrgBrand(served?: OrgBrand): OrgBrand {
  const [brand, setBrand] = useState<OrgBrand>(served ?? NO_BRAND);
  /* The served brand is a PAGE-LOAD FACT, not a prop that changes under us —
     held in a ref so the effect below can be honestly empty-dep'd instead of
     silencing exhaustive-deps. A `react-hooks/*` disable anywhere in a file
     makes React Compiler skip the whole component (see studio/canvas.tsx). */
  const servedAtMount = useRef(served);

  useEffect(() => {
    const served = servedAtMount.current;
    let on = true;
    /* what the page was served with is as old as the page, and the page is
       seconds old at mount — so the staleness clock starts here either way */
    let signedAt = served ? Date.now() : 0;

    const load = () => {
      orgActions()
        .then((a) => a.getOrgBrand({ seconds: BRAND_TTL_S }))
        .then((b) => {
          if (!on) return;
          signedAt = Date.now();
          setBrand(b);
          primeLogo(b.logoUrl);
        })
        .catch(() => {
          /* no session, or no permission — the sheet wears its own wording */
        });
    };
    if (served) primeLogo(served.logoUrl);
    else load();

    const onVisible = () => {
      if (document.visibilityState !== "visible") return;
      if (Date.now() - signedAt < BRAND_STALE_MS) return;
      load();
    };
    document.addEventListener("visibilitychange", onVisible);
    return () => {
      on = false;
      document.removeEventListener("visibilitychange", onVisible);
    };
  }, []);

  return brand;
}
