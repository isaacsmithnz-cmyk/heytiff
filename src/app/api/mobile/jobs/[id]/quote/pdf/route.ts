import { GET as pdfGet } from "@/app/api/workboard/quote-pdf/route";
import { actAsPhoneUser, requireMobile } from "@/lib/mobile/auth";

/* The quote as a PDF, for the phone's own share sheet: the web's own, as the token's person. */
export const maxDuration = 60;

export async function GET(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const ctx = await requireMobile(request, "workboard");
  if (ctx instanceof Response) return ctx;
  const job = (await params).id.trim().slice(0, 80);
  /* its origin is this host's: Chrome prints the quote's page from it */
  const origin = new URL(request.url).origin;
  return actAsPhoneUser(ctx, () => pdfGet(new Request(`${origin}/api/workboard/quote-pdf?job=${encodeURIComponent(job)}`)));
}
