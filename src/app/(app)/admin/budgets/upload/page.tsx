import Link from "next/link";
import { TopBar } from "@/components/layout/TopBar";
import { BudgetUploadForm } from "../BudgetUploadForm";

export default function BudgetUploadPage() {
  return (
    <>
      <TopBar
        title="Upload budgets"
        subtitle="Bulk-load annual or monthly budgets from a CSV"
      />
      <div className="px-8 py-4 bg-white border-b border-nurock-border">
        <Link href="/admin/budgets" className="btn-secondary">← Back to budgets</Link>
      </div>
      <div className="p-8 max-w-3xl space-y-6">
        <div className="card p-5">
          <div className="font-display font-semibold text-nurock-black mb-2">CSV format</div>
          <div className="text-[12.5px] text-nurock-slate space-y-2">
            <p>Header row required, followed by one row per (property × GL × month).</p>
            <pre className="bg-[#FAFBFC] border border-nurock-border rounded-md p-3 text-[11.5px] font-mono whitespace-pre overflow-x-auto">
{`property_code,gl_code,year,month,amount
555,5120,2026,1,1500.00
555,5120,2026,2,1500.00
555,5125,2026,1,1850.00`}
            </pre>
            <ul className="list-disc pl-5 space-y-1 text-[12px]">
              <li><code>property_code</code> matches the property's NuRock code (e.g. <code>555</code>, <code>601</code>)</li>
              <li><code>gl_code</code> matches a GL account code (<code>5120</code> Water, <code>5135</code> Trash, etc.)</li>
              <li><code>month</code> is 1–12, or blank for an annual lump-sum budget</li>
              <li><code>amount</code> is in dollars; <code>$</code> and <code>,</code> are stripped automatically</li>
              <li>Re-uploading replaces existing budgets for any (property, year) combination present in the file</li>
            </ul>
          </div>
        </div>

        <BudgetUploadForm />
      </div>
    </>
  );
}
