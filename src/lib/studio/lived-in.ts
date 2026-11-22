/* THE ROOMS PEOPLE LIVE IN: the ones an air conditioner usually serves. Read
   off a room's name, as the plan names it: bedrooms, living, family, dining,
   kitchens, studies, lounges, games and media rooms, the gym. Never a room
   whose name also says it is wet, a cupboard, a way through or a store, so
   "Bed 8 ensuite", "ROBE (Bed 4)" and "Bed 8 hall" stay out though they
   carry a bedroom's name. A misspelling the plans carry counts ("Dinning
   Room" on 3570). Used to tick what Tiff found on a plan, and to switch on a
   new system's zones (Isaac, 22 November 2026: "Build A" to
   https://claude.ai/artifact/CdpkAH5UZsqXLnxmQfENfg). */

const LIVED = /\b(bed|beds|bedroom|bedrooms|master|guest|nursery|living|lounge|family|dining|dinning|meals|kitchen|study|office|rumpus|media|theatre|theater|game|games|retreat|sitting|gym|studio|activity|playroom|mahjong|library|music|kids|teens?|banquet)\b/i;

const NOT_LIVED =
  /\b(ensuite|en suite|bath|bathroom|shower|wc|toilet|powder|poeder|pwd|laundry|ldry|wir|wic|robe|robes|wardrobe|cupboard|linen|store|storage|pantry|pantries|hall|hallway|corridor|landing|stair|stairs|lobby|entry|foyer|lift|cellar|garage|plant|services?|void|balcony|deck|terrace|alfresco|porch|patio)\b/i;

/** Is this a room people live in, by its name. */
export const livedIn = (name: string) => LIVED.test(name) && !NOT_LIVED.test(name);
