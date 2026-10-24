import {
  JOB_SECTIONS,
  SECTION_FACES,
  SECTION_LABEL,
  jobTabLabel,
  parseSection,
  sectionOfFace,
  sectionsFor,
  stageWord,
} from "../job-sections";
import { jobHref, jobPageHref } from "@/lib/shell/links";
import type { JobStep } from "@/lib/workboard/job-steps";

/* A job's seven sections (docs/design.md rule 31), each the job card's own
   faces (v2, step 5). */

describe("the sections", () => {
  it("are the rule's seven, in its order", () => {
    expect(JOB_SECTIONS.map((s) => SECTION_LABEL[s])).toEqual(["Overview", "Quote", "Visits", "Materials", "Photos", "Documents", "Billing"]);
  });

  it("each show the card's faces: Overview the summary and diary, Documents the files and compliance, Billing the money", () => {
    expect(SECTION_FACES).toEqual({
      overview: ["summary", "diary"],
      quote: ["quote"],
      visits: ["visits"],
      materials: ["checklist"],
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
});

describe("?tab=", () => {
  it("names a section, whatever its case", () => {
    expect(parseSection("visits", false)).toBe("visits");
    expect(parseSection(" Photos ", false)).toBe("photos");
  });

  /* Isaac, 25 October 2026: the Checklist became Materials, and a link
     made before still opens it */
  it("lands an old ?tab=checklist on Materials", () => {
    expect(parseSection("materials", false)).toBe("materials");
    expect(parseSection("checklist", false)).toBe("materials");
    expect(parseSection(" Checklist ", true)).toBe("materials");
    expect(sectionOfFace("checklist")).toBe("materials");
  });

  it("lands anything else on Overview", () => {
    expect(parseSection(undefined, true)).toBe("overview");
    expect(parseSection("timeline", true)).toBe("overview");
    expect(parseSection(["quote", "visits"], true)).toBe("overview");
    expect(parseSection("billing", false)).toBe("overview");
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

describe("where the job stands, one word", () => {
  const step = (label: string, state: JobStep["state"], fact = ""): JobStep => ({ key: "enquiry", label, state, fact });

  it("is the last step done, in grey", () => {
    expect(stageWord([step("Enquiry", "done"), step("Quoted", "done"), step("Accepted", "done"), step("Installation", "now")])).toEqual({ word: "Accepted", tone: "info" });
  });

  it("says what needs a look in orange, and a declined quote in red", () => {
    expect(stageWord([step("Enquiry", "done"), step("Paid", "warn", "Invoiced, not paid")])).toEqual({ word: "Invoiced, not paid", tone: "look" });
    expect(stageWord([step("Enquiry", "done"), step("Quoted", "done"), step("Declined", "bad")])).toEqual({ word: "Declined", tone: "wrong" });
  });

  it("is nothing before anything is done", () => {
    expect(stageWord([step("Enquiry", "now")])).toBeNull();
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
