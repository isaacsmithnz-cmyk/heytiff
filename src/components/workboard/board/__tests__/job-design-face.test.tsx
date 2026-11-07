import { render, screen, within } from "@testing-library/react";
import { JobDesignFace, designRowLine } from "../job-design-face";
import type { JobDesign } from "@/lib/workboard/all-jobs-query";

/* A job's Design section (Isaac, 28 October 2026: "a separate tab outside
   of the quoting"): its designs, each opening in the Studio, and New design
   on the job. */

jest.mock("@/components/shell/open-tabs", () => ({ openInTab: jest.fn((href: string) => href) }));

const JOB = "01a16037-b85f-7c94-9d9b-bc2fbdedbf2b";
const d = (over: Partial<JobDesign> = {}): JobDesign => ({
  id: "dsn_new",
  name: "90 O'Brien Street",
  mode: "plan",
  floorCount: 1,
  systemCount: 1,
  updatedAt: "2026-10-28T00:35:39.055Z",
  ...over,
});

describe("the job's Design section", () => {
  it("lists the job's designs as it has them, newest first, each opening in the Studio", () => {
    render(
      <JobDesignFace
        job={JOB}
        designs={[d(), d({ id: "dsn_old", floorCount: 2, systemCount: 2, updatedAt: "2026-10-22T01:09:47.880Z" })]}
        loading={false}
      />,
    );
    const rows = within(screen.getByRole("list", { name: "The job's designs" })).getAllByRole("listitem");
    expect(rows.map((r) => r.textContent)).toEqual([
      "90 O'Brien Street1 floor, 1 system, edited Wed 28 OctOpen design",
      "90 O'Brien Street2 floors, 2 systems, edited Thu 22 OctOpen design",
    ]);
    expect(within(rows[1]).getByRole("link", { name: "Open design" })).toHaveAttribute("href", "/dashboard/studio?design=dsn_old");
  });

  /* `&new`: New design on the job even when it has designs (studio/page.tsx) */
  it("starts a new design on the job, whatever it has already", () => {
    render(<JobDesignFace job={JOB} designs={[d()]} loading={false} />);
    expect(screen.getByRole("link", { name: "New design" })).toHaveAttribute("href", `/dashboard/studio?job=${JOB}&new=1`);
  });

  it("says the job has no design, and offers New design alone", () => {
    render(<JobDesignFace job={JOB} designs={[]} loading={false} />);
    expect(screen.getByText("No design on this job")).toBeInTheDocument();
    expect(screen.queryByRole("list")).toBeNull();
    expect(screen.getAllByRole("link").map((a) => a.textContent)).toEqual(["New design"]);
  });

  it("doesn't say there's no design while the job is still being read", () => {
    render(<JobDesignFace job={JOB} designs={[]} loading />);
    expect(screen.queryByText("No design on this job")).toBeNull();
  });

  it("says each design's floors, systems and day in one line, singular where it's one", () => {
    expect(designRowLine(d({ floorCount: 2, systemCount: 3, updatedAt: "2026-10-27T00:38:16.641Z" }))).toBe(
      "2 floors, 3 systems, edited Tue 27 Oct",
    );
  });
});
