"use client";

import { useEffect, useState } from "react";
import { NO_BRAND, type OrgBrand } from "@/lib/org/brand";

/* THE COMPANY'S FACE ON A TAB THAT STAYS OPEN.

   The logo is a private object behind a signed link, so a brand read once at
   mount is a letterhead with a shelf life. The print path sidesteps this by
   signing at the moment of the press; the Summary sheet cannot, because it is
   on screen from the moment you open the design.

   So: signed for six hours, and re-signed when somebody looks at the tab
   again after an hour away. That is the shape of the problem — a studio tab
   is not left open and watched, it is left open and returned to — and it
   costs one read on return rather than a timer that fires into an empty room.

   Fails soft in both directions. A session-less context (the dev harness) and
   a workspace that has set nothing both land on NO_BRAND, and every surface
   falls back to its own platform wording rather than an empty frame.

   Actions load lazily (the packActions pattern) so jsdom never parses the
   auth0 runtime. */

const orgActions = () => import("@/app/actions/org");

/** six hours, matching what the customer's live link signs for */
const TTL_S = 21600;
/** re-sign on return once the link is this old — well inside the TTL */
const STALE_MS = 3_600_000;

export function useOrgBrand(): OrgBrand {
  const [brand, setBrand] = useState<OrgBrand>(NO_BRAND);

  useEffect(() => {
    let on = true;
    let signedAt = 0;

    const load = () => {
      orgActions()
        .then((a) => a.getOrgBrand({ seconds: TTL_S }))
        .then((b) => {
          if (!on) return;
          signedAt = Date.now();
          setBrand(b);
        })
        .catch(() => {
          /* no session, or no permission — the sheet wears its own wording */
        });
    };
    load();

    const onVisible = () => {
      if (document.visibilityState !== "visible") return;
      if (Date.now() - signedAt < STALE_MS) return;
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
