import { render, screen, within } from "@testing-library/react";
import { TeamLeave } from "../team-leave";
import type { CalendarDay, LeaveRequest } from "@/lib/timepay/leave";

const approveLeave = jest.fn(async () => ({ ok: true as const }));
const declineLeave = jest.fn(async () => ({ ok: true as const }));
const refresh = jest.fn();

jest.mock("@/app/actions/leave", () => ({
  approveLeave: (...a: unknown[]) => approveLeave(...(a as [])),
  declineLeave: (...a: unknown[]) => declineLeave(...(a as [])),
}));
jest.mock("next/navigation", () => ({ useRouter: () => ({ refresh }) }));

/* The team Leave tab answers the ROSTER'S question — who can't I put on — and
   two different things answer it:

     LEAVE          an entitlement somebody spent and a manager approved
     UNAVAILABLE    a casual saying they can't be rostered; nobody approved it
                    and nothing was spent

   They share the list because the question is the same. The assertion this
   file exists for is that they DON'T share an identity: a casual's block must
   never render as leave, because that would tell whoever rosters there's an
   arrangement in place when there isn't — and there'd be nothing to approve
   if they went looking. */

const day = (date: string, entries: CalendarDay["entries"]): CalendarDay => ({ date, entries });

const leaveEntry = (staffName: string, kind: "annual" | "personal" | "unpaid" = "annual") => ({
  staffId: `s-${staffName}`,
  staffName,
  source: "leave" as const,
  kind,
});

const unavailEntry = (staffName: string, note?: string) => ({
  staffId: `c-${staffName}`,
  staffName,
  source: "unavailable" as const,
  note,
});

function renderTeam(over: Partial<React.ComponentProps<typeof TeamLeave>> = {}) {
  return render(
    <TeamLeave pending={[] as LeaveRequest[]} calendar={[]} canApprove {...over} />,
  );
}

beforeEach(() => {
  [approveLeave, declineLeave, refresh].forEach((m) => m.mockClear());
});

describe("who can't work", () => {
  it("says so plainly when nobody is away and nobody is blocked out", () => {
    renderTeam();
    expect(screen.getByText("Who can’t work")).toBeInTheDocument();
    expect(screen.getByText(/Nobody’s away and nobody has blocked out days/)).toBeInTheDocument();
  });

  it("lists leave and unavailability on the same day, in one place", () => {
    const { container } = renderTeam({
      calendar: [day("2026-08-05", [leaveEntry("Ana"), unavailEntry("Dee")])],
    });
    const names = container.querySelector(".lv-calnames") as HTMLElement;
    expect(within(names).getByText("Ana")).toBeInTheDocument();
    expect(within(names).getByText("Dee")).toBeInTheDocument();
  });

  it("does NOT dress a casual's block up as leave", () => {
    const { container } = renderTeam({
      calendar: [day("2026-08-05", [leaveEntry("Ana"), unavailEntry("Dee")])],
    });
    const chips = [...container.querySelectorAll(".dchip2")];
    const ana = chips.find((c) => c.textContent?.includes("Ana"))!;
    const dee = chips.find((c) => c.textContent?.includes("Dee"))!;

    expect(dee.className).toContain("unavail");
    expect(dee.textContent).toContain("can’t work");
    // and it wears none of the leave tones
    ["ok", "warn", "mute"].forEach((tone) => expect(dee.className).not.toContain(tone));

    // approved annual leave keeps its own tone and says nothing about availability
    expect(ana.className).toContain("ok");
    expect(ana.className).not.toContain("unavail");
    expect(ana.textContent).not.toContain("can’t work");
  });

  it("explains the grey chips rather than leaving them to be guessed at", () => {
    renderTeam({ calendar: [day("2026-08-05", [unavailEntry("Dee")])] });
    const legend = screen.getByText(/Names in grey/);
    expect(legend.textContent).toContain("not leave");
    expect(legend.textContent).toContain("nothing to");
  });

  it("carries the reason as a title when one was given, and copes without one", () => {
    const { container } = renderTeam({
      calendar: [day("2026-08-05", [unavailEntry("Dee", "second job"), unavailEntry("Eli")])],
    });
    const chips = [...container.querySelectorAll(".dchip2.unavail")];
    expect(chips[0].getAttribute("title")).toContain("second job");
    expect(chips[1].getAttribute("title")).toContain("nothing to approve");
  });

  it("shows a day that has only unavailability on it", () => {
    renderTeam({ calendar: [day("2026-08-05", [unavailEntry("Dee")])] });
    expect(screen.getByText("Dee")).toBeInTheDocument();
    expect(screen.queryByText(/Nobody’s away/)).toBeNull();
  });

  it("says nothing about money — leave and availability are hours and days", () => {
    const { container } = renderTeam({
      calendar: [day("2026-08-05", [leaveEntry("Ana"), unavailEntry("Dee")])],
    });
    expect(container.textContent).not.toMatch(/\$/);
  });
});
