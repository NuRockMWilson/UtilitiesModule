import { NextResponse, type NextRequest } from "next/server";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { buildSummaryWorkbook } from "@/lib/excel-export";

export async function GET(
  request: NextRequest,
  { params }: { params: { propertyCode: string } },
) {
  const supabase = createSupabaseServerClient();
  const year = Number(request.nextUrl.searchParams.get("year") ?? new Date().getFullYear());

  const { data: property } = await supabase
    .from("properties")
    .select("id, code, name, state")
    .eq("code", params.propertyCode)
    .single();
  if (!property) return NextResponse.json({ error: "Property not found" }, { status: 404 });

  const { data: glAccounts } = await supabase
    .from("gl_accounts")
    .select("id, code, description")
    .eq("active", true)
    .order("code");

  const { data: summary } = await supabase
    .from("v_property_summary")
    .select("*")
    .eq("property_id", property.id)
    .eq("year", year);

  const { data: budgets } = await supabase
    .from("budgets")
    .select("gl_account_id, amount")
    .eq("property_id", property.id)
    .eq("year", year);

  const budgetByGL = new Map<string, number>();
  for (const b of budgets ?? []) {
    budgetByGL.set(b.gl_account_id, (budgetByGL.get(b.gl_account_id) ?? 0) + Number(b.amount));
  }

  const actuals = new Map<string, Map<number, number>>();
  for (const r of summary ?? []) {
    if (!actuals.has(r.gl_account_id!)) actuals.set(r.gl_account_id!, new Map());
    if (r.month) actuals.get(r.gl_account_id!)!.set(r.month, Number(r.total_amount));
  }

  const rows = (glAccounts ?? []).map(gl => {
    const m = Array.from({ length: 12 }, (_, i) => actuals.get(gl.id)?.get(i + 1) ?? 0);
    return {
      gl_code: gl.code,
      description: gl.description,
      monthly: m,
      ytd: m.reduce((a, b) => a + b, 0),
      budget: budgetByGL.get(gl.id) ?? 0,
    };
  });

  const buf = await buildSummaryWorkbook({
    property: { code: property.code, name: property.name, state: property.state },
    year,
    rows,
    generatedAt: new Date(),
  });

  return new NextResponse(new Uint8Array(buf), {
    headers: {
      "Content-Type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      "Content-Disposition": `attachment; filename="${property.code}-${property.name.replace(/[^a-zA-Z0-9]/g, "_")}_${year}.xlsx"`,
    },
  });
}
