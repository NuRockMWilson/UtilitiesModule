import { NextResponse } from "next/server";
import { createSupabaseServerClient } from "@/lib/supabase/server";

export async function POST(request: Request, { params }: { params: { id: string } }) {
  const body = await request.json();
  const { explanation, exclude_from_baseline } = body as {
    explanation: string; exclude_from_baseline?: boolean;
  };

  if (!explanation || !explanation.trim()) {
    return NextResponse.json({ error: "Explanation required" }, { status: 400 });
  }

  const supabase = createSupabaseServerClient();
  const { data: { user } } = await supabase.auth.getUser();

  const { error } = await supabase
    .from("invoices")
    .update({
      variance_explanation: explanation.trim(),
      exclude_from_baseline: !!exclude_from_baseline,
    })
    .eq("id", params.id);

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  await supabase.from("approval_log").insert({
    invoice_id: params.id,
    action: "variance_explained",
    actor_id: user?.id,
    actor_email: user?.email,
    notes: explanation.trim(),
    metadata: { exclude_from_baseline: !!exclude_from_baseline },
  });

  return NextResponse.json({ success: true });
}
