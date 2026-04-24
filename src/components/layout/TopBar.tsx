/**
 * Page subheader — sits below the navy top Header and above page content.
 * White background, title in Oswald, optional subtitle in slate.
 *
 * Used on every page to display the page title and any quick descriptor.
 * Kept purely presentational with no data dependencies so it renders
 * cleanly from both server and client components.
 */
export function TopBar({
  title,
  subtitle,
}: {
  title: string;
  subtitle?: string;
  /** @deprecated kept for backward compatibility — email now lives in the Header */
  userEmail?: string | null;
}) {
  return (
    <div className="bg-white border-b border-nurock-border px-8 py-4">
      <div className="max-w-[1600px] mx-auto">
        <h1 className="font-display text-[20px] font-semibold text-nurock-black tracking-tight leading-none">
          {title}
        </h1>
        {subtitle && (
          <p className="text-[12.5px] text-nurock-slate-light mt-1.5">{subtitle}</p>
        )}
      </div>
    </div>
  );
}
