"use client";

/* TIME TO REVIEW: once the reminder period has passed, a line above the
   step that says how long it's been and leads with the review (rule 40).
   Its cross only puts it away for now. */

import React from "react";
import { Button, IconButton } from "@/components/parts/button";
import { StateWord } from "@/components/parts/state";

export function ReviewDue({ daysSince = null, message = null, onReview, onDismiss }: {
  daysSince?: number | null; message?: string | null; onReview: () => void; onDismiss: () => void;
}) {
  const age = daysSince != null && daysSince > 0 ? `Last reviewed ${daysSince} day${daysSince === 1 ? "" : "s"} ago` : "Time to review";
  return (
    <div className="rc-review">
      <StateWord tone="look">{age}</StateWord>
      <p>{message}</p>
      <Button size={32} onClick={onReview}>Review rates</Button>
      <IconButton glyph="close" label="Close the reminder" size={32} onClick={onDismiss} />
    </div>
  );
}
