import { ok, requireMobile } from "@/lib/mobile/auth";
import { readPhoneDocuments } from "@/lib/mobile/documents";

/* DOCUMENTS for the phone (lib/mobile/documents): the company's papers with
   their certificates, and your own licences. Read only; ungated, as what a
   builder asks to see is handed out anyway, and your licences are yours. */
export async function GET(request: Request) {
  const ctx = await requireMobile(request);
  if (ctx instanceof Response) return ctx;
  return ok(await readPhoneDocuments(ctx));
}
