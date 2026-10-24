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
import { columnOf, todoRows, type TodoRow } from "./todo";
import { FEED_TALK_DAYS, yourFeed, type FeedItem } from "./your-feed";
import { plusDays } from "@/lib/workboard/dates";

/** Home's three columns: Today, To do, and Your feed in place of Activity. */
export type HomeView = { today: TodayView; todo: TodoRow[]; feed: FeedItem[] };

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
  const rows = todoRows({
    ...data.todo,
    today: data.today,
    chips: [...data.chips.self, ...data.chips.team],
    list: homeList(data),
  });
  /* the account's clock when Home was read, for what waits now */
  const min = data.rail.nowMin === null ? 1439 : Math.max(0, Math.min(1439, data.rail.nowMin));
  const now = `${data.rail.dayISO} ${String(Math.floor(min / 60)).padStart(2, "0")}:${String(min % 60).padStart(2, "0")}:00`;
  return {
    today: todayView(data.rail),
    todo: rows.filter((r) => columnOf(r) !== "activity"),
    feed: yourFeed({
      rows: rows.filter((r) => columnOf(r) === "activity"),
      diary: data.desk?.diary.feed ?? null,
      events: data.events,
      today: data.rail.dayISO,
      now,
      since: plusDays(data.rail.dayISO, -FEED_TALK_DAYS),
    }),
  };
}
