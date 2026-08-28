/* The classifier that decides what a job's files ARE. Every case here is a
   file type the live Diamond Air account actually holds — the distribution
   was counted before this was written, so the tail cases are real rather
   than imagined. */

import {
  documentGroupOf,
  groupJobMedia,
  isCacheableMedia,
  jobMediaKind,
  mediaCountLine,
  normaliseFileType,
  originLabel,
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
     default and WILL arrive. AVIF is NOT one of these — Chrome has drawn it
     since 2020, and classing it a document once cost hundreds of photos a
     release as bare filenames. */
  it("treats browser-unrenderable images as documents, not photos", () => {
    for (const ext of [".heic", ".heif"]) {
      expect(jobMediaKind(ext)).toBe("document");
    }
    expect(jobMediaKind(".avif")).toBe("photo");
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
    for (const ext of [".docx", ".xlsx", ".txt", ".htm", ".heic", ".dwg", null]) {
      expect(isCacheableMedia(ext)).toBe(false);
    }
    /* a photo the browser can draw is a photo the cache may hold */
    expect(isCacheableMedia(".avif")).toBe(true);
  });
});

describe("originLabel", () => {
  it("names the two sources that are paperwork rather than work", () => {
    expect(originLabel("INVOICE")).toBe("Invoice");
    expect(originLabel("QUOTE")).toBe("Quote");
    expect(originLabel("invoice")).toBe("Invoice");
  });

  /* A file somebody EMAILED in is a different thing from one produced on
     site — 283 PDFs on jobs in the live account arrived this way. Note the
     camel case: `InboxMessage` is the only source spelled that way, which is
     exactly why the comparison upper-cases first. */
  it("names an emailed-in file, whatever the case on the wire", () => {
    expect(originLabel("InboxMessage")).toBe("Emailed in");
    expect(originLabel("INBOXMESSAGE")).toBe("Emailed in");
    expect(originLabel("  inboxmessage  ")).toBe("Emailed in");
  });

  /* Every one of these is a REAL source in the live account. They stay
     unlabelled until one earns a label — a guessed one is worse than none. */
  it("names the marked-up photo and the work order's paper", () => {
    expect(originLabel("PHOTO_MARKUP")).toBe("Marked up");
    expect(originLabel("WORK_ORDER")).toBe("Work order");
  });

  it("invents no label for the sources that haven't earned one", () => {
    for (const unlabelled of [
      "INVOICE_SIGNOFF",
      "IMAGINE",
      "DOCUMENT",
      "SERVICE_QUESTION_CHOICE",
      "PHOTO_LIBRARY_ON_CHECKOUT",
      "",
    ]) {
      expect(originLabel(unlabelled)).toBeNull();
    }
    expect(originLabel(null)).toBeNull();
    expect(originLabel(undefined)).toBeNull();
  });
});

describe("grouping and the count line", () => {
  const item = (over: Partial<JobMediaItem> & { remoteId: string }): JobMediaItem => ({
    name: "IMG_4021.jpg",
    fileType: ".jpg",
    kind: jobMediaKind(over.fileType ?? ".jpg"),
    origin: null,
    fromClaim: null,
    takenAt: null,
    url: null,
    width: null,
    height: null,
    ...over,
  });

  /* Job #3137's real shape: a wall of site photos, the quote and the invoice
     ServiceM8 generated, and a walkthrough video nobody here can play. */
  const jobShaped = [
    item({ remoteId: "p-1" }),
    item({ remoteId: "p-2" }),
    item({ remoteId: "d-1", name: "Invoice #3137.pdf", fileType: ".pdf", origin: "Invoice" }),
    item({ remoteId: "v-1", name: "walkthrough.mp4", fileType: ".mp4" }),
  ];

  /* VIDEO GOES WITH THE PHOTOS (Isaac's call, walked): a walkthrough clip is
     footage from the visit, not paperwork. Its bytes still never cache —
     that is `isCacheableMedia`'s business, not the lens's. */
  it("puts what was shot on site in one lens, paper in another", () => {
    const g = groupJobMedia(jobShaped);
    expect(g.photos.map((i) => i.remoteId)).toEqual(["p-1", "p-2", "v-1"]);
    expect(g.documents.map((i) => i.remoteId)).toEqual(["d-1"]);
    expect(g.elsewhere).toHaveLength(0);
  });

  it("leaves a file it cannot show at all in elsewhere", () => {
    const g = groupJobMedia([item({ remoteId: "x-1", name: "plan.dwg", fileType: ".dwg" })]);
    expect(g.elsewhere.map((i) => i.remoteId)).toEqual(["x-1"]);
    expect(g.photos).toHaveLength(0);
  });

  it("says what's there, in a sentence", () => {
    expect(mediaCountLine(groupJobMedia(jobShaped))).toBe("3 photos and 1 document");
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

describe("documentGroupOf — the Documents face's sections", () => {
  const item = (over: Partial<JobMediaItem>): JobMediaItem => ({
    remoteId: "x",
    name: "f.pdf",
    fileType: ".pdf",
    kind: "document",
    origin: null,
    fromClaim: null,
    takenAt: null,
    url: null,
    width: null,
    height: null,
    ...over,
  });

  it("groups by what a document IS, never by which system made it", () => {
    expect(documentGroupOf(item({ origin: "Invoice" }))).toBe("money");
    expect(documentGroupOf(item({ origin: "Quote" }))).toBe("money");
    expect(documentGroupOf(item({ origin: "Work order" }))).toBe("money");
    expect(documentGroupOf(item({ origin: "Emailed in" }))).toBe("client");
    expect(documentGroupOf(item({ origin: null }))).toBe("files");
  });
});
