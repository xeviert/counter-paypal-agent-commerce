"use client";

import Link from "next/link";
import { Button, buttonVariants } from "@/components/ui/button";

export default function RootError({ retry }: { error: unknown; retry: () => void }) {
  return (
    <main role="alert" className="mx-auto flex w-full max-w-lg flex-1 flex-col gap-4 p-6">
      <p className="text-sm font-medium text-muted-foreground">Counter</p>
      <h1 className="font-heading text-2xl font-semibold tracking-tight">This page didn&apos;t load.</h1>
      <p className="text-muted-foreground">Something went wrong on our side. Please try again.</p>
      <div className="flex gap-2">
        <Button type="button" onClick={() => retry()}>
          Try again
        </Button>
        <Link href="/" className={buttonVariants({ variant: "outline" })}>
          Counter home
        </Link>
      </div>
    </main>
  );
}
