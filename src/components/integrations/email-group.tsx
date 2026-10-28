"use client";

import { useState } from "react";
import { Button } from "@/components/parts/button";
import { useToast } from "@/components/parts/toast";
import { Empty } from "@/components/parts/states";
import { Facts, Group, Wrong } from "@/components/settings/parts";
import { auDayOf, fmtAuWeekdayDate } from "@/lib/au-dates";
import { makeTiffEmailAddress } from "@/app/actions/email-in";
import { withCleanup } from "@/lib/ui/with-cleanup";

/* SETTINGS › INTEGRATIONS, EMAIL TO TIFF (Isaac, 28 October 2026, the mock
   he said "Build it in" to). The business's one address: forward a builder's
   email to it and Tiff reads it into a job, in the forwarder's Conversations.
   Taken only from the team's own addresses. Making a new address stops the
   old one, so it says so before it does. */

export type EmailInProps = {
  /** null until the business makes one */
  address: string | null;
  last: { at: string; from: string; subject: string | null; refused: boolean } | null;
};

export function EmailGroup({ address: initial, last }: EmailInProps) {
  const toast = useToast();
  const [address, setAddress] = useState(initial);
  const [busy, setBusy] = useState(false);
  const [wrong, setWrong] = useState<string | null>(null);

  const make = () => {
    /* worked out here, not in the try: the compiler can't lower a value block inside one */
    const done = address ? "New address made; the old one has stopped" : "Tiff's address made";
    setBusy(true);
    setWrong(null);
    void withCleanup(async () => {
      try {
        const r = await makeTiffEmailAddress();
        if (!r.ok) {
          setWrong(r.error);
          return;
        }
        setAddress(r.address);
        toast({ text: done });
      } catch {
        setWrong("The address couldn't be made. Check your connection and try again.");
      }
    }, () => setBusy(false));
  };

  const copy = () =>
    void (navigator.clipboard?.writeText(address ?? "") ?? Promise.reject()).then(
      () => toast({ text: "Address copied" }),
      () => setWrong("The address couldn't be copied. Select it and copy it yourself.")
    );

  const lastWords = last
    ? `${fmtAuWeekdayDate(auDayOf(last.at))}, from ${last.from}${last.subject ? `: ${last.subject}` : ""}${last.refused ? " (not taken: not from the team)" : ""}`
    : null;

  const makeButton = (
    <Button kind={address ? "second" : "main"} size={32} disabled={busy} onClick={make}>
      {address ? "Make a new address" : "Make Tiff's address"}
    </Button>
  );
  return (
    <Group heading="Email to Tiff" tools={address ? makeButton : undefined}>
      {wrong && <Wrong>{wrong}</Wrong>}
      {address ? (
        <Facts
          rows={[
            {
              label: "Forward to",
              value: (
                <span className="int-email">
                  <b className="int-email-addr">{address}</b>
                  <Button kind="quiet" size={32} onClick={copy}>
                    Copy the address
                  </Button>
                </span>
              ),
            },
            { label: "Taken from", value: "Your team, from the email address on their card" },
            { label: "Last in", value: lastWords },
          ]}
        />
      ) : (
        <Empty what="No address for Tiff yet" action={makeButton} />
      )}
    </Group>
  );
}
