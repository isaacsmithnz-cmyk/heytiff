import { createClient } from "@supabase/supabase-js";
import { SignJWT } from "jose";

const jwtSecret = new TextEncoder().encode(process.env.SUPABASE_JWT_SECRET!);

export async function createScopedClient(userId: string, orgId: string) {
  const token = await new SignJWT({ role: "authenticated", org_id: orgId })
    .setProtectedHeader({ alg: "HS256" })
    .setSubject(userId)
    .setIssuedAt()
    .setExpirationTime("1h")
    .sign(jwtSecret);

  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      global: { headers: { Authorization: `Bearer ${token}` } },
      auth: { persistSession: false },
    }
  );
}
