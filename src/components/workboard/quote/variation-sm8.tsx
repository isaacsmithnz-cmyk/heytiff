"use client";

import { useState } from "react";
import { Button } from "@/components/parts/button";
import { variationInSm8, type Variation } from "@/lib/quotes/lines-job";
import { variationSentLine } from "@/lib/quotes/sm8-variation-plan";

/* A VARIATION IN SERVICEM8, in the quote's rail where the accepted quote's
   send card sits (Isaac, 2026-10-18, decision 21: extra lines on the
   original job). What went: "Sent to ServiceM8 as 3 lines on job 3209". A
   variation accepted whose lines haven't all gone offers the send again
   (the quote page presses it the moment the variation is accepted); one
   that has all gone offers nothing, since nothing goes twice. */

export function VariationSm8({
  variation,
  error,
  onSend,
}: {
  variation: Variation;
  /** why the last press didn't go, in the send's own words */
  error: string | null;
  onSend: () => Promise<void>;
}) {
  const [busy, setBusy] = useState(false);
  const line = variationSentLine(variation);
  const again = !!variation.acceptedAt && !variationInSm8(variation);
  if (!line && !again && !error) return null;
  return (
    <section className="wb2-jcsec" aria-label="To ServiceM8">
      <div className="wb2-jcdhead">
        <b>To ServiceM8</b>
        <em>{`Variation ${variation.n}, added to the job`}</em>
      </div>
      {line && <p className="wb2-shtext">{line}</p>}
      {error && <p className="wb2-sherr">{error}</p>}
      {again && (
        <div className="wb2-jqacts">
          <Button
            kind="second"
            size={32}
            disabled={busy}
            onClick={() => {
              setBusy(true);
              void onSend().finally(() => setBusy(false));
            }}
          >
            {busy ? "Sending" : `Send variation ${variation.n} to ServiceM8`}
          </Button>
        </div>
      )}
    </section>
  );
}
