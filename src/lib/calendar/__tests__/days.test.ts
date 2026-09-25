import {
  columnOf,
  datesLabel,
  dayLabel,
  dayRangeLabel,
  fromDay,
  isWeekend,
  minutesOf,
  monthLongLabel,
  monthYearLabel,
  timeLabel,
  timeRangeLabel,
  toDay,
} from "../days";
import { fmtAuWeekdayDayMonth } from "@/lib/au-dates";

const d = (iso: string) => toDay(iso);

describe("toDay / fromDay", () => {
  it("round-trips an ISO day through a whole day number", () => {
    expect(fromDay(d("2026-09-24"))).toBe("2026-09-24");
    expect(d("2026-09-25") - d("2026-09-24")).toBe(1);
    expect(d("2027-01-01") - d("2026-12-31")).toBe(1);
    expect(d("2028-03-01") - d("2028-02-28")).toBe(2); // 2028 is a leap year
  });

  it("refuses a day that is not real rather than rolling it on", () => {
    expect(toDay("2026-02-31")).toBeNaN(); // Date.UTC would read 3 March
    expect(toDay("2026-13-01")).toBeNaN();
    expect(toDay("2026-00-10")).toBeNaN();
    expect(toDay("2026-9-1")).toBeNaN();
    expect(toDay("2026-09-24T10:00:00Z")).toBeNaN();
    expect(toDay("")).toBeNaN();
    expect(toDay(null)).toBeNaN();
  });

  it("knows the weekday without a zone: Mon 5 Oct 2026 is column 0, Sat and Sun are the weekend", () => {
    expect(columnOf(d("2026-10-05"))).toBe(0);
    expect(columnOf(d("2026-10-04"))).toBe(6);
    expect(isWeekend(d("2026-10-03"))).toBe(true);
    expect(isWeekend(d("2026-10-05"))).toBe(false);
  });
});

describe("day words", () => {
  it('writes a day as "Mon 5 Oct", with his month names', () => {
    expect(dayLabel(d("2026-10-05"))).toBe("Mon 5 Oct");
    expect(dayLabel(d("2026-09-17"))).toBe("Thu 17 Sept");
    expect(dayLabel(d("2027-06-14"))).toBe("Mon 14 June");
    expect(dayLabel(d("2027-07-24"))).toBe("Sat 24 July");
  });

  it("writes a span with its weekdays, the month once when it is shared", () => {
    expect(dayRangeLabel(d("2026-10-05"), d("2026-10-09"))).toBe("Mon 5 – Fri 9 Oct");
    expect(dayRangeLabel(d("2026-09-28"), d("2026-10-09"))).toBe("Mon 28 Sept – Fri 9 Oct");
    expect(dayRangeLabel(d("2026-12-23"), d("2027-01-08"))).toBe("Wed 23 Dec – Fri 8 Jan");
    expect(dayRangeLabel(d("2026-10-05"), d("2026-10-05"))).toBe("Mon 5 Oct");
  });

  it('writes a span without weekdays: "5 – 11 Oct", "28 Sept – 2 Oct"', () => {
    expect(datesLabel(d("2026-10-05"), d("2026-10-11"))).toBe("5 – 11 Oct");
    expect(datesLabel(d("2026-09-28"), d("2026-10-02"))).toBe("28 Sept – 2 Oct");
    expect(datesLabel(d("2026-12-28"), d("2027-01-03"))).toBe("28 Dec – 3 Jan");
    expect(datesLabel(d("2026-10-05"), d("2026-10-05"))).toBe("5 Oct");
  });

  it("spells every day of three years the way the rest of the app does (au-dates, en-AU)", () => {
    // The calendar spells from its own table so the browser's locale cannot
    // change a word; this pins the table to the app's words ("Sept", "June").
    const mismatches: string[] = [];
    for (let n = d("2026-01-01"); n <= d("2028-12-31"); n++) {
      const iso = fromDay(n);
      if (dayLabel(n) !== fmtAuWeekdayDayMonth(iso)) mismatches.push(`${iso}: ${dayLabel(n)} vs ${fmtAuWeekdayDayMonth(iso)}`);
    }
    expect(mismatches).toEqual([]);
  });

  it("names months short with the year, and long", () => {
    expect(monthYearLabel(d("2027-08-31"))).toBe("Aug 2027");
    expect(monthYearLabel(d("2026-09-01"))).toBe("Sept 2026");
    expect(monthLongLabel(d("2026-10-15"))).toBe("October 2026");
  });
});

describe("times of day", () => {
  it("reads a Postgres time and a person's time alike", () => {
    expect(minutesOf("06:45")).toBe(405);
    expect(minutesOf("06:45:00")).toBe(405);
    expect(minutesOf("6:45 am")).toBe(405);
    expect(minutesOf("6:45am")).toBe(405);
    expect(minutesOf("3:30 PM")).toBe(930);
    expect(minutesOf("12:00 pm")).toBe(720);
    expect(minutesOf("12:15 am")).toBe(15);
    expect(minutesOf("7 pm")).toBe(1140);
  });

  it("gives nothing for what is not a time", () => {
    expect(minutesOf(null)).toBeNull();
    expect(minutesOf("")).toBeNull();
    expect(minutesOf("24:00")).toBeNull();
    expect(minutesOf("13:00 pm")).toBeNull();
    expect(minutesOf("soon")).toBeNull();
  });

  it('writes "6:45 am", noon as "12:00 pm", midnight as "12:00 am"', () => {
    expect(timeLabel("07:30")).toBe("7:30 am");
    expect(timeLabel("12:00")).toBe("12:00 pm");
    expect(timeLabel("00:00")).toBe("12:00 am");
    expect(timeLabel("18:00:00")).toBe("6:00 pm");
    expect(timeLabel(null)).toBeNull();
  });

  it("writes a range with the half of the day once when both ends share it", () => {
    expect(timeRangeLabel("06:45", "07:15")).toBe("6:45 – 7:15 am");
    expect(timeRangeLabel("11:30", "13:00")).toBe("11:30 am – 1:00 pm");
    expect(timeRangeLabel("15:30", null)).toBe("3:30 pm");
    expect(timeRangeLabel(null, "16:30")).toBeNull();
  });
});
