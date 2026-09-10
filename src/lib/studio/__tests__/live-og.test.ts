import { createDesign } from "../document";
import { NO_BRAND, type OrgBrand } from "@/lib/org/brand";
import { liveMetadata, liveOgModel, type LiveShare } from "../live-og";

/* THE PREVIEW SAYS WHAT THE SHEET'S HEAD SAYS, AND NO MORE.

   These pin the words a messaging app shows beside a live design link. The
   line that matters is the one about what a preview may not reveal: a
   preview is cached by whichever service carried the link and sits on a
   lock screen, so the client's name and every figure stay off it, and a
   closed link says nothing about the design it used to point at. */

const brand: OrgBrand = { ...NO_BRAND, name: "Diamond Air", color: "#1c4f63" };

function live(over: Partial<{ name: string; site: string; client: string; jobNumber: string; variant: string | null; brand: OrgBrand }> = {}): LiveShare {
  const doc = createDesign({ name: over.name ?? "Rose St split system", mode: "blank", now: "2026-09-15T02:00:00.000Z" });
  doc.meta.site = over.site ?? "14 Rose St\nFitzroy VIC 3065";
  doc.meta.client = over.client ?? "J. Smith";
  doc.meta.jobNumber = over.jobNumber ?? "1042";
  doc.meta.variantLabel = over.variant ?? null;
  doc.meta.updatedAt = "2026-09-15T02:00:00.000Z";
  return { kind: "live", doc, brand: over.brand ?? brand, shareCreatedAt: "2026-09-16T00:00:00.000Z" };
}

describe("the live link's preview", () => {
  it("names the design, whose it is, when, and how long the link is open", () => {
    const m = liveOgModel(live());
    expect(m.closed).toBe(false);
    expect(m.org).toBe("Diamond Air");
    expect(m.headline).toBe("Rose St split system");
    expect(m.line).toBe("Design summary, prepared 15 September 2026");
    expect(m.footer).toBe("Link open until 30 September");
    expect(m.title).toBe("Rose St split system, design summary from Diamond Air");
    expect(m.description).toBe("Prepared by Diamond Air on 15 September 2026. Link open until 30 September.");
    expect(m.bandColor).toBe("#1c4f63");
  });

  it("never carries the client's name or the job number", () => {
    const m = liveOgModel(live({ client: "Priya Nair", jobNumber: "1042" }));
    const everything = Object.values(m).filter((v): v is string => typeof v === "string").join(" ");
    expect(everything).not.toMatch(/Priya|Nair|1042/);
  });

  it("falls back from the name to the site's first line, then to 'Design'", () => {
    expect(liveOgModel(live({ name: "   " })).headline).toBe("14 Rose St");
    expect(liveOgModel(live({ name: "", site: "\n  \n" })).headline).toBe("Design");
  });

  it("names the variant in the line, lower-cased", () => {
    expect(liveOgModel(live({ variant: "Option 2" })).line).toBe("Design summary, option 2, prepared 15 September 2026");
  });

  it("is HeyTiff's when the business has no name on file, and wears no band without a colour", () => {
    const m = liveOgModel(live({ brand: NO_BRAND }));
    expect(m.org).toBe("HeyTiff");
    expect(m.title).toBe("Rose St split system, design summary from HeyTiff");
    expect(m.bandColor).toBeNull();
  });

  it("says nothing about a design behind a missing or expired link", () => {
    for (const share of [{ kind: "missing" }, { kind: "expired" }] as LiveShare[]) {
      const m = liveOgModel(share);
      expect(m.closed).toBe(true);
      expect(m.headline).toBe("This design link is no longer open");
      expect(m.title).toBe("Live design — HeyTiff");
      expect(m.bandColor).toBeNull();
      expect(JSON.stringify(m)).not.toMatch(/Rose|Diamond|September/);
    }
  });

  it("builds the page's metadata from the same words, still unindexed", () => {
    const md = liveMetadata(live());
    expect(md.title).toBe("Rose St split system, design summary from Diamond Air");
    expect(md.robots).toEqual({ index: false, follow: false });
    expect(md.openGraph).toMatchObject({ title: md.title, description: md.description, siteName: "Diamond Air", type: "website" });
    expect(md.twitter).toMatchObject({ card: "summary_large_image", title: md.title });
    // the picture comes from the file convention, so no images entry here
    expect(md.openGraph).not.toHaveProperty("images");
  });
});
