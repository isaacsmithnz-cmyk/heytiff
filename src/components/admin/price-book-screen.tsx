"use client";

import { useRouter } from "next/navigation";
import { Suspense, use, useState } from "react";
import { Button } from "@/components/parts/button";
import { Dialog } from "@/components/parts/dialog";
import { Row, RowList } from "@/components/parts/row";
import { ViewTabs } from "@/components/parts/tabs";
import { Loading } from "@/components/parts/states";
import { SectionTitle } from "@/components/settings/parts";
import { pricingWords } from "@/lib/quotes/price-book";
import type { SupplierView } from "@/lib/quotes/price-book-server";
import type { FirstBook } from "@/lib/quotes/book-pack";
import { BookItems } from "./book-items";
import { PriceBook } from "./price-book-panel";
import { LinksPanel } from "./links-panel";
import { SameItemsPanel } from "./same-items-panel";
import { PricedParts, type PricedPartsData } from "./priced-parts";
import "@/components/settings/price-book.css";

export type { PricedPartsData };

/* SETTINGS › PRICE BOOK (v2, 25 October 2026; the mock's Price book board).
   Its own section, four views of it as soft tabs under the title (rule 29),
   switched in the page:

   - Items: the book itself, searched and shown by what's used most, what's
     preferred or a shelf, each part with every supplier's price, where one
     is put forward.
   - Suppliers: each supplier's price list or invoices taken in, and how it
     prices.
   - Matching: a part under two suppliers' codes made one, and the Studio's
     unit models linked to the order codes they're bought by.
   - What prices each part: the item each common component is priced from,
     the swaps made often enough to ask about, the ranges of the parts that
     come in sizes and the kits they make (it was on Quoting).

   Add items, on the title, is where prices come in: it asks which
   supplier they're from and opens that supplier, where its price list and
   its invoices go in. */

type Tab = "items" | "suppliers" | "matching" | "parts";

export function PriceBookScreen({
  suppliers,
  markupPct,
  parts,
  first,
}: {
  suppliers: SupplierView[];
  /** the materials markup, which a part sells at over what it costs */
  markupPct: number | null;
  /** read over the whole book, so it streams into its own tab */
  parts: Promise<PricedPartsData>;
  /** the Most used parts Items opens on, read with the page and streamed in */
  first?: Promise<FirstBook>;
}) {
  const router = useRouter();
  const [tab, setTab] = useState<Tab>("items");
  const [picking, setPicking] = useState(false);
  /* a supplier opened from Add items: its panel is drawn again around it */
  const [opened, setOpened] = useState<{ n: number; key: string | null } | null>(null);

  const open = (key: string | null) => {
    setPicking(false);
    setTab("suppliers");
    setOpened((o) => ({ n: (o?.n ?? 0) + 1, key }));
  };

  return (
    <>
      <SectionTitle
        tools={
          <Button kind="second" size={36} onClick={() => (suppliers.length ? setPicking(true) : open(null))}>
            Add items
          </Button>
        }
      >
        Price book
      </SectionTitle>
      <ViewTabs
        ariaLabel="Price book"
        idPrefix="pbt"
        panelPrefix="pbp"
        current={tab}
        onGo={(k) => {
          setTab(k as Tab);
          /* a supplier opened from Add items opens once, not on every visit to the tab */
          setOpened(null);
        }}
        items={[
          { key: "items", label: "Items" },
          { key: "suppliers", label: "Suppliers" },
          { key: "matching", label: "Matching" },
          { key: "parts", label: "What prices each part" },
        ]}
      />
      <section id={`pbp-${tab}`} role="tabpanel" aria-labelledby={`pbt-${tab}`} tabIndex={-1} className="st2-pb-panel">
        {tab === "items" && <BookItems markupPct={markupPct} first={first} />}
        {tab === "suppliers" && (
          <PriceBook
            key={opened?.n ?? 0}
            suppliers={suppliers}
            initialOpen={opened?.key ?? null}
            initialAdding={opened != null && opened.key === null}
            onImported={() => router.refresh()}
          />
        )}
        {tab === "matching" && (
          <>
            <SameItemsPanel />
            <LinksPanel />
          </>
        )}
        {tab === "parts" && (
          <Suspense fallback={<Loading what="Reading what prices each part" />}>
            <PartsTab data={parts} />
          </Suspense>
        )}
      </section>

      {picking && (
        <Dialog
          heading="Which supplier are they from?"
          width={560}
          onClose={() => setPicking(false)}
          foot={
            <>
              <Button kind="second" size={36} onClick={() => setPicking(false)}>
                Cancel
              </Button>
              <Button kind="second" size={36} onClick={() => open(null)}>
                Add a supplier
              </Button>
            </>
          }
        >
          <RowList label="Suppliers">
            {suppliers.map((s) => (
              <Row key={s.key} name={s.name} line={pricingWords(s)} onClick={() => open(s.key)} />
            ))}
          </RowList>
        </Dialog>
      )}
    </>
  );
}

/** What prices each part, once its read has come. */
function PartsTab({ data }: { data: Promise<PricedPartsData> }) {
  return <PricedParts {...use(data)} />;
}
