import { auth0 } from "@/lib/auth0";
import { addressLookup } from "@/lib/address/places-proxy";

/* The web's door to the address proxy (lib/address/places-proxy). THE GATE
   IS FIRST, AND IT IS THE SESSION: no Auth0 session, or a session with no
   org, is 401 before the body is even read. */
export async function POST(request: Request) {
  const session = await auth0.getSession();
  if (!session?.user?.sub || !session.orgId) return Response.json({ error: "Not signed in." }, { status: 401 });
  return addressLookup(request);
}
