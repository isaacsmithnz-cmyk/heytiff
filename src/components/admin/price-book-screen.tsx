"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { Icon } from "@/components/shell/icon";
import { ViewTabs } from "@/components/shell/view-tabs";
import type { SupplierView } from "@/lib/quotes/price-book-server";
import { BookItems } from "./book-items";
import { PriceBook } from "./price-book-panel";
import { LinksPanel } from "./links-panel";
import { SameItemsPanel } from "./same-items-panel";

/* THE PRICE BOOK, its own screen under Admin (2026-10-05; it was a section
   of Quoting). Three faces, switched on the client like Time & Pay's:

   - Items: the book sorted — the most used, the preferred, every shelf in
     families — where a part is put forward.
   - Suppliers: each supplier's price list or invoices taken in, and how it
     prices.
   - Matching: a part under two suppliers' codes made one, and the Studio's
     unit models linked to the order codes they're bought by. */

type Tab = "items" | "suppliers" | "matching";

export function PriceBookScreen({ suppliers }: { suppliers: SupplierView[] }) {
  const router = useRouter();
  const [tab, setTab] = useState<Tab>("items");
  return (
    <div className="page in full">
      <div className="wrap">
        <div className="stg">
          <div className="wb2-crumbline">
            <Link href="/dashboard/admin" className="int-back">
              <Icon name="chevL" size={15} />
              Admin
            </Link>
          </div>
          <ViewTabs
            lead={<h1 className="wb2-h1">Price book</h1>}
            ariaLabel="Price book"
            idPrefix="pbt"
            panelPrefix="pbp"
            active={tab}
            onGo={(k) => setTab(k as Tab)}
            items={[
              { key: "items", label: "Items" },
              { key: "suppliers", label: "Suppliers", count: suppliers.length },
              { key: "matching", label: "Matching" },
            ]}
          />
          <div className="wb2-card">
            <div className="wb2-panel pad">
              <section id={`pbp-${tab}`} role="tabpanel" aria-labelledby={`pbt-${tab}`} tabIndex={-1}>
                {tab === "items" && <BookItems />}
                {tab === "suppliers" && <PriceBook suppliers={suppliers} onImported={() => router.refresh()} />}
                {tab === "matching" && (
                  <>
                    <SameItemsPanel />
                    <LinksPanel />
                  </>
                )}
              </section>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
