# Deploying HeyTiff to Vercel

This assumes a Vercel project named **`heytiff`**, giving the production URL
**`https://heytiff.vercel.app`**. If that name is taken and Vercel gives you a
different URL, substitute it everywhere below (Auth0 URLs + `APP_BASE_URL`).

---

## 1. Auth0 dashboard — allow the production URL

Auth0 → **Applications → [your HeyTiff app] → Settings**. Add the production URL
alongside the existing localhost ones (comma-separated, keep both so dev still works):

| Field | Value |
|---|---|
| **Allowed Callback URLs** | `http://localhost:3000/auth/callback, https://heytiff.vercel.app/auth/callback` |
| **Allowed Logout URLs** | `http://localhost:3000, https://heytiff.vercel.app` |
| **Allowed Web Origins** | `http://localhost:3000, https://heytiff.vercel.app` |

Scroll down and **Save Changes**.

---

## 2. Vercel — import the repo

1. vercel.com → **Add New → Project** → import `isaacsmithnz-cmyk/heytiff`.
2. Set the **Project Name** to `heytiff` (this decides the `.vercel.app` URL).
3. Framework preset: **Next.js** (auto-detected). Leave build/output defaults.

---

## 3. Vercel — environment variables

Project → **Settings → Environment Variables**. Add all 9 (copy the values from your
local `.env.local`), scope = **Production** (and Preview if you want preview builds):

| Variable | Notes |
|---|---|
| `NEXT_PUBLIC_SUPABASE_URL` | same as local |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY` | same as local |
| `AUTH0_DOMAIN` | same as local |
| `AUTH0_CLIENT_ID` | same as local |
| `AUTH0_CLIENT_SECRET` | same as local |
| `AUTH0_SECRET` | same as local |
| `APP_BASE_URL` | **`https://heytiff.vercel.app`** ← the one value that differs from local |
| `SUPABASE_SERVICE_ROLE_KEY` | same as local |
| `SUPABASE_JWT_SECRET` | same as local |

---

## 4. Deploy & verify

1. **Deploy**. Wait for the build to finish.
2. Visit `https://heytiff.vercel.app` → you should be sent to Auth0 login.
3. Sign in → you land on `/dashboard`.

If the assigned URL is NOT `heytiff.vercel.app`, update the Auth0 URLs (step 1) and
the `APP_BASE_URL` env var (step 3) to match, then redeploy.

---

## Notes

- `.env.local` is gitignored — secrets are never pushed. Vercel env vars are the
  production source of truth.
- **Preview deployments** (per-branch URLs) won't pass Auth0 login unless you also add
  their URLs to Auth0. Production is what matters for now.
- Supabase needs no change — it's already cloud-hosted and the keys are environment-based.
