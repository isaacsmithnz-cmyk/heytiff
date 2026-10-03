import type { ClauseKey } from "./mechanical";

/* WHAT WAS ASKED, MATCHED TO A STATEMENT — by rule, never by the model, so
   the match can be tested and the person can change it. Kept apart from the
   description reader (./quote): what was asked is read the same way
   whatever reads the equipment. */

export type Match = { clause: ClauseKey | null; notOurs: boolean };

/* Checked in this order, because one requirement often names several things:
   FutureCert's fire-mode line also mentions AS/NZS 1668.1 and "smoke control
   system", and is about fire mode. */
const MATCHERS: readonly [RegExp, ClauseKey | "smoke"][] = [
  [/fire mode|specification 21|spec\.? ?21\b|shuts? down/i, "fireMode"],
  [/stair pressuri|zone pressuri|smoke (exhaust|control system|management system|spill)/i, "smoke"],
  [/\bJ[56]\b|part j\b|section j\b|energy efficiency/i, "j5"],
  [/kitchen (exhaust|hood)|commercial kitchen/i, "kitchenExhaust"],
  [/car ?park|carbon monoxide|\bCO\b (monitor|detect)/i, "carPark"],
  [/air balanc|balance report|commissioning report|test(ing)? and balanc/i, "airBalance"],
  [/noise|acoustic|db\(?a\)?/i, "noise"],
  [/1668\.2.*\b(only|exhaust)|exhaust.*1668\.2/i, "as16682"],
  [/1668/i, "as1668"],
  [/5149|refrigerat/i, "refrigerant"],
  [/4254|ductwork/i, "ductwork"],
  [/penetration|fire[\s-]*rated|fire[\s-]*stop/i, "fireRated"],
  /* discharge first: "exhaust fans discharge to outdoor air" is about where
     the air goes, not how much */
  [/discharge/i, "ventDischarge"],
  [/airflow|air flow|l\/s|exhaust fan/i, "ventAirflow"],
  [/approved (plans|documents|drawings|design)|construction certificate|complying development|conditions? of (consent|approval)|development consent/i, "approved"],
  [/manufacturer/i, "manufacturer"],
  [/condensate/i, "condensate"],
  [/commission/i, "commissioned"],
];

export function matchRequirement(text: string): Match {
  for (const [re, key] of MATCHERS) {
    if (!re.test(text)) continue;
    return key === "smoke" ? { clause: null, notOurs: true } : { clause: key, notOurs: false };
  }
  return { clause: null, notOurs: false };
}
