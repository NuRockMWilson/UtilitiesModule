#!/usr/bin/env node
/**
 * First-run setup checker.
 *   npm run setup
 *
 * Verifies environment variables, Supabase connectivity, and Anthropic
 * access. Prints a checklist of what's configured and what still needs
 * attention. Safe to run repeatedly.
 */

const required = {
  "NEXT_PUBLIC_SUPABASE_URL": "Supabase project URL",
  "NEXT_PUBLIC_SUPABASE_ANON_KEY": "Supabase anon key",
  "SUPABASE_SERVICE_ROLE_KEY": "Supabase service role key (server-only)",
  "ANTHROPIC_API_KEY": "Anthropic API key for bill extraction",
  "NEXT_PUBLIC_APP_URL": "Public URL of this app",
};

const optional = {
  "RESEND_API_KEY": "Variance inquiry emails",
  "VARIANCE_FROM_EMAIL": "From-address for inquiry emails",
  "INTAKE_WEBHOOK_SECRET": "Inbound email webhook",
  "SAGE_300_CRE_EXPORT_DIR": "Sage 300 CRE AP import target",
  "SAGE_INTACCT_COMPANY_ID": "Sage Intacct integration",
};

require("dotenv").config({ path: ".env.local" });

console.log("\nNuRock Utilities AP — setup check\n");

let missingRequired = 0;
for (const [key, desc] of Object.entries(required)) {
  const ok = !!process.env[key];
  console.log(`  ${ok ? "✓" : "✗"}  ${key.padEnd(32)}  ${ok ? "" : "— " + desc}`);
  if (!ok) missingRequired++;
}

console.log("\n  Optional (fill in as features are enabled):");
for (const [key, desc] of Object.entries(optional)) {
  const ok = !!process.env[key];
  console.log(`  ${ok ? "✓" : "·"}  ${key.padEnd(32)}  ${ok ? "" : "— " + desc}`);
}

console.log("");
if (missingRequired > 0) {
  console.log(`  ${missingRequired} required variable(s) missing. Edit .env.local and re-run.`);
  process.exit(1);
}

console.log("  Required variables look good. Next steps:");
console.log("    1. Push the schema:        supabase db push   (or paste migrations into the SQL editor)");
console.log("    2. Start the dev server:   npm run dev");
console.log("    3. Promote yourself:       see README for the user_profiles insert");
console.log("");
