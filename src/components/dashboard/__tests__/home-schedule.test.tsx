/* HOME'S SCHEDULE: A NEW DAY REPLACES THE OLD ONE, AND AN EMPTY DAY IS SHORT.

   Left over from #1599. Pressing another day used to empty the card while
   that day was read, so the map vanished for a second; now the old day
   stays until the new one arrives. And with no map beside it (You on a day
   with nothing of yours) the list was still the map's height, a tall blank
   card; shell.css lets it be as tall as what it holds. */

import fs from "node:fs";
import path from "node:path";
import { act, fireEvent, render, screen } from "@testing-library/react";
import { HomeSchedule } from "../home-schedule";
import type { TeamDay, TeamJob } from "@/lib/dashboard/team-day";

const job = (id: string, client: string, mine = true): TeamJob => ({
  id,
  number: id,
  client,
  suburb: "Mockglen",
  kind: "Install",
  hue: "blue" as TeamJob["hue"],
  people: ["you"],
  mine,
  startMin: 450,
  time: "7:30",
  state: null,
  done: false,
  at: { lat: -33.88, lng: 151.18 },
  here: [],
  href: `/dashboard/jobs/${id}`,
});

const day = (d: string, jobs: TeamJob[], today = false): TeamDay => ({ day: d, today, jobs, free: [], linked: true, live: [] });

const DAYS = [
  { day: "2026-11-20", label: "Today" },
  { day: "2026-11-23", label: "Mon 23" },
];

const realFetch = global.fetch;
afterEach(() => {
  global.fetch = realFetch;
  localStorage.clear();
});

describe("Home's Schedule", () => {
  it("keeps the old day, map and all, until the new day arrives", async () => {
    let arrive: (t: TeamDay) => void = () => {};
    global.fetch = jest.fn(
      () =>
        new Promise<Response>((res) => {
          arrive = (t) => res({ ok: true, json: () => Promise.resolve(t) } as Response);
        }),
    );
    const { container } = render(<HomeSchedule first={day("2026-11-20", [job("3001", "Ng")], true)} days={DAYS} />);
    expect(container.querySelector(".hm-map")).not.toBeNull();

    fireEvent.click(screen.getByRole("tab", { name: "Mon 23" }));
    /* still today's, while Monday is read */
    expect(screen.getByText("Ng")).toBeInTheDocument();
    expect(container.querySelector(".hm-map")).not.toBeNull();
    expect(screen.queryByText(/^Reading/)).toBeNull();
    expect(container.querySelector(".hm-sd")).toHaveAttribute("aria-busy", "true");

    await act(async () => arrive(day("2026-11-23", [job("3002", "Park")])));
    expect(await screen.findByText("Park")).toBeInTheDocument();
    expect(screen.queryByText("Ng")).toBeNull();
    expect(container.querySelector(".hm-sd")).toHaveAttribute("aria-busy", "false");
  });

  it("on You, a day with nothing of yours has no map and a list that isn't the map's height", () => {
    localStorage.setItem("heytiff.home.people.v1", "you");
    const { container } = render(<HomeSchedule first={day("2026-11-20", [job("3001", "Ng", false)], true)} days={DAYS} />);
    expect(screen.getByText("Nothing booked for you today")).toBeInTheDocument();
    expect(container.querySelector(".hm-map")).toBeNull();
    expect(container.querySelector(".hm-sd")).toHaveClass("hm-sd--nomap");

    const css = fs.readFileSync(path.join(process.cwd(), "src/app/dashboard/shell.css"), "utf8").replace(/\/\*[\s\S]*?\*\//g, "");
    expect(css).toMatch(/\.fg \.hm-sd--nomap \.hm-sd-list \{[^}]*height:auto;[^}]*max-height:368px;/);
  });
});
