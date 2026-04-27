"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { cn } from "@/lib/cn";

/**
 * Left sidebar navigation. White background, slate text, tan accent on the
 * active item — matches the NuRock Development Management design system.
 *
 * Sticky under the 56px-tall header. 220px wide.
 */

type NavItem = {
  href:  string;
  label: string;
  icon:  React.ReactNode;
  badge?: string;
};

type NavGroup = {
  heading: string;
  items:   NavItem[];
};

// Icon builder — keeps the JSX below readable.
const Icon = ({ path }: { path: string }) => (
  <svg className="w-4 h-4 flex-shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24" aria-hidden>
    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d={path} />
  </svg>
);

const NAV_GROUPS: NavGroup[] = [
  {
    heading: "Workflow",
    items: [
      {
        href:  "/",
        label: "Dashboard",
        icon:  <Icon path="M3 12l2-2m0 0l7-7 7 7M5 10v10a1 1 0 001 1h3m10-11l2 2m-2-2v10a1 1 0 01-1 1h-3m-6 0a1 1 0 001-1v-4a1 1 0 011-1h2a1 1 0 011 1v4a1 1 0 001 1m-6 0h6" />,
      },
      {
        href:  "/invoices",
        label: "Invoices",
        icon:  <Icon path="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />,
      },
      {
        href:  "/invoices/upload",
        label: "Upload",
        icon:  <Icon path="M7 16a4 4 0 01-.88-7.903A5 5 0 1115.9 6L16 6a5 5 0 011 9.9M15 13l-3-3m0 0l-3 3m3-3v12" />,
      },
      {
        href:  "/payments",
        label: "Payments",
        icon:  <Icon path="M3 10h18M7 15h1m4 0h1m-7 4h12a3 3 0 003-3V8a3 3 0 00-3-3H6a3 3 0 00-3 3v8a3 3 0 003 3z" />,
      },
    ],
  },
  {
    heading: "Properties",
    items: [
      {
        href:  "/tracker",
        label: "Property trackers",
        icon:  <Icon path="M19 21V5a2 2 0 00-2-2H7a2 2 0 00-2 2v16m14 0h2m-2 0h-5m-9 0H3m2 0h5M9 7h1m-1 4h1m4-4h1m-1 4h1m-5 10v-5a1 1 0 011-1h2a1 1 0 011 1v5m-4 0h4" />,
      },
      {
        href:  "/variance",
        label: "Variance inquiries",
        icon:  <Icon path="M12 9v2m0 4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />,
      },
      {
        href:  "/reports",
        label: "Reports",
        icon:  <Icon path="M9 17v-2a2 2 0 012-2h2a2 2 0 012 2v2m-6 0h6m-6 0H9a2 2 0 01-2-2v-6a2 2 0 012-2h6a2 2 0 012 2v6a2 2 0 01-2 2h-.01M12 7V5" />,
      },
    ],
  },
  {
    heading: "Admin",
    items: [
      {
        href:  "/admin/vendors",
        label: "Vendors",
        icon:  <Icon path="M17 20h5v-2a3 3 0 00-5.356-1.857M17 20H7m10 0v-2c0-.656-.126-1.283-.356-1.857M7 20H2v-2a3 3 0 015.356-1.857M7 20v-2c0-.656.126-1.283.356-1.857m0 0a5.002 5.002 0 019.288 0M15 7a3 3 0 11-6 0 3 3 0 016 0zm6 3a2 2 0 11-4 0 2 2 0 014 0zM7 10a2 2 0 11-4 0 2 2 0 014 0z" />,
      },
      {
        href:  "/admin/utility-accounts",
        label: "Utility accounts",
        icon:  <Icon path="M13 10V3L4 14h7v7l9-11h-7z" />,
      },
      {
        href:  "/admin/contacts",
        label: "Contacts",
        icon:  <Icon path="M16 7a4 4 0 11-8 0 4 4 0 018 0zM12 14a7 7 0 00-7 7h14a7 7 0 00-7-7z" />,
      },
      {
        href:  "/admin/budgets",
        label: "Budgets",
        icon:  <Icon path="M9 19v-6a2 2 0 00-2-2H5a2 2 0 00-2 2v6a2 2 0 002 2h2a2 2 0 002-2zm0 0V9a2 2 0 012-2h2a2 2 0 012 2v10m-6 0a2 2 0 002 2h2a2 2 0 002-2m0 0V5a2 2 0 012-2h2a2 2 0 012 2v14a2 2 0 01-2 2h-2a2 2 0 01-2-2z" />,
      },
      {
        href:  "/admin/sage",
        label: "Sage integration",
        icon:  <Icon path="M4 7v10c0 2.21 3.582 4 8 4s8-1.79 8-4V7M4 7c0 2.21 3.582 4 8 4s8-1.79 8-4M4 7c0-2.21 3.582-4 8-4s8 1.79 8 4" />,
      },
      {
        href:  "/admin/users",
        label: "Users",
        icon:  <Icon path="M12 4.354a4 4 0 110 5.292M15 21H3v-1a6 6 0 0112 0v1zm0 0h6v-1a6 6 0 00-9-5.197M13 7a4 4 0 11-8 0 4 4 0 018 0z" />,
      },
    ],
  },
];

export function Sidebar() {
  const pathname = usePathname();

  const isActive = (href: string) => {
    if (href === "/") return pathname === "/";
    return pathname === href || pathname.startsWith(href + "/") || pathname.startsWith(href + "?");
  };

  return (
    <aside className="w-[220px] shrink-0 bg-white border-r border-nurock-border min-h-[calc(100vh-56px)] py-4 sticky top-[56px] self-start">
      <nav className="space-y-0.5">
        {NAV_GROUPS.map((group, groupIdx) => (
          <div key={group.heading}>
            <div className={cn(
              "nav-section-heading",
              groupIdx === 0 && "pt-1",
            )}>
              {group.heading}
            </div>
            {group.items.map(item => (
              <Link
                key={item.href}
                href={item.href}
                className={cn("nav-btn", isActive(item.href) && "active")}
              >
                {item.icon}
                <span>{item.label}</span>
                {item.badge && (
                  <span className="ml-auto text-[10px] px-1.5 py-0.5 rounded-full bg-nurock-navy text-white font-medium">
                    {item.badge}
                  </span>
                )}
              </Link>
            ))}
          </div>
        ))}
      </nav>
    </aside>
  );
}
