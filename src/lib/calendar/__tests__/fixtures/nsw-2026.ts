/* The prototype's calendar as fixtures: his handoff's dates, "today" Thursday
   24 September 2026 in NSW.

   Real: the NSW public holidays (Labour Day Mon 5 Oct 2026 …), the Eastern
   division's school holidays (spring 28 Sept – 9 Oct), the vehicles and the
   business's cover as they stand in Assets and Admin (the spare van's rego ran
   out on 17 Sept; the trailer's runs out on 20 Oct).
   Sample: the toolbox talk, the Daikin training, the team meeting, the
   Christmas party and the Christmas shutdown. His test and tag and BAS rows
   are left out: nothing in HeyTiff holds them. */

import { calFrame, type CalItem } from "../../model";

export const TODAY = "2026-09-24";
export const FRAME = calFrame(TODAY, "NSW");

const hol = (id: string, day: string, title: string): CalItem => ({ id: `ph:${id}`, cat: "hol", start: day, end: day, title });

const school = (id: string, start: string, end: string, season: string, back: string): CalItem => ({
  id: `sch:${id}`,
  cat: "school",
  start,
  end,
  title: "School holidays",
  season,
  back,
});

const vehicle = (id: string, day: string, name: string, plate: string, what: "rego" | "insurance", overdue = false): CalItem => ({
  id: `veh:${id}:${what}`,
  cat: "admin",
  start: day,
  end: day,
  title: `${name}, ${plate} ${what}`,
  monthTitle: `${name} ${what}`,
  monthMeta: plate,
  sub: overdue ? "Overdue. From Assets." : "From Assets.",
  overdue,
  action: { label: `Renew ${what}`, href: `/dashboard/assets?v=${id}&screen=${what}` },
});

export const HOLIDAYS: CalItem[] = [
  hol("labour", "2026-10-05", "Labour Day"),
  hol("xmas", "2026-12-25", "Christmas Day"),
  hol("boxing", "2026-12-26", "Boxing Day"),
  hol("boxing2", "2026-12-28", "Boxing Day (additional day)"),
  hol("ny", "2027-01-01", "New Year’s Day"),
  hol("aus", "2027-01-26", "Australia Day"),
  hol("gf", "2027-03-26", "Good Friday"),
  hol("es", "2027-03-27", "Easter Saturday"),
  hol("esu", "2027-03-28", "Easter Sunday"),
  hol("em", "2027-03-29", "Easter Monday"),
  hol("anzac", "2027-04-25", "Anzac Day"),
  hol("anzac2", "2027-04-26", "Additional public holiday for Anzac Day"),
  hol("king", "2027-06-14", "King’s Birthday"),
];

export const SCHOOL: CalItem[] = [
  school("spring26", "2026-09-28", "2026-10-09", "spring", "2026-10-13"),
  school("summer26", "2026-12-18", "2027-01-27", "summer", "2027-02-03"),
  school("autumn27", "2027-04-12", "2027-04-23", "autumn", "2027-04-29"),
  school("winter27", "2027-07-05", "2027-07-16", "winter", "2027-07-20"),
];

export const ADMIN: CalItem[] = [
  vehicle("cy14", "2026-09-17", "Spare van", "CY14FE", "rego", true),
  vehicle("tc22", "2026-10-20", "Trailer", "TC22BJ", "rego"),
  vehicle("evd", "2026-12-11", "Zucky", "EVD72G", "rego"),
  vehicle("evd", "2027-07-24", "Zucky", "EVD72G", "insurance"),
  vehicle("ykg", "2027-01-22", "Hiace van", "YKG98E", "rego"),
  vehicle("dm44", "2027-03-29", "Hiace van", "DM44AO", "rego"),
  {
    id: "cred:pl",
    cat: "admin",
    start: "2026-11-10",
    end: "2026-11-10",
    title: "Public liability insurance",
    monthTitle: "Public liability",
    sub: "QBE Insurance (Australia) Ltd. From Admin.",
    description: "Your public liability cover with QBE Insurance (Australia) Ltd runs out on Tue 10 Nov.",
    facts: [
      ["Insurer", "QBE Insurance (Australia) Ltd"],
      ["Runs out", "Tue 10 Nov 2026"],
      ["From", "Admin"],
    ],
  },
];

export const EVENTS: CalItem[] = [
  {
    id: "ev:toolbox",
    cat: "event",
    start: "2026-10-01",
    end: "2026-10-01",
    title: "Toolbox talk",
    time: "06:45:00",
    timeEnd: "07:15:00",
    sub: "The yard. This month: working at heights.",
    description: "Monthly safety meeting. This month: working at heights.",
    facts: [
      ["Where", "The yard"],
      ["Who", "Everyone"],
    ],
    action: "edit",
  },
  { id: "ev:daikin", cat: "event", start: "2026-10-08", end: "2026-10-08", title: "Daikin VRV training", monthTitle: "Daikin training", time: "07:30", timeEnd: "11:30" },
  { id: "ev:meeting", cat: "event", start: "2026-10-14", end: "2026-10-14", title: "Team meeting", time: "15:30", timeEnd: "16:30" },
  { id: "ev:party", cat: "event", start: "2026-12-11", end: "2026-12-11", title: "Christmas party", time: "18:00" },
  {
    id: "ev:shutdown",
    cat: "event",
    start: "2026-12-23",
    end: "2027-01-08",
    title: "Christmas shutdown",
    shutdown: true,
    sub: "Office and crews off. Back Mon 11 Jan.",
  },
];

export const ITEMS: CalItem[] = [...HOLIDAYS, ...SCHOOL, ...ADMIN, ...EVENTS];
