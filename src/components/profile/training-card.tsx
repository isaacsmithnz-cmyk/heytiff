"use client";

import { Icon } from "@/components/shell/icon";
import { StaticCard } from "./section-card";

/** Training pathways — read-only until Training exists in Admin. */
export function TrainingCard() {
  return (
    <StaticCard
      variant="section"
      icon="grad"
      title="Training"
      sub="Pathways &amp; sign-offs · read-only"
    >
      <div className="ro-empty">
        <span className="ei">
          <Icon name="grad" size={20} />
        </span>
        <b>No training pathways yet</b>
        <em>
          Assigned pathways and competency sign-offs will appear here once Training is set up in
          Admin.
        </em>
      </div>
    </StaticCard>
  );
}
