/* PRINT THE DESIGN IN A HEADLESS CHROME, AND KEEP THE FILE.

   The page it prints is /print/design — the same PrintDoc the Share dialog
   hands the print window — so the file is the paper Isaac already approved
   ("the PDFs already come out nicely"), not a second rendering of it.

   On Vercel the browser is @sparticuz/chromium: a Chromium built for
   serverless, unpacked from its brotli archive on first use. Its version is
   PINNED to the Chrome that puppeteer-core expects (153 ↔ 25.11.0) — they
   must move together. On a laptop there is no such build (it is Linux-only),
   so the local Chrome prints instead; CHROME_PATH names another.

   The browser goes to APP_BASE_URL in production: the canonical host, which
   the proxy does not redirect. Anywhere else it goes back to the origin the
   request came in on, so a dev server prints its own code. */

import { signPdfTicket, type PdfTicket } from "./pdf-request";

const LOCAL_CHROME = "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";
const READY_MS = 25_000;

export async function renderDesignPdf(ticket: PdfTicket, origin: string): Promise<Uint8Array> {
  const puppeteer = (await import("puppeteer-core")).default;
  const onVercel = Boolean(process.env.VERCEL);
  const chromium = onVercel ? (await import("@sparticuz/chromium")).default : null;

  const browser = await puppeteer.launch(
    chromium
      ? {
          args: await puppeteer.defaultArgs({ args: chromium.args, headless: "shell" }),
          executablePath: await chromium.executablePath(),
          headless: "shell",
        }
      : { executablePath: process.env.CHROME_PATH ?? LOCAL_CHROME, headless: true }
  );
  try {
    const page = await browser.newPage();
    const base =
      process.env.VERCEL_ENV === "production" && process.env.APP_BASE_URL
        ? process.env.APP_BASE_URL
        : origin;
    const url = new URL("/print/design", base);
    url.searchParams.set("t", signPdfTicket(ticket));
    const res = await page.goto(url.toString(), { waitUntil: "load", timeout: READY_MS });
    if (!res || !res.ok()) throw new Error(`print page answered ${res?.status() ?? "nothing"}`);
    /* PrintDoc raises this once every plan raster and the logo have decoded
       — the moment the print window would have opened */
    await page.waitForFunction("window.__htPdfReady === true", { timeout: READY_MS });
    /* the page's own @page rule sets the paper and the orientation */
    return await page.pdf({ preferCSSPageSize: true, printBackground: true });
  } finally {
    await browser.close();
  }
}
