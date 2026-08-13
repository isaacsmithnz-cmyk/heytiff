/* The classifier that decides what a job's files ARE. Every case here is a
   file type the live Diamond Air account actually holds — the distribution
   was counted before this was written, so the tail cases are real rather
   than imagined. */

import {
  groupJobMedia,
  isCacheableMedia,
  jobMediaKind,
  mediaCountLine,
  normaliseFileType,
  paperworkLabel,
  type JobMediaItem,
} from "@/lib/workboard/job-media";

describe("normaliseFileType", () => {
  it("takes ServiceM8's documented shape unchanged", () => {
    expect(normaliseFileType(".jpg")).toBe(".jpg");
    expect(normaliseFileType(".pdf")).toBe(".pdf");
  });

  it("tolerates a missing dot and stray case rather than trusting the field", () => {
    expect(normaliseFileType("JPG")).toBe(".jpg");
    expect(normaliseFileType(" .PDF ")).toBe(".pdf");
  });

  it("refuses anything that isn't an extension, so one odd row can't break a job", () => {
    expect(normaliseFileType("")).toBeNull();
    expect(normaliseFileType(null)).toBeNull();
    expect(normaliseFileType(undefined)).toBeNull();
    expect(normaliseFileType("image/jpeg")).toBeNull();
    expect(normaliseFileType(".")).toBeNull();
    expect(normaliseFileType("../../etc/passwd")).toBeNull();
  });
});

describe("jobMediaKind", () => {
  it("calls the photo types photos", () => {
    for (const ext of [".jpg", ".jpeg", ".png", ".webp", ".gif"]) {
      expect(jobMediaKind(ext)).toBe("photo");
    }
  });

  it("calls video video — the kind whose bytes must never be copied", () => {
    for (const ext of [".mp4", ".mov", ".m4v", ".webm"]) {
      expect(jobMediaKind(ext)).toBe("video");
    }
  });

  it("calls paperwork and office files documents", () => {
    for (const ext of [".pdf", ".txt", ".htm", ".xlsx", ".docx", ".pptx", ".csv"]) {
      expect(jobMediaKind(ext)).toBe("document");
    }
  });

  /* An image a browser won't paint is worse than no image: it renders as a
     broken tile in a grid with no way to explain itself. HEIC is an iPhone's
     default and WILL arrive; .avif is already in the live account. */
  it("treats browser-unrenderable images as documents, not photos", () => {
    for (const ext of [".heic", ".heif", ".avif"]) {
      expect(jobMediaKind(ext)).toBe("document");
    }
  });

  it("shrugs at anything unrecognised instead of throwing", () => {
    expect(jobMediaKind(".dwg")).toBe("other");
    expect(jobMediaKind(null)).toBe("other");
    expect(jobMediaKind("nonsense")).toBe("other");
  });
});

describe("isCacheableMedia", () => {
  it("takes photos and PDFs — the two kinds a job screen renders", () => {
    expect(isCacheableMedia(".jpg")).toBe(true);
    expect(isCacheableMedia(".png")).toBe(true);
    expect(isCacheableMedia(".pdf")).toBe(true);
  });

  /* 528 mp4s in one account. A job's worth of video is measured in hundreds
     of megabytes against a bucket measured in gigabytes, and nothing here
     plays video — so it is named and left where it is. */
  it("never takes video, whatever the extension", () => {
    for (const ext of [".mp4", ".mov", ".m4v", ".avi", ".webm", ".mkv"]) {
      expect(isCacheableMedia(ext)).toBe(false);
    }
  });

  it("leaves office files, unrenderable images and unknowns in ServiceM8", () => {
    for (const ext of [".docx", ".xlsx", ".txt", ".htm", ".heic", ".avif", ".dwg", null]) {
      expect(isCacheableMedia(ext)).toBe(false);
    }
  });
});

describe("paperworkLabel", () => {
  it("names the two sources that are paperwork rather than work", () => {
    expect(paperworkLabel("INVOICE")).toBe("Invoice");
    expect(paperworkLabel("QUOTE")).toBe("Quote");
    expect(paperworkLabel("invoice")).toBe("Invoice");
  });

  it("invents no label for anything else — a wrong one is worse than none", () => {
    expect(paperworkLabel("EMAIL_ATTACHMENT")).toBeNull();
    expect(paperworkLabel("")).toBeNull();
    expect(paperworkLabel(null)).toBeNull();
  });
});

describe("grouping and the count line", () => {
  const item = (over: Partial<JobMediaItem> & { remoteId: string }): JobMediaItem => ({
    name: "IMG_4021.jpg",
    fileType: ".jpg",
    kind: jobMediaKind(over.fileType ?? ".jpg"),
    paperwork: null,
    takenAt: null,
    url: null,
    ...over,
  });

  /* Job #3137's real shape: a wall of site photos, the quote and the invoice
     ServiceM8 generated, and a walkthrough video nobody here can play. */
  const jobShaped = [
    item({ remoteId: "p-1" }),
    item({ remoteId: "p-2" }),
    item({ remoteId: "d-1", name: "Invoice #3137.pdf", fileType: ".pdf", paperwork: "Invoice" }),
    item({ remoteId: "v-1", name: "walkthrough.mp4", fileType: ".mp4" }),
  ];

  it("splits into the three things the sheet shows, order preserved", () => {
    const g = groupJobMedia(jobShaped);
    expect(g.photos.map((i) => i.remoteId)).toEqual(["p-1", "p-2"]);
    expect(g.documents.map((i) => i.remoteId)).toEqual(["d-1"]);
    expect(g.elsewhere.map((i) => i.remoteId)).toEqual(["v-1"]);
  });

  it("says what's there, in a sentence", () => {
    expect(mediaCountLine(groupJobMedia(jobShaped))).toBe(
      "2 photos, 1 document and 1 left in ServiceM8"
    );
  });

  it("stays honest when a job has only one kind", () => {
    expect(mediaCountLine(groupJobMedia([item({ remoteId: "p-1" })]))).toBe("1 photo");
    expect(
      mediaCountLine(groupJobMedia([item({ remoteId: "d-1", fileType: ".pdf" })]))
    ).toBe("1 document");
  });

  it("says nothing is attached rather than showing an empty grid", () => {
    expect(mediaCountLine(groupJobMedia([]))).toBe("Nothing attached in ServiceM8");
  });
});
