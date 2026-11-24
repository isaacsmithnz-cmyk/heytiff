import type { Shelving } from "./shelves";

/* What a document's cover says, under the names the web Library's screens
   use: the Library calls its groups categories on screen, never shelves
   (components/tiff/__tests__/vocabulary.test.ts). The reading itself is
   lib/tiff/shelves', the phone's and the web's alike; this only renames it
   as it crosses to the screen. */
export type CoverReading = {
  /** the group the document sits in, shared by every document in it */
  group: string;
  /** "Mitsubishi Electric · Ducted and zoning" */
  groupName: string;
  /** the kind of system it is for, on its brand's page: "Ducted and zoning" */
  systems: string;
  /** false when `systems` names the kind of document instead (no system tagged) */
  bySystem: boolean;
  maker: string | null;
  color: string | null;
  /** the cover's big words */
  name: string;
};

export const coverReading = (s: Shelving): CoverReading => ({
  group: s.shelf,
  groupName: s.shelfName,
  systems: s.systems,
  bySystem: s.bySystem,
  maker: s.maker,
  color: s.color,
  name: s.name,
});
