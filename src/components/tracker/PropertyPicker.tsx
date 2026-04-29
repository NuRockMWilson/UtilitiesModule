"use client";

import { useRouter, usePathname } from "next/navigation";
import { displayPropertyName } from "@/lib/property-display";

export type PropertyOption = {
  code:     string;
  name:     string;
  full_code: string | null;
};

/**
 * Property selector dropdown. When the user switches properties, the app
 * navigates to the same detail tab for the new property, preserving the
 * current year. Used in the subheader of every property-level page so
 * you can jump between Sunset Pointe / Onion Creek / etc. without going
 * back to the summary index.
 */
export function PropertyPicker({
  currentCode,
  properties,
  year,
}: {
  currentCode: string;
  properties:  PropertyOption[];
  year:        number;
}) {
  const router   = useRouter();
  const pathname = usePathname(); // e.g. /tracker/601/water

  function handleChange(e: React.ChangeEvent<HTMLSelectElement>) {
    const newCode = e.target.value;
    if (!newCode || newCode === currentCode) return;
    // Replace the propertyCode segment; everything after /tracker/<code>/ is preserved
    const parts   = pathname.split("/");
    const trackIx = parts.indexOf("tracker");
    if (trackIx >= 0 && parts.length > trackIx + 1) {
      parts[trackIx + 1] = newCode;
      const suffix = parts.slice(trackIx + 2).join("/");
      const target = suffix
        ? `/tracker/${newCode}/${suffix}?year=${year}`
        : `/tracker/${newCode}?year=${year}`;
      router.push(target);
    }
  }

  return (
    <select
      value={currentCode}
      onChange={handleChange}
      className="px-2.5 py-1.5 rounded-md text-[12.5px] font-medium text-nurock-black bg-white border border-nurock-border hover:border-nurock-navy focus:outline-none focus:border-nurock-navy focus:ring-1 focus:ring-nurock-navy cursor-pointer max-w-[280px]"
      title="Switch property"
    >
      {properties.map(p => (
        <option key={p.code} value={p.code}>
          {displayPropertyName(p.name)}
        </option>
      ))}
    </select>
  );
}
