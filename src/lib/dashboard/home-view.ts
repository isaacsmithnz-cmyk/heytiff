/* HOME, v2 — what the page hands the screen, worked out from the page's own
   data on the server (pure: no clock, no I/O). Today from the day's rail
   (./home-today); To do from the bell's alerts, the old list and To do's
   own reads (./todo). */

import { fmtAuWeekdayDayMonth } from "@/lib/au-dates";
import { diaryHolds } from "./diary-conversation";
import { railMissing } from "./day-rail";
import { placeHomeList } from "./home-list";
import { todayRows, todaySummary, type TodayView } from "./home-today";
import { mentionTasksOf } from "./mention-asks";
import type { DashboardData } from "./page-data";
import { todoRows, type TodoRow } from "./todo";

export type HomeView = { today: TodayView; todo: TodoRow[] };

export function todayView(rail: DashboardData["rail"]): TodayView {
  const rows = todayRows(rail);
  const missing = railMissing(rail);
  const empty: TodayView["empty"] =
    missing === "link"
      ? {
          what: "ServiceM8 doesn't know which person you are yet",
          line: rail.linkHref ? null : "The owner links you to your ServiceM8 name",
          action: rail.linkHref ? { label: "Link yourself", href: rail.linkHref } : null,
        }
      : missing === "workboard"
        ? { what: "Nothing with a time on it today", line: null, action: null }
        : {
            what: "Nothing booked for you today",
            line: rail.next ? `Next booked ${fmtAuWeekdayDayMonth(rail.next.dayISO)}` : null,
            action: null,
          };
  return { rows, summary: todaySummary(rows, rail.blocks), empty, schedule: rail.enabled };
}

/** The old list, placed as the desk placed it: the diary's entries and asks
    it holds, so a row's door never names one the diary can't show. */
export function homeList(data: DashboardData) {
  if (!data.desk) return null;
  const holds = diaryHolds(data.desk.diary.feed ?? null);
  return placeHomeList(data.desk.list, {
    ...data,
    journal: data.journal.filter((e) => holds.entries.has(e.id)),
    mentions: mentionTasksOf(data.desk.diary.feed),
  });
}

export function homeView(data: DashboardData): HomeView {
  return {
    today: todayView(data.rail),
    todo: todoRows({
      ...data.todo,
      today: data.today,
      chips: [...data.chips.self, ...data.chips.team],
      list: homeList(data),
    }),
  };
}
