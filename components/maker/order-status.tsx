import { cn } from "cn";
import type { OrderStatus } from "@/lib/schemas/common";

const TONE: Partial<Record<OrderStatus, string>> = {
  PaidHeld: "bg-status-wait/12 text-status-wait",
  Shipped: "bg-status-moving/12 text-status-moving",
  Released: "bg-status-done/12 text-status-done",
  Disputed: "bg-destructive/10 text-destructive",
};

export function OrderStatusBadge({ status, label, className }: { status: OrderStatus; label: string; className?: string }) {
  return (
    <span
      className={cn(
        "inline-flex h-6 w-fit shrink-0 items-center gap-1.5 rounded-sm px-2 text-xs font-medium whitespace-nowrap",
        TONE[status] ?? "bg-muted text-muted-foreground",
        className,
      )}
    >
      <span className="size-1.5 rounded-full bg-current" aria-hidden />
      {label}
    </span>
  );
}
