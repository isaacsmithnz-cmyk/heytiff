"use client";

import { useState } from "react";
import { Tick } from "@/components/parts/tick";
import { StateWord } from "@/components/parts/state";
import type { BirthdaySharing } from "@/lib/team/birthday-sharing";
import type { ShareBirthday } from "./types";

/* YOUR BIRTHDAY ON THE OTHERS' TODAY (Isaac, 6 November 2026: "Staff have to
   opt in, tick to share bday, tick to share age"), on your own card, as the
   phone's card has them (heytiff-mobile card.tsx, Birthday): Share my
   birthday and Share my age, both off until you tick them. Each tick saves
   itself (rule 32); your age goes with your birthday, so it can't be ticked
   while the birthday isn't shared, and unticking the birthday unticks it.
   A save that fails puts the ticks back and says why. */
export function BirthdayTicks({ initial, onShare }: { initial: BirthdaySharing; onShare: ShareBirthday }) {
  const [now, setNow] = useState<BirthdaySharing>(initial);
  const [said, setSaid] = useState<string | null>(null);

  const save = async (change: Partial<BirthdaySharing>) => {
    const before = now;
    const next = { ...now, ...change };
    if (!next.shareBirthday) next.shareAge = false;
    setNow(next);
    setSaid(null);
    const got = await onShare(change).catch(() => null);
    if (got?.ok) {
      setNow(got.sharing);
      return;
    }
    setNow(before);
    setSaid(got?.error ?? "Couldn’t reach HeyTiff. Try again.");
  };

  return (
    <span className="pbday">
      <Tick label="Share my birthday" checked={now.shareBirthday} onChange={(on) => void save({ shareBirthday: on })} />
      <Tick
        label="Share my age"
        checked={now.shareAge}
        disabled={!now.shareBirthday}
        onChange={(on) => void save({ shareAge: on })}
      />
      {said && <StateWord tone="wrong">{said}</StateWord>}
    </span>
  );
}
