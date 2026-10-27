"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { Button } from "@/components/parts/button";
import { Dialog } from "@/components/parts/dialog";
import { Fade } from "@/components/parts/fade";
import { Field, TextInput } from "@/components/parts/field";
import { StateWord } from "@/components/parts/state";
import { Group, Wrong } from "@/components/settings/parts";
import { saveQuoteSettings } from "@/app/actions/quote-settings";
import type { ComponentKey } from "@/lib/quotes/components";
import type { GroupKey } from "@/lib/quotes/install-groups";
import type { ComponentGroup, ComponentOffer, ComponentShortlist } from "@/lib/quotes/settings-query";
import type { QuoteSettings } from "@/lib/quotes/settings";
import type { Habit } from "@/lib/quotes/habits";
import type { RangeView } from "@/lib/quotes/ranges";
import { withCleanup } from "@/lib/ui/with-cleanup";
import { CommonItems } from "./common-items";
import { KitsSection } from "./quoting-kits";
import { dollars, Oops } from "./pb-bits";

/* PRICE BOOK › WHAT PRICES EACH PART (it was on Quoting until 25 October
   2026; Isaac: "The price book will be fairly detailed. So it will need its
   own section").

   COMMON INSTALL ITEMS (common-items.tsx, 28 October 2026): every part a
   kit prices, in eight groups. A part priced from ONE price-book item — the
   LOWEST priced per metre or each, by default (Isaac, 2026-09-30) — opens
   its shortlist here (Choose another) and a person picks one; Use lowest
   goes back. The same item at several suppliers is a row each, the lowest
   in the state's green. A roll's length is read off the item's name; where
   it can't be, it can be typed, and a metre can't be priced until it is.

   HABITS (slice 13.2): a swap made on three quotes or more, offered as the
   preferred item, one press to say yes.

   A part a kit needs at a size comes from the business's own range of it
   (quoting-ranges.tsx), opened from its group; the KITS those parts price
   are at the business's own example (quoting-kits.tsx). */

export type PricedPartsData = {
  settings: QuoteSettings;
  components: ComponentShortlist[];
  /** the business's ranges of the parts that come in sizes */
  ranges: RangeView[];
  /** swaps made on three quotes or more, asked about (habits.ts) */
  habits: Habit[];
  /** the business's suppliers, for a group bought from one of them */
  suppliers: { key: string; name: string }[];
};

export function PricedParts({ settings, components, ranges, habits, suppliers }: PricedPartsData) {
  const router = useRouter();
  const [saved, setSaved] = useState(settings);
  const [busy, setBusy] = useState(false);
  const [wrong, setWrong] = useState<string | null>(null);
  const [open, setOpen] = useState<ComponentKey | null>(null);

  /* the preferred items are part of the quoting settings, saved whole */
  const save = (next: QuoteSettings) => {
    setBusy(true);
    setWrong(null);
    return withCleanup(async () => {
      try {
        const res = await saveQuoteSettings(next);
        if (!res.ok) {
          setWrong(res.reason);
          return false;
        }
        setSaved(res.settings);
        router.refresh();
        return true;
      } catch {
        setWrong("Couldn't save that. Check your connection and try again.");
        return false;
      }
    }, () => setBusy(false));
  };

  const choose = (key: ComponentKey, offer: ComponentOffer, rollM: number | null) =>
    save({ ...saved, preferred: { ...saved.preferred, [key]: { supplierKey: offer.supplierKey, code: offer.code, rollM } } }).then((ok) => {
      if (ok) setOpen(null);
    });

  const backToLowest = (key: ComponentKey) => {
    const preferred = { ...saved.preferred };
    delete preferred[key];
    return save({ ...saved, preferred });
  };

  /* a supplier for a whole group, or back to the lowest price */
  const buyFrom = (group: GroupKey, supplierKey: string | null) => {
    const groupSuppliers = { ...saved.groupSuppliers };
    if (supplierKey) groupSuppliers[group] = supplierKey;
    else delete groupSuppliers[group];
    return save({ ...saved, groupSuppliers });
  };

  const opened = components.find((c) => c.key === open) ?? null;

  return (
    <>
      <CommonItems
        components={components}
        ranges={ranges}
        suppliers={suppliers}
        groupSuppliers={saved.groupSuppliers}
        busy={busy}
        wrong={opened ? null : wrong}
        onChoose={setOpen}
        onBuyFrom={(group, key) => void buyFrom(group, key)}
      />

      {opened && (
        <ChooseItem
          key={opened.key}
          c={opened}
          busy={busy}
          wrong={wrong}
          onChoose={(offer, rollM) => void choose(opened.key, offer, rollM)}
          onLowest={() =>
            void backToLowest(opened.key).then((ok) => {
              if (ok) setOpen(null);
            })
          }
          onClose={() => setOpen(null)}
        />
      )}

      {habits.length > 0 && <HabitsGroup habits={habits} onDone={() => router.refresh()} />}

      <KitsSection />
    </>
  );
}

/* ONE COMPONENT'S SHORTLIST, opened: every item that could price it, a row
   each supplier and pack, lowest a metre or each first; Use this on any.
   One chosen over the lowest can go back to it. For a part sold by the
   metre, the chosen item's roll length can be typed where its name doesn't
   say it. */
function ChooseItem({
  c,
  busy,
  wrong,
  onChoose,
  onLowest,
  onClose,
}: {
  c: ComponentShortlist;
  busy: boolean;
  wrong: string | null;
  onChoose: (offer: ComponentOffer, rollM: number | null) => void;
  onLowest: () => void;
  onClose: () => void;
}) {
  const pick = c.chosen;
  const [roll, setRoll] = useState(pick?.group.rollM ? String(pick.group.rollM) : "");
  const rows = c.groups.flatMap((g: ComponentGroup) => g.offers.map((o, i) => ({ g, o, low: i === 0 && g.offers.length > 1 })));
  return (
    <Dialog
      heading={`What prices ${c.label.toLowerCase()}`}
      width={720}
      onClose={onClose}
      foot={
        <Button kind="second" size={36} onClick={onClose}>
          Done
        </Button>
      }
    >
      <div className="st2-pb-dlg">
        {pick?.overridden && (
          <div className="st2-pb-acts">
            <Button kind="second" size={36} disabled={busy} onClick={onLowest}>
              Go back to the lowest
            </Button>
          </div>
        )}
        {c.unit === "m" && pick && (
          <div className="st2-pb-rule">
            <Field label={`Roll length of ${pick.offer.code}, metres`}>
              <TextInput inputMode="decimal" value={roll} disabled={busy} onChange={(e) => setRoll(e.target.value)} />
            </Field>
            <span />
            <Button kind="second" size={36} disabled={busy || !(Number(roll) > 0)} onClick={() => onChoose(pick.offer, Number(roll))}>
              Save the length
            </Button>
          </div>
        )}
        {wrong && <Oops>{wrong}</Oops>}
        <div className="st2-pb-rows" role="table" aria-label={`Items that could price ${c.label}`}>
          <div className="st2-pb-grid st2-pb-choices st2-pb-head" role="row">
            <span role="columnheader">Item</span>
            <span role="columnheader" className="st2-pb-fig">
              {c.unit === "m" ? "A metre" : "Each"}
            </span>
            <span role="columnheader">
              <span className="sr-only">Choose it</span>
            </span>
          </div>
          {rows.map(({ g, o, low }) => {
            const on = pick?.offer.code === o.code && pick.offer.supplierKey === o.supplierKey;
            const line = [o.code, o.pack ? `${o.supplierName}, ${o.pack}` : o.supplierName, g.uses ? `on ${g.uses} quote${g.uses === 1 ? "" : "s"}` : null]
              .filter(Boolean)
              .join(", ");
            return (
              <div key={`${o.supplierKey}:${o.code}`} className={on ? "st2-pb-grid st2-pb-choices on" : "st2-pb-grid st2-pb-choices"} role="row">
                <span role="cell" className="st2-pb-name">
                  <b>
                    <Fade>{g.name}</Fade>
                  </b>
                  <span className="st2-pb-line">
                    <Fade>{line}</Fade>
                  </span>
                </span>
                <span role="cell" className={low ? "st2-pb-fig st2-pb-low" : "st2-pb-fig"}>
                  {o.perUnitCents == null ? (c.unit === "m" ? `${dollars(o.buyCents)}, no length` : dollars(o.buyCents)) : dollars(o.perUnitCents)}
                </span>
                <span role="cell" className="st2-pb-act">
                  {on ? (
                    <StateWord tone="good">In use</StateWord>
                  ) : (
                    <Button kind="second" size={32} disabled={busy} aria-label={`Use ${o.code} from ${o.supplierName}`} onClick={() => onChoose(o, null)}>
                      Use this
                    </Button>
                  )}
                </span>
              </div>
            );
          })}
        </div>
      </div>
    </Dialog>
  );
}

/** HABITS, asked about (slice 13.2): a swap made on three quotes or more,
    offered as the preferred item, one press to say yes. */
function HabitsGroup({ habits, onDone }: { habits: Habit[]; onDone: () => void }) {
  const [busy, setBusy] = useState<string | null>(null);
  const [done, setDone] = useState<Set<string>>(new Set());
  const [wrong, setWrong] = useState<string | null>(null);
  const prefer = async (h: Habit) => {
    const ref = `${h.to.supplierKey}|${h.to.code}`;
    setBusy(ref);
    setWrong(null);
    const r = await fetch("/api/quoting/preferred", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ ref, on: true }) }).catch(() => null);
    setBusy(null);
    if (r?.ok) {
      setDone((d) => new Set(d).add(ref));
      onDone();
    } else setWrong("That couldn't be saved. Try again.");
  };
  return (
    <Group heading="Habits">
      <ul className="st2-pb-rows" aria-label="Habits">
        {habits.map((h) => {
          const ref = `${h.to.supplierKey}|${h.to.code}`;
          return (
            <li key={ref + h.from.code} className="st2-pb-grid st2-pb-lines">
              <span className="st2-pb-name">
                <span>{`You've swapped ${h.from.code} for ${h.to.code} on ${h.quotes} quotes.`}</span>
                <span className="st2-pb-line">
                  <Fade>{h.to.name}</Fade>
                </span>
              </span>
              {done.has(ref) ? (
                <StateWord tone="good">Preferred</StateWord>
              ) : (
                <Button kind="second" size={32} disabled={busy !== null} onClick={() => void prefer(h)}>
                  {`Make ${h.to.code} your preferred`}
                </Button>
              )}
            </li>
          );
        })}
      </ul>
      {wrong && <Wrong>{wrong}</Wrong>}
    </Group>
  );
}
