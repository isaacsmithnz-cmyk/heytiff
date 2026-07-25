import { auth0 } from "@/lib/auth0";
import {
  mapPlaceToParts,
  type AddressSuggestion,
  type PlaceComponent,
} from "@/lib/address/map-place";

/* The address proxy — the ONLY thing in HeyTiff that talks to Google.

   WHY A PROXY AT ALL. The obvious build is Google's JS widget with a
   NEXT_PUBLIC key, and that ships the key to every visitor: it lands in the
   bundle, in view-source, in anyone's devtools, and the only protection left is
   an HTTP-referrer restriction you have to remember to set. Here the key never
   leaves the server. `GOOGLE_MAPS_API_KEY` has no NEXT_PUBLIC_ prefix, so Next
   will not inline it into client code even by accident.

   THE GATE IS FIRST, AND IT IS THE SESSION. Autocomplete is metered and billed
   per keystroke-session; an open endpoint is somebody else's free geocoder on
   our invoice. No Auth0 session, or a session with no org, is 401 before the
   body is even read.

   NOTHING FROM GOOGLE IS FORWARDED VERBATIM. A refusal from Places carries the
   request back to you — including, when the key is the problem, text about the
   key. So a bad answer becomes a flat 502 with our own sentence. The only
   Google-derived things that ever reach the browser are a place id, a display
   line, and four mapped address fields.

   BILLING, briefly: a session token groups the keystrokes of one lookup into a
   single billable autocomplete session, closed by resolving a place WITH that
   token. The browser mints the token per focus; both ops pass it through. */

const AUTOCOMPLETE_URL = "https://places.googleapis.com/v1/places:autocomplete";
const DETAILS_URL = "https://places.googleapis.com/v1/places";

/** Long enough for a cold Places call, short enough that a hung upstream never
    holds a serverless invocation open behind a person typing. */
const TIMEOUT_MS = 4000;

/** Under this, a query is a prefix of nothing useful — "12" matches every
    street in the country. Short-circuited here so it costs no billable call. */
const MIN_INPUT = 3;

/** The generic upstream failure. Deliberately says nothing about why: the
    reason may be the key. */
const UPSTREAM = "Address lookup isn't available right now.";

const json = (body: unknown, status = 200) => Response.json(body, { status });

type Body = {
  op?: unknown;
  input?: unknown;
  placeId?: unknown;
  sessionToken?: unknown;
};

const str = (v: unknown): string => (typeof v === "string" ? v : "");

export async function POST(request: Request) {
  const session = await auth0.getSession();
  if (!session?.user?.sub || !session.orgId) return json({ error: "Not signed in." }, 401);

  const key = process.env.GOOGLE_MAPS_API_KEY;
  /* No key configured is not an error — it is a deployment without address
     lookup, and the field is a plain text box. The browser stops asking. */
  if (!key) return json({ enabled: false }, 503);

  let body: Body;
  try {
    body = (await request.json()) as Body;
  } catch {
    return json({ error: "Bad request." }, 400);
  }

  const sessionToken = str(body.sessionToken);

  if (body.op === "suggest") {
    const input = str(body.input).trim();
    if (input.length < MIN_INPUT) return json({ enabled: true, suggestions: [] });
    return suggest(key, input, sessionToken);
  }

  if (body.op === "resolve") {
    const placeId = str(body.placeId);
    if (!placeId) return json({ error: "Bad request." }, 400);
    return resolve(key, placeId, sessionToken);
  }

  return json({ error: "Bad request." }, 400);
}

/** Google's autocomplete shape, as much of it as we read. */
type AutocompleteResponse = {
  suggestions?: {
    placePrediction?: { placeId?: unknown; text?: { text?: unknown } | null } | null;
  }[];
};

async function suggest(key: string, input: string, sessionToken: string): Promise<Response> {
  const data = await call<AutocompleteResponse>(AUTOCOMPLETE_URL, key, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      input,
      // Australia only. Every screen this feeds — the org's address, a staff
      // member's home address — is an Australian business's, and the filter
      // keeps a "Richmond" from offering Virginia's before Victoria's.
      includedRegionCodes: ["AU"],
      ...(sessionToken ? { sessionToken } : {}),
    }),
  });
  if (!data) return json({ error: UPSTREAM }, 502);

  const suggestions: AddressSuggestion[] = (data.suggestions ?? [])
    .map((s) => ({
      placeId: str(s?.placePrediction?.placeId),
      text: str(s?.placePrediction?.text?.text),
    }))
    // A prediction we can't resolve later is a row that does nothing when
    // clicked, so it never becomes a row.
    .filter((s) => s.placeId && s.text);

  return json({ enabled: true, suggestions });
}

type DetailsResponse = {
  formattedAddress?: unknown;
  addressComponents?: PlaceComponent[] | null;
};

async function resolve(key: string, placeId: string, sessionToken: string): Promise<Response> {
  /* encodeURIComponent on the id: it arrives from the browser, and a place id
     is the one value here that goes into a URL path. */
  const url = new URL(`${DETAILS_URL}/${encodeURIComponent(placeId)}`);
  // Passing the token HERE is what closes the billing session opened by the
  // keystrokes above; omitting it bills every one of them separately.
  if (sessionToken) url.searchParams.set("sessionToken", sessionToken);

  const data = await call<DetailsResponse>(url.toString(), key, {
    method: "GET",
    // Field mask is mandatory on Places v1, and it is also the bill: ask for
    // the two things the forms need and nothing else.
    headers: { "X-Goog-FieldMask": "addressComponents,formattedAddress" },
  });
  if (!data) return json({ error: UPSTREAM }, 502);

  return json({
    enabled: true,
    formatted: str(data.formattedAddress),
    parts: mapPlaceToParts(data.addressComponents),
  });
}

/** One Google call: key in the header, hard timeout, and `null` for every
    failure — a non-2xx, a timeout, unparseable JSON. The caller turns that into
    our own 502, so no Google body and no key-shaped text can ever be echoed. */
async function call<T>(url: string, key: string, init: RequestInit): Promise<T | null> {
  try {
    const res = await fetch(url, {
      ...init,
      headers: { ...(init.headers as Record<string, string>), "X-Goog-Api-Key": key },
      signal: AbortSignal.timeout(TIMEOUT_MS),
      cache: "no-store",
    });
    // No console.error with the response body: the whole point of the generic
    // message is defeated if the detail lands in a log line instead.
    if (!res.ok) return null;
    return (await res.json()) as T;
  } catch {
    return null;
  }
}
