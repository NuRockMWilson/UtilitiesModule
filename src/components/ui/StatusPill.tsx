import { cn } from "@/lib/cn";
import { STATUS_LABEL, STATUS_COLOR, type InvoiceStatus } from "@/lib/types";

export function StatusPill({ status }: { status: InvoiceStatus }) {
  return (
    <span className={cn("badge", STATUS_COLOR[status])}>
      {STATUS_LABEL[status]}
    </span>
  );
}

export function VarianceFlag({ flag }: { flag: "green" | "yellow" | "red" }) {
  const color =
    flag === "green"  ? "bg-green-100 text-green-800" :
    flag === "yellow" ? "bg-yellow-100 text-yellow-800" :
                        "bg-red-100 text-red-800";
  const label =
    flag === "green"  ? "Within threshold" :
    flag === "yellow" ? "Review" :
                        "Flag";
  return <span className={cn("badge", color)}>{label}</span>;
}
