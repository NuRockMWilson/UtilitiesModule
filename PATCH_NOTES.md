# NuRock Utilities AP — Patch (April 30, 2026)

## Files in this patch

### 🆕 NEW: `src/lib/admin-auth.ts`
Reusable admin auth gate for batch / system API routes. Two layered paths:
1. **API key** — `x-admin-api-key: $ADMIN_API_KEY` header (cron, watcher, curl)
2. **Authenticated admin user** — Supabase cookie + `user_profiles.role = 'admin'` (UI buttons)

If either passes, the route proceeds. Returns `{ ok: true, principal }` so the route can audit-log who triggered it. Constant-time comparison on the API key prevents timing attacks.

### ✏️ MODIFIED: `src/app/api/variance/recompute/route.ts`
- Now calls `requireAdmin(req)` at the top — returns 401/403 if neither auth path passes
- Switched from `createSupabaseServerClient()` to `createSupabaseServiceClient()` so RLS doesn't silently filter out accounts the caller can't see (this is what caused `accounts: 0` from curl earlier)
- Returns `actor` in the response payload so you can confirm which auth path was used

### 🆕 NEW: `src/lib/vendor-resolver.ts`
Property-aware vendor resolver. Fixes the bug where the auto-coder picked the wrong Republic variant (Duncan Disposal vs. Republic Services Inc.). Resolution order:
1. Active UA at the same property whose vendor name fuzzy-matches → property-specific variant
2. Portfolio-wide UA search ranked by usage count → most-used variant wins
3. Vendors table direct fuzzy match
4. Falls back to null (queued for manual coding)

### ✏️ MODIFIED: `src/app/api/extract/[invoiceId]/route.ts`
When the account-number lookup returns no UA, the new `else` branch calls `resolveVendor()` and sets `vendorId` from the result. Resolver debug message is appended to `extraction_warnings` so it shows up in the UI for the human reviewer.

### 🆕 NEW: `src/app/(app)/admin/ua-audit/page.tsx` + `OrphanAuditClient.tsx`
Portfolio-wide orphan UA audit page at `/admin/ua-audit`. Detects UAs with placeholder account numbers (`*Total`, `*Summary`, etc.), groups them as "auto-resolvable" vs "needs manual resolution", and generates copy-to-clipboard merge SQL for each.

### ✏️ MODIFIED: `src/components/layout/Sidebar.tsx`
"UA audit" nav link added under Admin → Utility accounts.

### ✏️ MODIFIED: `.env.example`
Documents the new `ADMIN_API_KEY` env var with a generation command.

---

## Deploy steps

### 1. Generate the admin API key
On your laptop:
```bash
node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"
```
Save the hex string — you'll paste it into Vercel.

### 2. Add to Vercel env
- Project → Settings → Environment Variables
- Name: `ADMIN_API_KEY`
- Value: the hex string from step 1
- Environments: Production, Preview, Development
- Save

### 3. (Optional) Add to local `.env.local`
Same key/value if you want curl from localhost to work. Not required for the UI button.

### 4. Drop files into the repo and push
```bash
cd ~/Documents/Utilities\ Dashboard/nurock-utilities-ap

# Copy patch files into the repo (preserve directory structure).
# Then:
npx tsc --noEmit                          # should be silent
git add .
git commit -m "Property-aware vendor resolver + UA audit + admin auth gate

- src/lib/vendor-resolver.ts: property-scoped vendor disambiguation
- src/lib/admin-auth.ts: layered API-key + admin-user auth gate
- /api/variance/recompute: gated, switched to service-role client
- /admin/ua-audit: portfolio-wide orphan UA detection + merge SQL
- Extract route uses vendor resolver when no UA matches account number
- Sidebar: UA audit link"
git push origin main
```
Vercel auto-builds.

### 5. Confirm everything works
- **UI button**: Visit `/variance` → "Recompute & save" → result populates in-card. The new `actor` field will show `{type: "user", userId: ..., email: ...}`.
- **curl with key**:
  ```bash
  curl -X POST https://nurockutilities.vercel.app/api/variance/recompute -H "Content-Type: application/json" -H "x-admin-api-key: <your-key>"
  ```
  Should return real `accounts` / `invoices` counts (not zero), with `actor: {type: "api_key", label: "admin_api_key"}`.
- **curl without key** → `401 Unauthorized`. Good — that's the gate working.

### 6. Walk the UA audit
Visit `/admin/ua-audit`. For each "Auto-resolvable" orphan: copy SQL → Supabase SQL editor → run → verify in `/admin/utility-accounts`.

---

## Pattern this establishes

Future admin/batch routes follow the same shape:
```ts
import { requireAdmin } from "@/lib/admin-auth";
import { createSupabaseServiceClient } from "@/lib/supabase/server";

export async function POST(req: Request) {
  const auth = await requireAdmin(req);
  if (!auth.ok) return auth.response;

  const supabase = createSupabaseServiceClient();
  // ... batch logic, optionally logging auth.principal ...
}
```
When RBAC lands with Kelsey, `requireAdmin` becomes one of N role-check helpers (`requireAPClerk`, `requireApprover`, etc.) — same gate pattern, more roles. No need to re-plumb every route.
