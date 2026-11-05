"use client";

import Link from "next/link";
import { useOptionalI18n } from "@/components/i18n";
import { Button, buttonVariants } from "@/components/ui/button";

export default function MakerError({ retry }: { error: unknown; retry: () => void }) {
  const i18n = useOptionalI18n();
  const t = (key: "errors.pageFailed" | "errors.generic" | "errors.retry" | "nav.home", fallback: string) => (i18n ? i18n.t(key) : fallback);
  return (
    <div role="alert" className="flex flex-col gap-4">
      <h1 className="font-heading text-2xl font-semibold tracking-tight">{t("errors.pageFailed", "This page didn't load.")}</h1>
      <p className="text-muted-foreground">{t("errors.generic", "Something went wrong. Please try again.")}</p>
      <div className="flex gap-2">
        <Button type="button" onClick={() => retry()}>
          {t("errors.retry", "Try again")}
        </Button>
        <Link href="/s" className={buttonVariants({ variant: "outline" })}>
          {t("nav.home", "Home")}
        </Link>
      </div>
    </div>
  );
}
