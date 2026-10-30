/* The links a builder sends instead of files (29 October 2026): the Krui
   Street tender's plans sat behind an architect's OneDrive folder. */
import { aShare, jobShareLinks, shareLinksIn, shareWhat } from "../share-links";
import { textOfEmail } from "../inbound";

const KRUI =
  "Please provide an itemised quotation for your trade using the attached\nscope and relevant plans.\n\n" +
  "Tender link: 260917 Tender Issue\n" +
  "<https://watershedmanly-my.sharepoint.com/:f:/g/personal/elizabeth_watershedarchitects_com/IgAF2z7THNucTI9gTui9UyvrATDDz37u48fUlLEzwl7nEic?e=wLQywM>\n\n" +
  "*Quotation required by:* 21/10/26\n\n" +
  "2 Krui Street, Fairlight <https://www.google.com/maps/search/2+Krui+Street,+Fairlight?entry=gmail&source=g>\n" +
  "Follow us on Instagram <https://www.instagram.com/jt.construct/>";

it("brings the tender folder out of the Krui Street email, by the name the builder gave it, and leaves the map and Instagram", () => {
  expect(shareLinksIn(KRUI)).toEqual([
    {
      url: "https://watershedmanly-my.sharepoint.com/:f:/g/personal/elizabeth_watershedarchitects_com/IgAF2z7THNucTI9gTui9UyvrATDDz37u48fUlLEzwl7nEic?e=wLQywM",
      name: "260917 Tender Issue",
      what: "OneDrive folder",
    },
  ]);
});

it("knows a folder from a file on the places plans are shared, and nothing else", () => {
  expect(shareWhat("https://contoso.sharepoint.com/:f:/s/Tenders/abc")).toBe("SharePoint folder");
  expect(shareWhat("https://contoso.sharepoint.com/:b:/s/Tenders/abc")).toBe("SharePoint file");
  expect(shareWhat("https://www.dropbox.com/scl/fo/abc/def?rlkey=x&dl=0")).toBe("Dropbox folder");
  expect(shareWhat("https://www.dropbox.com/scl/fi/abc/M-101.pdf?rlkey=x")).toBe("Dropbox file");
  expect(shareWhat("https://drive.google.com/drive/folders/1AbC")).toBe("Google Drive folder");
  expect(shareWhat("https://drive.google.com/file/d/1AbC/view")).toBe("Google Drive file");
  expect(shareWhat("https://we.tl/t-AbC")).toBe("WeTransfer");
  expect(shareWhat("https://app.estimateone.com/tenders/123")).toBe("EstimateOne");
  expect(shareWhat("https://www.google.com/maps/search/x")).toBeNull();
  expect(shareWhat("https://notsharepoint.com/:f:/x")).toBeNull();
  expect(shareWhat("ftp://dropbox.com/x")).toBeNull();
  expect(shareWhat("not a link")).toBeNull();
});

it("takes the link out of Outlook's Safe Links, names a bare link by what it is, and keeps each one once", () => {
  const inner = "https://www.dropbox.com/scl/fo/abc/def?rlkey=x&dl=0";
  const wrapped = `https://aus01.safelinks.protection.outlook.com/?url=${encodeURIComponent(inner)}&data=05%7C02`;
  expect(shareLinksIn(`Drawings:\n${wrapped}\n\nAgain ${inner}.`)).toEqual([{ url: inner, name: "Dropbox folder", what: "Dropbox folder" }]);
});

it("keeps a link's address when the email came as HTML only, so its plans can still be found", () => {
  const text = textOfEmail(null, '<p>Tender link: <a href="https://www.dropbox.com/scl/fo/abc?rlkey=x&amp;dl=0">Stage 2 drawings</a></p><p><a href="mailto:a@b.com">a@b.com</a></p>');
  expect(text).toBe("Tender link: Stage 2 drawings <https://www.dropbox.com/scl/fo/abc?rlkey=x&dl=0>\na@b.com");
  expect(shareLinksIn(text)).toEqual([{ url: "https://www.dropbox.com/scl/fo/abc?rlkey=x&dl=0", name: "Stage 2 drawings", what: "Dropbox folder" }]);
});

it("says a or an before what it is", () => {
  expect(aShare("OneDrive folder")).toBe("a OneDrive folder");
  expect(aShare("EstimateOne")).toBe("an EstimateOne");
});

it("gathers a job's links from its emails, newest first, each once, under the builder's name and never the forwarder's", () => {
  const folder = "https://www.dropbox.com/scl/fo/abc?rlkey=x";
  const links = jobShareLinks([
    { id: "e2", body: `Revised: Stage 2 <${folder}>`, proposal: { client: "JT Construct Pty Ltd", contact: { first: "Shaheer", last: "Khan" } } },
    { id: "e1", body: `${KRUI}\nAgain <${folder}>`, proposal: { client: "JT Construct Pty Ltd", contact: { first: "", last: "" } } },
    { id: "e0", body: null, proposal: null },
  ]);
  expect(links.map((l) => [l.emailId, l.name, l.from])).toEqual([
    ["e2", "Stage 2", "Shaheer Khan"],
    ["e1", "260917 Tender Issue", "JT Construct Pty Ltd"],
  ]);
});
