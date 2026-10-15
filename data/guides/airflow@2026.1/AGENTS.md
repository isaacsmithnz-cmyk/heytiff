# The ducted airflow guide — published figures, averaged

A guide is a table of what the trade recommends, for Tiff to check a design
against: the same for every business, and changed on a quote by a person.
This is the ducted airflow guide (Isaac, 2026-10-15: "build a section in the
data pack that recommended airflow numbers go through… do plenty of research
and get the averages… it would be good to have a table to work off").

A guide is **not** a data pack. `data/packs/<brand>@<version>/` hold one
manufacturer's own data book, transcribed with no internet, and the app lists
each one as a maker. A guide is many publishers' design figures, averaged; it
is never listed as a maker, and it lives under `data/guides/`, not `packs/`.

## The rules

1. **Published design figures may come from the internet.** Unlike a pack, a
   guide's figures are what manufacturers, standards bodies, codes and
   industry bodies publish: their catalogues, installation guides, handbooks
   and design manuals, online or not.
2. **Every figure lists its sources.** Each value carries `from`: the source,
   the value it gave, and how it was read (published, read off a chart at a
   stated friction, a velocity rule times an area, interpolated between the
   source's own sizes). A figure worked from others says so (`derived`).
3. **The median of independent publishers is the recommendation.** One value
   a publisher; where one publisher gives several figures for the same thing,
   its value is their median. The guide shows the mean, the low, the high and
   how many publishers (`n`) beside it. A small `n` is said, not hidden.
4. **A copy counts once.** A table reprinted by another (ActronAir's flex
   table is Advantage Air's) is one publisher's figure. Documents by one
   publisher count as one between them.
5. **Never a figure from a blog or an unsourced chart.** Nor a retailer's
   advice page or a search snippet. They're kept in `sources.json` marked
   `not_averaged`, with why, so nobody adds them back unknowing.
6. **No number that isn't in the evidence.** Where a table would need a value
   no source gives, it is left out. The research files in `evidence/` are kept
   as gathered, so every average can be audited back to its rows.
7. **A recommendation, never a rule.** The brief, a plan, or the person's
   word overrides any figure here; Tiff says the guide's figure and its reason
   and never settles a size on it without saying so.

## Adding a source, and rebuilding

1. Read the source itself (the PDF or the page, not a summary of it).
2. Add it to the research file in `evidence/` for its topic: a `sources` entry
   (`id`, `publisher`, `title`, `year`, `page`, `url`, `region`, `basis`,
   `notes`, `confidence`) and its `values` rows, each in the units the file
   already uses, saying what the figure is (`kind`, `noise`, `item`,
   `area_basis`…) exactly as its neighbours do.
3. If it's the same document as one already there, or the same publisher, say
   so in `src/lib/guides/airflow-build.ts` (`SAME_DOCUMENT`, `PUBLISHER`). If
   it copies another's table, it counts once: name it beside the original.
4. Where the source feeds a figure the builder reads by name, add it there,
   with the words for how it was read.
5. Rebuild: `npm run guide:airflow`. Every table but `meta.json` is
   rewritten; set `meta.json`'s `built` to the day.
6. `npx jest src/lib/guides`: the build test fails until the committed tables
   are the rebuilt ones, and the rule test until each rule's number is in its
   source's own words.

A new edition of the guide is a new `airflow@<version>/` beside the old; the
app reads the newest.
