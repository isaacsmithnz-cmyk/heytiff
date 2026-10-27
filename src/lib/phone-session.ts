import { AsyncLocalStorage } from "node:async_hooks";

/* THE PHONE STANDING IN FOR A SIGN-IN, for one request (Isaac, 28 October
   2026: Tiff on the phone does what she does on the web — "This is the same
   as how it works on the web now"). The web's own server code knows who is
   asking from the Auth0 session; the phone has no session, only a token
   requireMobile verified. While a phone route runs the web's code for that
   person (lib/mobile/auth's actAsPhoneUser), `auth0.getSession()` answers
   with them (lib/auth0), so every gate, capability and press in that code is
   theirs, decided exactly as it is for them on the web.

   ONLY lib/mobile/auth ENTERS IT, and only with a context it verified: a
   test holds that nothing else imports `enterPhoneSession`. Outside a phone
   route the store is empty and the session is the browser's, as ever. */

type PhoneIdentity = { orgId: string; userId: string };

const store = new AsyncLocalStorage<PhoneIdentity>();

/** Run `fn` as this verified phone user. lib/mobile/auth's door only. */
export function enterPhoneSession<T>(who: PhoneIdentity, fn: () => Promise<T>): Promise<T> {
  return store.run({ orgId: who.orgId, userId: who.userId }, fn);
}

/** The session the web's code reads while a phone route acts for someone; null everywhere else. */
export function phoneSession(): { user: { sub: string }; orgId: string } | null {
  const who = store.getStore();
  return who ? { user: { sub: who.userId }, orgId: who.orgId } : null;
}
