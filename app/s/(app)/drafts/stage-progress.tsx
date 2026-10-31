"use client";

import { CheckIcon, LoaderCircleIcon } from "lucide-react";
import { useRouter } from "next/navigation";
import { useEffect } from "react";
import { useI18n } from "@/components/i18n";
import type { DraftStage } from "@/lib/schemas/common";

const PIPELINE: DraftStage[] = ["transcribing", "writing", "translating"];

/** Shown while the listing pipeline (§6.2) works. Never a bare spinner: the video can't show waits. */
export function StageProgress({ stage }: { stage: DraftStage }) {
  const { t } = useI18n();
  const router = useRouter();
  useEffect(() => {
    const timer = setInterval(() => router.refresh(), 1500);
    return () => clearInterval(timer);
  }, [router]);
  const current = PIPELINE.indexOf(stage);
  return (
    <ol className="flex flex-col gap-3" aria-live="polite">
      {PIPELINE.map((s, i) => (
        <li key={s} className={i > current ? "flex items-center gap-2 text-muted-foreground" : "flex items-center gap-2"}>
          {i < current ? (
            <CheckIcon className="size-5 text-green-700" aria-hidden />
          ) : i === current ? (
            <LoaderCircleIcon className="size-5 animate-spin" aria-hidden />
          ) : (
            <span className="size-5" />
          )}
          {t(`stages.${s}`)}
        </li>
      ))}
    </ol>
  );
}
