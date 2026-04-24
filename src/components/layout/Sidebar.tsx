import Link from "next/link";
import { NurockLogo } from "@/components/ui/NurockLogo";
import { cn } from "@/lib/cn";

const NAV_GROUPS = [
  {
    heading: "Workflow",
    items: [
      { href: "/",                 label: "Dashboard"         },
      { href: "/invoices",         label: "Invoices"          },
      { href: "/invoices?status=ready_for_approval", label: "Approval queue" },
      { href: "/payments",         label: "Payment queue"     },
    ],
  },
  {
    heading: "Property",
    items: [
      { href: "/tracker",   label: "Property trackers" },
      { href: "/variance",  label: "Variance inquiries" },
      { href: "/reports",   label: "Reports & exports" },
    ],
  },
  {
    heading: "Admin",
    items: [
      { href: "/admin/users",              label: "Users & roles"    },
      { href: "/admin/vendors",            label: "Vendors"          },
      { href: "/admin/utility-accounts",   label: "Utility accounts" },
      { href: "/admin/contacts",           label: "Property contacts" },
      { href: "/admin/budgets",            label: "Budgets"          },
      { href: "/admin/sage",              label: "Sage integration" },
      { href: "/admin/sage/batches",      label: "Sage batches"     },
    ],
  },
];

export function Sidebar({ activePath }: { activePath: string }) {
  return (
    <aside className="w-64 shrink-0 bg-navy text-white flex flex-col min-h-screen">
      <div className="px-5 py-6 border-b border-navy-700">
        <Link href="/" className="flex items-center gap-3">
          <NurockLogo color="#B4AE92" />
          <div className="flex flex-col leading-tight">
            <span className="font-display text-base font-semibold">NuRock</span>
            <span className="text-xs text-tan-300">Utilities AP</span>
          </div>
        </Link>
      </div>

      <nav className="flex-1 px-3 py-4 space-y-6">
        {NAV_GROUPS.map(group => (
          <div key={group.heading}>
            <div className="px-3 mb-2 text-[10px] uppercase tracking-wider text-tan-400">
              {group.heading}
            </div>
            <ul className="space-y-0.5">
              {group.items.map(item => {
                const active = activePath === item.href ||
                  (item.href !== "/" && activePath.startsWith(item.href.split("?")[0]));
                return (
                  <li key={item.href}>
                    <Link
                      href={item.href}
                      className={cn(
                        "block rounded px-3 py-1.5 text-sm transition",
                        active
                          ? "bg-navy-700 text-white"
                          : "text-navy-100 hover:bg-navy-700/60 hover:text-white",
                      )}
                    >
                      {item.label}
                    </Link>
                  </li>
                );
              })}
            </ul>
          </div>
        ))}
      </nav>

      <div className="px-5 py-4 border-t border-navy-700 text-xs text-tan-300">
        NuRock Companies · Alpharetta, GA
      </div>
    </aside>
  );
}
