import type { Metadata } from "next";
import Link from "next/link";
import { buttonVariants } from "@/components/ui/button";

export const metadata: Metadata = { title: "Not found · Counter" };

export default function NotFound() {
  return (
    <main className="mx-auto flex w-full max-w-lg flex-1 flex-col gap-4 p-6">
      <p className="text-sm font-medium text-muted-foreground">Counter</p>
      <h1 className="font-heading text-2xl font-semibold tracking-tight">Nothing here</h1>
      <p className="text-muted-foreground">
        This link is wrong or the piece is no longer listed. An order link from your agent still works as long as you use the
        whole link.
      </p>
      <Link href="/" className={buttonVariants({ variant: "outline", className: "self-start" })}>
        Counter home
      </Link>
    </main>
  );
}
