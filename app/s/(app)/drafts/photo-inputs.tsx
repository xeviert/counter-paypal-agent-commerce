"use client";

import { CameraIcon, ImagesIcon } from "lucide-react";
import { useI18n } from "@/components/i18n";

const TILE =
  "flex aspect-square cursor-pointer flex-col items-center justify-center gap-2 rounded-lg border-2 border-dashed text-center text-sm text-muted-foreground";

/** Camera and gallery side by side: `capture` alone would hide photos taken earlier. */
export function AddPhotoTiles({ onFiles }: { onFiles: (input: HTMLInputElement) => void }) {
  const { t } = useI18n();
  return (
    <>
      <li>
        <label className={TILE}>
          <CameraIcon className="size-8" aria-hidden />
          {t("capture.takePhoto")}
          <input
            type="file"
            accept="image/*"
            capture="environment"
            className="sr-only"
            onChange={(e) => onFiles(e.currentTarget)}
          />
        </label>
      </li>
      <li>
        <label className={TILE}>
          <ImagesIcon className="size-8" aria-hidden />
          {t("capture.addPhoto")}
          <input type="file" accept="image/*" multiple className="sr-only" onChange={(e) => onFiles(e.currentTarget)} />
        </label>
      </li>
    </>
  );
}
