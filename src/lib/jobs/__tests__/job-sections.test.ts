import {
  JOB_SECTIONS,
  SECTION_FACES,
  SECTION_LABEL,
  jobTabLabel,
  parseSection,
  sectionOfFace,
  sectionsFor,
} from "../job-sections";
import { jobHref, jobPageHref } from "@/lib/shell/links";

/* A job's nine sections (docs/design.md rule 31), each the job card's own
   faces (v2, step 5). */

describe("the sections", () => {
  it("are the rule's, in its order: Scope after Overview, On site where Visits and Materials were", () => {
    expect(JOB_SECTIONS.map((s) => SECTION_LABEL[s])).toEqual(["Overview", "Scope", "Quote", "Design", "On site", "Photos", "Documents", "Billing"]);
  });

  it("each show the card's faces: Overview the summary and diary, Documents the files and compliance, Billing the money", () => {
    expect(SECTION_FACES).toEqual({
      overview: ["summary", "diary"],
      scope: ["scope"],
      quote: ["quote"],
      design: ["design"],
      "on-site": ["visits", "checklist"],
      photos: ["photos"],
      documents: ["documents", "compliance"],
      billing: ["money"],
    });
  });

  it("put every one of the card's faces in exactly one section", () => {
    const faces = Object.values(SECTION_FACES).flat();
    expect(new Set(faces).size).toBe(faces.length);
    expect(sectionOfFace("diary")).toBe("overview");
    expect(sectionOfFace("compliance")).toBe("documents");
    expect(sectionOfFace("money")).toBe("billing");
  });

  it("leave Billing out without the money grant, as the card's face is", () => {
    expect(sectionsFor(false)).not.toContain("billing");
    expect(sectionsFor(true)).toContain("billing");
  });

  /* Isaac, 28 October 2026: "a separate tab outside of the quoting" */
  it("put Design after Quote for whoever has the Studio, and leave it out for anyone else", () => {
    expect(sectionsFor(true, true).slice(0, 4)).toEqual(["overview", "scope", "quote", "design"]);
    expect(sectionsFor(true, false)).not.toContain("design");
    expect(sectionsFor(false)).not.toContain("design");
    expect(sectionOfFace("design")).toBe("design");
  });
});

describe("?tab=", () => {
  it("names a section, whatever its case", () => {
    expect(parseSection("on-site", false)).toBe("on-site");
    expect(parseSection(" Photos ", false)).toBe("photos");
    expect(parseSection("scope", false)).toBe("scope");
    expect(sectionOfFace("scope")).toBe("scope");
  });

  /* the Checklist became Materials (25 October 2026), and Visits and
     Materials became On site (mock F, 14 November 2026): a link made before
     still opens it */
  it("lands an old ?tab=checklist, visits or materials on On site", () => {
    expect(parseSection("materials", false)).toBe("on-site");
    expect(parseSection("visits", false)).toBe("on-site");
    expect(parseSection("checklist", false)).toBe("on-site");
    expect(parseSection(" Checklist ", true)).toBe("on-site");
    expect(sectionOfFace("checklist")).toBe("on-site");
    expect(sectionOfFace("visits")).toBe("on-site");
  });

  it("lands anything else on Overview", () => {
    expect(parseSection(undefined, true)).toBe("overview");
    expect(parseSection("timeline", true)).toBe("overview");
    expect(parseSection(["quote", "visits"], true)).toBe("overview");
    expect(parseSection("billing", false)).toBe("overview");
    expect(parseSection("design", true)).toBe("overview");
    expect(parseSection("design", true, true)).toBe("design");
    expect(parseSection("billing", true)).toBe("billing");
  });
});

describe("the page's address", () => {
  it("is the job's uuid, encoded, with the section after it unless it's Overview", () => {
    expect(jobPageHref("a3539c01")).toBe("/dashboard/jobs/a3539c01");
    expect(jobPageHref("a3539c01", "overview")).toBe("/dashboard/jobs/a3539c01");
    expect(jobPageHref("j/odd id", "photos")).toBe("/dashboard/jobs/j%2Fodd%20id?tab=photos");
  });

  it("is where the card's old link now opens (the Workboard is retired)", () => {
    expect(jobHref("a3539c01")).toBe("/dashboard/jobs/a3539c01");
  });
});

describe("what an open tab calls a job", () => {
  it("is its number and the first word of its client, '3209 Richards'", () => {
    expect(jobTabLabel("3209", "Richards Building")).toBe("3209 Richards");
    expect(jobTabLabel("2674", "St Lukes")).toBe("2674 St Lukes");
    expect(jobTabLabel("3410", "The Smiths Group")).toBe("3410 The Smiths");
    expect(jobTabLabel("3421", "Charlie")).toBe("3421 Charlie");
    expect(jobTabLabel("3209", null)).toBe("Job 3209");
    expect(jobTabLabel(null, "Heuvel Construction")).toBe("Heuvel Construction");
    expect(jobTabLabel(null, null)).toBe("Job");
  });
});
