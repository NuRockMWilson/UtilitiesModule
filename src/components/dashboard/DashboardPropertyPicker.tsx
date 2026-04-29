"use client";

import { useRouter, usePathname, useSearchParams } from "next/navigation";
import { displayPropertyName } from "@/lib/property-display";

/**
 * Property scope filter for the dashboard. Default is "All properties".
 * Selecting a property navigates to /?propertyId=<id> and re-renders the
 * dashboard with everything (Attention cards, workflow tiles, all queries)
 * filtered to that property.
 */
export type PropertyOption = {
  id:        string;
  code:      string;
  name:      string;
  full_code: string | null;
};

export function DashboardPropertyPicker({
  properties,
  currentPropertyId,
}: {
  properties:        PropertyOption[];
  currentPropertyId: string | null;
}) {
  const router       = useRouter();
  const pathname     = usePathname();
  const searchParams = useSearchParams();

  function handleChange(e: React.ChangeEvent<HTMLSelectElement>) {
    const v = e.target.value;
    const params = new URLSearchParams(searchParams.toString());
    if (v) params.set("propertyId", v);
    else   params.delete("propertyId");
    const qs = params.toString();
    router.push(qs ? `${pathname}?${qs}` : pathname);
  }

  return (
    <div className="flex items-center gap-2">
      <label htmlFor="dash-property-picker" className="font-display text-[10px] font-semibold uppercase tracking-[0.08em] text-nurock-slate">
        Scope
      </label>
      <select
        id="dash-property-picker"
        value={currentPropertyId ?? ""}
        onChange={handleChange}
        className="px-2.5 py-1.5 rounded-md text-[12.5px] font-medium text-nurock-black bg-white border border-nurock-border hover:border-nurock-navy focus:outline-none focus:border-nurock-navy focus:ring-1 focus:ring-nurock-navy cursor-pointer max-w-[280px]"
      >
        <option value="">All properties</option>
        {properties.map(p => (
          <option key={p.id} value={p.id}>
            {displayPropertyName(p.name)}
          </option>
        ))}
      </select>
    </div>
  );
}
