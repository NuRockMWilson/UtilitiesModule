import { TopBar } from "@/components/layout/TopBar";
import { VendorForm } from "../VendorForm";
import Link from "next/link";

export default function AddVendorPage() {
  return (
    <>
      <TopBar title="Add vendor" subtitle="Create a new vendor record" />
      <div className="px-8 py-4 bg-white border-b border-nurock-border">
        <Link href="/admin/vendors" className="btn-secondary">← Back to vendors</Link>
      </div>
      <div className="p-8">
        <VendorForm />
      </div>
    </>
  );
}
