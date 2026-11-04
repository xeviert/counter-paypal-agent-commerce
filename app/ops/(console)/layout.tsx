import Link from "next/link";
import { Suspense } from "react";
import { Badge } from "@/components/ui/badge";
import { requireOperator } from "@/lib/auth/operator";
import { opsLogOut } from "../actions";

const NAV = [
  { href: "/ops", label: "Needs attention" },
  { href: "/ops/events", label: "Audit log" },
  { href: "/ops/listings", label: "Flagged listings" },
  { href: "/ops/fees", label: "Fees" },
] as const;

export default function ConsoleLayout({ children }: LayoutProps<"/ops">) {
  return (
    <Suspense fallback={<div className="flex-1" aria-busy="true" />}>
      <Shell>{children}</Shell>
    </Suspense>
  );
}

async function Shell({ children }: { children: React.ReactNode }) {
  const role = await requireOperator();
  const nav = role === "operator" ? [...NAV, { href: "/ops/copilot", label: "Copilot" }] : NAV;
  return (
    <div className="mx-auto flex w-full max-w-6xl flex-1 flex-col">
      <header className="flex flex-wrap items-center gap-x-6 gap-y-2 border-b px-4 py-3">
        <span className="flex items-center gap-2 text-sm font-medium">
          Counter ops
          {role === "judge" && <Badge variant="secondary">Judge · read-only</Badge>}
        </span>
        <nav aria-label="Operator console" className="flex flex-wrap gap-4 text-sm">
          {nav.map((item) => (
            <Link key={item.href} href={item.href} className="text-muted-foreground underline-offset-4 hover:text-foreground hover:underline">
              {item.label}
            </Link>
          ))}
        </nav>
        <form action={opsLogOut} className="ml-auto">
          <button type="submit" className="text-sm text-muted-foreground underline-offset-4 hover:underline">
            Sign out
          </button>
        </form>
      </header>
      <main className="flex flex-1 flex-col gap-8 p-4 pb-16">{children}</main>
    </div>
  );
}
