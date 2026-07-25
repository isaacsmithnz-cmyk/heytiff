/* GAZETTED 2026 + 2027 STATEWIDE FULL-DAY HOLIDAYS, PER STATE.

   Transcribed by hand from the research dossier's official per-state lists —
   NOT generated from holiday-rules.ts. That is the whole point: the engine is
   asserted against this table, so deriving the table from the engine would
   assert nothing. Every row below is a date the state itself published.

   Included: statewide, full-day, and (for provisional-tier days) only where the
   dossier records an actual gazetted/proclaimed date for that year.
   Excluded per the module's scope, and listed under each state so the omissions
   are visible: part-day holidays, regional/show days, and bank-only days.

   NAMES: the dossier's own name for each row, except NSW, where the 25 rows
   already seeded in prod from nsw.gov.au are authoritative ("Boxing Day
   (additional day)" rather than the dossier's "Additional Day (for Boxing
   Day)" — same day, same source page, different rendering). */

export type GazettedRow = { date: string; name: string };

export const GAZETTED: Record<string, Record<number, GazettedRow[]>> = {
  /* NSW — nsw.gov.au/about-nsw/public-holidays, cross-checked against Fair Work.
     Excluded: Bank Holiday (3 Aug 2026, 2 Aug 2027) — "not a declared public
     holiday"; local public holidays and local event days (area-specific). */
  NSW: {
    2026: [
      { date: "2026-01-01", name: "New Year's Day" },
      { date: "2026-01-26", name: "Australia Day" },
      { date: "2026-04-03", name: "Good Friday" },
      { date: "2026-04-04", name: "Easter Saturday" },
      { date: "2026-04-05", name: "Easter Sunday" },
      { date: "2026-04-06", name: "Easter Monday" },
      { date: "2026-04-25", name: "Anzac Day" }, // Saturday — stays a holiday
      { date: "2026-04-27", name: "Additional public holiday for Anzac Day" }, // trial, gazetted
      { date: "2026-06-08", name: "King's Birthday" },
      { date: "2026-10-05", name: "Labour Day" },
      { date: "2026-12-25", name: "Christmas Day" },
      { date: "2026-12-26", name: "Boxing Day" }, // Saturday — stays a holiday
      { date: "2026-12-28", name: "Boxing Day (additional day)" },
    ],
    2027: [
      { date: "2027-01-01", name: "New Year's Day" },
      { date: "2027-01-26", name: "Australia Day" },
      { date: "2027-03-26", name: "Good Friday" },
      { date: "2027-03-27", name: "Easter Saturday" },
      { date: "2027-03-28", name: "Easter Sunday" },
      { date: "2027-03-29", name: "Easter Monday" },
      { date: "2027-04-25", name: "Anzac Day" }, // Sunday — stays a holiday
      { date: "2027-04-26", name: "Additional public holiday for Anzac Day" }, // trial, gazetted
      { date: "2027-06-14", name: "King's Birthday" },
      { date: "2027-10-04", name: "Labour Day" },
      { date: "2027-12-25", name: "Christmas Day" },
      { date: "2027-12-26", name: "Boxing Day" },
      { date: "2027-12-27", name: "Christmas Day (additional day)" },
      { date: "2027-12-28", name: "Boxing Day (additional day)" },
    ],
  },

  /* VIC — business.vic.gov.au per-year lists + the official vic.gov.au iCal.
     Excluded: nothing part-day or regional exists statewide. The Friday before
     the AFL Grand Final is in for 2026 (published) and out for 2027 ("Subject
     to AFL schedule"); the iCal's 2027 entry is a Saturday and is wrong. */
  VIC: {
    2026: [
      { date: "2026-01-01", name: "New Year's Day" },
      { date: "2026-01-26", name: "Australia Day" },
      { date: "2026-03-09", name: "Labour Day" },
      { date: "2026-04-03", name: "Good Friday" },
      { date: "2026-04-04", name: "Saturday before Easter Sunday" },
      { date: "2026-04-05", name: "Easter Sunday" },
      { date: "2026-04-06", name: "Easter Monday" },
      { date: "2026-04-25", name: "ANZAC Day" }, // Saturday — no substitute, no additional day
      { date: "2026-06-08", name: "King's Birthday" },
      { date: "2026-09-25", name: "Friday before the AFL Grand Final" }, // fixture-set, published
      { date: "2026-11-03", name: "Melbourne Cup" },
      { date: "2026-12-25", name: "Christmas Day" },
      { date: "2026-12-26", name: "Boxing Day" },
      { date: "2026-12-28", name: "Boxing Day (additional public holiday)" },
    ],
    2027: [
      { date: "2027-01-01", name: "New Year's Day" },
      { date: "2027-01-26", name: "Australia Day" },
      { date: "2027-03-08", name: "Labour Day" },
      { date: "2027-03-26", name: "Good Friday" },
      { date: "2027-03-27", name: "Saturday before Easter Sunday" },
      { date: "2027-03-28", name: "Easter Sunday" },
      { date: "2027-03-29", name: "Easter Monday" },
      { date: "2027-04-25", name: "ANZAC Day" }, // Sunday — no Monday in VIC
      { date: "2027-06-14", name: "King's Birthday" },
      { date: "2027-11-02", name: "Melbourne Cup" },
      { date: "2027-12-25", name: "Christmas Day" },
      { date: "2027-12-26", name: "Boxing Day" },
      { date: "2027-12-27", name: "Christmas Day (additional public holiday)" },
      { date: "2027-12-28", name: "Boxing Day (additional public holiday)" },
    ],
  },

  /* QLD — qld.gov.au/recreation/travel/holidays/public + Holidays Act 1983.
     Excluded: Christmas Eve 6pm–midnight part-day (24 Dec, both years); Royal
     Queensland Show (12 Aug 2026, 11 Aug 2027 — Brisbane only); other district
     show days; "special holidays", which are bank holidays and not public ones. */
  QLD: {
    2026: [
      { date: "2026-01-01", name: "New Year's Day" },
      { date: "2026-01-26", name: "Australia Day" },
      { date: "2026-04-03", name: "Good Friday" },
      { date: "2026-04-04", name: "The day after Good Friday (Easter Saturday)" },
      { date: "2026-04-05", name: "Easter Sunday" },
      { date: "2026-04-06", name: "Easter Monday" },
      { date: "2026-04-25", name: "Anzac Day" }, // Saturday — no Monday; QLD transfers only from Sunday
      { date: "2026-05-04", name: "Labour Day" },
      { date: "2026-10-05", name: "King's Birthday" }, // first Monday in OCTOBER
      { date: "2026-12-25", name: "Christmas Day" },
      { date: "2026-12-26", name: "Boxing Day" },
      { date: "2026-12-28", name: "Additional Boxing Day public holiday (28 December)" },
    ],
    2027: [
      { date: "2027-01-01", name: "New Year's Day" },
      { date: "2027-01-26", name: "Australia Day" },
      { date: "2027-03-26", name: "Good Friday" },
      { date: "2027-03-27", name: "The day after Good Friday (Easter Saturday)" },
      { date: "2027-03-28", name: "Easter Sunday" },
      { date: "2027-03-29", name: "Easter Monday" },
      { date: "2027-04-26", name: "Anzac Day" }, // TRANSFERRED off Sunday 25 April
      { date: "2027-05-03", name: "Labour Day" },
      { date: "2027-10-04", name: "King's Birthday" },
      { date: "2027-12-25", name: "Christmas Day" },
      { date: "2027-12-26", name: "Boxing Day" },
      { date: "2027-12-27", name: "Additional Christmas Day public holiday (27 December)" },
      { date: "2027-12-28", name: "Additional Boxing Day public holiday (28 December)" },
    ],
  },

  /* SA — safework.sa.gov.au + Public Holidays Act 2023.
     Excluded: Christmas Eve and New Year's Eve 7pm–midnight part-days (24 and
     31 Dec, both years). SA has no regional-only holidays at all. */
  SA: {
    2026: [
      { date: "2026-01-01", name: "New Year's Day" },
      { date: "2026-01-26", name: "Australia Day" },
      { date: "2026-03-09", name: "Adelaide Cup Day" },
      { date: "2026-04-03", name: "Good Friday" },
      { date: "2026-04-04", name: "Easter Saturday" },
      { date: "2026-04-05", name: "Easter Sunday" },
      { date: "2026-04-06", name: "Easter Monday" },
      { date: "2026-04-25", name: "ANZAC Day" }, // Saturday — no substitute, no additional day
      { date: "2026-06-08", name: "King's Birthday" },
      { date: "2026-10-05", name: "Labour Day" },
      { date: "2026-12-25", name: "Christmas Day" },
      { date: "2026-12-26", name: "Proclamation Day holiday" },
      { date: "2026-12-28", name: "Additional public holiday for Proclamation Day holiday" },
    ],
    2027: [
      { date: "2027-01-01", name: "New Year's Day" },
      { date: "2027-01-26", name: "Australia Day" },
      { date: "2027-03-08", name: "Adelaide Cup Day" },
      { date: "2027-03-26", name: "Good Friday" },
      { date: "2027-03-27", name: "Easter Saturday" },
      { date: "2027-03-28", name: "Easter Sunday" },
      { date: "2027-03-29", name: "Easter Monday" },
      { date: "2027-04-25", name: "ANZAC Day" }, // Sunday — no Monday in SA
      { date: "2027-06-14", name: "King's Birthday" },
      { date: "2027-10-04", name: "Labour Day" },
      { date: "2027-12-25", name: "Christmas Day" },
      { date: "2027-12-26", name: "Proclamation Day holiday" },
      { date: "2027-12-27", name: "Additional public holiday for Christmas Day" },
      { date: "2027-12-28", name: "Additional public holiday for Proclamation Day holiday" },
    ],
  },

  /* WA — wa.gov.au public-holidays service page + the Wageline 2026–2027 PDF.
     The King's Birthday is proclaimed annually; both years' dates are published,
     so both are in. Excluded: the regional King's Birthday alternative (Mon 3
     Aug 2026, City of Karratha and Town of Port Hedland). WA has no part-days,
     and no Easter Saturday under current law. */
  WA: {
    2026: [
      { date: "2026-01-01", name: "New Year's Day" },
      { date: "2026-01-26", name: "Australia Day" },
      { date: "2026-03-02", name: "Labour Day" }, // Monday on or after 1 March
      { date: "2026-04-03", name: "Good Friday" },
      { date: "2026-04-05", name: "Easter Sunday" },
      { date: "2026-04-06", name: "Easter Monday" },
      { date: "2026-04-25", name: "Anzac Day" }, // Saturday — stays a holiday
      { date: "2026-04-27", name: "Additional public holiday for Anzac Day" }, // statutory, not a one-off
      { date: "2026-06-01", name: "Western Australia Day" },
      { date: "2026-09-28", name: "King's Birthday" }, // proclaimed
      { date: "2026-12-25", name: "Christmas Day" },
      { date: "2026-12-26", name: "Boxing Day" },
      { date: "2026-12-28", name: "Additional public holiday for Boxing Day" },
    ],
    2027: [
      { date: "2027-01-01", name: "New Year's Day" },
      { date: "2027-01-26", name: "Australia Day" },
      { date: "2027-03-01", name: "Labour Day" },
      { date: "2027-03-26", name: "Good Friday" },
      { date: "2027-03-28", name: "Easter Sunday" },
      { date: "2027-03-29", name: "Easter Monday" },
      { date: "2027-04-25", name: "Anzac Day" }, // Sunday — stays a holiday
      { date: "2027-04-26", name: "Additional public holiday for Anzac Day" },
      { date: "2027-06-07", name: "Western Australia Day" },
      { date: "2027-09-27", name: "King's Birthday" }, // proclaimed
      { date: "2027-12-25", name: "Christmas Day" },
      { date: "2027-12-26", name: "Boxing Day" },
      { date: "2027-12-27", name: "Additional public holiday for Christmas Day" },
      { date: "2027-12-28", name: "Additional public holiday for Boxing Day" },
    ],
  },

  /* TAS — Statutory Holidays Act 2000 + WorkSafe Tasmania, cross-checked against
     Service Tasmania and Fair Work.
     Excluded: Easter Tuesday (State Service class only, despite appearing in the
     official statewide table); every Schedule 1 regional day (Royal Hobart
     Regatta, King Island Show, Agfest, Burnie Show, Royal Launceston Show,
     Flinders Island Show, Royal Hobart Show, Recreation Day, Devonport Show);
     Schedule 2 government holidays (Devonport Cup, Launceston Cup).
     TAS observes neither Easter Saturday nor Easter Sunday. */
  TAS: {
    2026: [
      { date: "2026-01-01", name: "New Year's Day" },
      { date: "2026-01-26", name: "Australia Day" },
      { date: "2026-03-09", name: "Eight Hours Day" },
      { date: "2026-04-03", name: "Good Friday" },
      { date: "2026-04-06", name: "Easter Monday" },
      { date: "2026-04-25", name: "Anzac Day" }, // Saturday — nothing added, nothing moved
      { date: "2026-06-08", name: "King's Birthday" },
      { date: "2026-12-25", name: "Christmas Day" },
      { date: "2026-12-28", name: "Boxing Day" }, // TRANSFERRED off Saturday 26 Dec
    ],
    2027: [
      { date: "2027-01-01", name: "New Year's Day" },
      { date: "2027-01-26", name: "Australia Day" },
      { date: "2027-03-08", name: "Eight Hours Day" },
      { date: "2027-03-26", name: "Good Friday" },
      { date: "2027-03-29", name: "Easter Monday" },
      { date: "2027-04-25", name: "Anzac Day" }, // Sunday — stays put
      { date: "2027-06-14", name: "King's Birthday" },
      { date: "2027-12-25", name: "Christmas Day" }, // Saturday — stays a holiday, Monday added
      { date: "2027-12-27", name: "Additional public holiday for Christmas Day" },
      { date: "2027-12-28", name: "Boxing Day" }, // TRANSFERRED off Sunday 26 Dec
    ],
  },

  /* NT — nt.gov.au/nt-public-holidays + Public Holidays Act 1981 Schedule 2.
     Excluded: Christmas Eve and New Year's Eve 7pm–midnight part-days; the five
     regional show days (Alice Springs, Tennant Creek, Katherine, Darwin,
     Borroloola), which are gazetted annually per region. */
  NT: {
    2026: [
      { date: "2026-01-01", name: "New Year's Day" },
      { date: "2026-01-26", name: "Australia Day" },
      { date: "2026-04-03", name: "Good Friday" },
      { date: "2026-04-04", name: "Easter Saturday" },
      { date: "2026-04-05", name: "Easter Sunday" },
      { date: "2026-04-06", name: "Easter Monday" },
      { date: "2026-04-25", name: "Anzac Day" }, // Saturday — NT substitutes only from Sunday
      { date: "2026-05-04", name: "May Day" },
      { date: "2026-06-08", name: "King's Birthday" },
      { date: "2026-08-03", name: "Picnic Day" },
      { date: "2026-12-25", name: "Christmas Day" },
      { date: "2026-12-26", name: "Boxing Day" },
      { date: "2026-12-28", name: "Boxing Day Monday" }, // nt.gov.au's name for the added day
    ],
    2027: [
      { date: "2027-01-01", name: "New Year's Day" },
      { date: "2027-01-26", name: "Australia Day" },
      { date: "2027-03-26", name: "Good Friday" },
      { date: "2027-03-27", name: "Easter Saturday" },
      { date: "2027-03-28", name: "Easter Sunday" },
      { date: "2027-03-29", name: "Easter Monday" },
      { date: "2027-04-26", name: "Anzac Day" }, // TRANSFERRED off Sunday 25 April
      { date: "2027-05-03", name: "May Day" },
      { date: "2027-06-14", name: "King's Birthday" },
      { date: "2027-08-02", name: "Picnic Day" },
      { date: "2027-12-25", name: "Christmas Day" },
      { date: "2027-12-26", name: "Boxing Day" },
      { date: "2027-12-27", name: "Additional public holiday for Christmas Day" },
      { date: "2027-12-28", name: "Additional public holiday for Boxing Day" },
    ],
  },

  /* ACT — act.gov.au official per-year PDFs + Holidays Act 1958 + NI2026-154.
     Excluded: the first Monday in August bank holiday. The ACT has no part-day
     and no regional-only holidays. */
  ACT: {
    2026: [
      { date: "2026-01-01", name: "New Year's Day" },
      { date: "2026-01-26", name: "Australia Day" },
      { date: "2026-03-09", name: "Canberra Day" },
      { date: "2026-04-03", name: "Good Friday" },
      { date: "2026-04-04", name: "Easter Saturday (the day after Good Friday)" },
      { date: "2026-04-05", name: "Easter Sunday" },
      { date: "2026-04-06", name: "Easter Monday" },
      { date: "2026-04-25", name: "Anzac Day" }, // Saturday — restored by NI2026-154
      { date: "2026-04-27", name: "Anzac Day — additional public holiday" }, // NI2026-154
      { date: "2026-06-01", name: "Reconciliation Day" },
      { date: "2026-06-08", name: "King's Birthday" },
      { date: "2026-10-05", name: "Labour Day" },
      { date: "2026-12-25", name: "Christmas Day" },
      { date: "2026-12-26", name: "Boxing Day" },
      { date: "2026-12-28", name: "Boxing Day — additional public holiday" },
    ],
    2027: [
      { date: "2027-01-01", name: "New Year's Day" },
      { date: "2027-01-26", name: "Australia Day" },
      { date: "2027-03-08", name: "Canberra Day" },
      { date: "2027-03-26", name: "Good Friday" },
      { date: "2027-03-27", name: "Easter Saturday (the day after Good Friday)" },
      { date: "2027-03-28", name: "Easter Sunday" },
      { date: "2027-03-29", name: "Easter Monday" },
      { date: "2027-04-26", name: "Anzac Day" }, // TRANSFERRED off Sunday 25 April
      { date: "2027-05-31", name: "Reconciliation Day" },
      { date: "2027-06-14", name: "King's Birthday" },
      { date: "2027-10-04", name: "Labour Day" },
      { date: "2027-12-25", name: "Christmas Day" },
      { date: "2027-12-26", name: "Boxing Day" },
      { date: "2027-12-27", name: "Christmas Day — additional public holiday" },
      { date: "2027-12-28", name: "Boxing Day — additional public holiday" },
    ],
  },
};
