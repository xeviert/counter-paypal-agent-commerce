"use client";

import { ArrowLeftIcon, MicIcon, SquareIcon, XIcon } from "lucide-react";
import { useRef, useState, useTransition } from "react";
import { useI18n } from "@/components/i18n";
import { FormError, TextAreaField } from "@/components/maker/field";
import { useVoice, type Recording } from "@/components/maker/use-voice";
import { Button } from "@/components/ui/button";
import { LOCALE_TAGS, type MessageKey } from "@/lib/i18n/core";
import { finishCapture, movePhoto, removePhoto, uploadPhoto, uploadVoice } from "./actions";
import { AddPhotoTiles } from "./photo-inputs";

const MAX_PHOTOS = 4;
const MAX_SIDE = 1280;

/**
 * Re-encodes on the phone before upload: fits 1280px, JPEG (iOS Safari can't encode WebP), and the
 * canvas drops EXIF. Also turns HEIC, which the browser can decode but sharp can't, into JPEG.
 */
async function resizeToJpeg(file: File): Promise<Blob> {
  const url = URL.createObjectURL(file);
  try {
    const img = new Image();
    img.src = url;
    await img.decode();
    const scale = Math.min(1, MAX_SIDE / Math.max(img.naturalWidth, img.naturalHeight));
    const canvas = document.createElement("canvas");
    canvas.width = Math.round(img.naturalWidth * scale);
    canvas.height = Math.round(img.naturalHeight * scale);
    canvas.getContext("2d")!.drawImage(img, 0, 0, canvas.width, canvas.height);
    return await new Promise((resolve, reject) =>
      canvas.toBlob((blob) => (blob ? resolve(blob) : reject(new Error("encode failed"))), "image/jpeg", 0.85),
    );
  } finally {
    URL.revokeObjectURL(url);
  }
}

type Photo = { id: string; position: number };

export function Capture({
  initial,
}: {
  initial?: { draftId: string; photos: Photo[]; transcript: string; hasVoice: boolean };
}) {
  const { t, locale } = useI18n();
  const draftRef = useRef(initial?.draftId);
  const [photos, setPhotos] = useState<Photo[]>(initial?.photos ?? []);
  const [uploading, setUploading] = useState(0);
  const [error, setError] = useState<MessageKey>();
  const [transcript, setTranscript] = useState(initial?.transcript ?? "");
  const [hasVoice, setHasVoice] = useState(initial?.hasVoice ?? false);
  const [submitting, startSubmit] = useTransition();

  function adoptDraft(draftId: string) {
    if (draftRef.current) return;
    draftRef.current = draftId;
    // Reloading /s/new would start over; the draft URL keeps the work.
    window.history.replaceState(null, "", `/s/drafts/${draftId}`);
  }

  async function onFiles(input: HTMLInputElement) {
    const files = Array.from(input.files ?? []);
    // Cleared now so picking the same photo again still fires onChange.
    input.value = "";
    if (!files.length) return;
    setError(undefined);
    // One at a time: the first upload creates the draft the rest attach to.
    for (const file of files.slice(0, MAX_PHOTOS - photos.length)) {
      setUploading((n) => n + 1);
      try {
        const form = new FormData();
        form.set("photo", await resizeToJpeg(file), "photo.jpg");
        if (draftRef.current) form.set("draftId", draftRef.current);
        const result = await uploadPhoto(form);
        if (!result.ok) {
          setError(result.error);
          break;
        }
        adoptDraft(result.draftId);
        setPhotos((current) => [...current, result.photo]);
      } catch {
        setError("capture.photoFailed");
      } finally {
        setUploading((n) => n - 1);
      }
    }
  }

  async function onRemove(photoId: string) {
    if (!draftRef.current) return;
    setPhotos((current) => current.filter((p) => p.id !== photoId));
    const result = await removePhoto(draftRef.current, photoId);
    if (!result.ok) setError(result.error);
  }

  async function onMoveEarlier(index: number) {
    if (!draftRef.current || index === 0) return;
    const next = [...photos];
    [next[index - 1], next[index]] = [next[index]!, next[index - 1]!];
    setPhotos(next);
    const result = await movePhoto(draftRef.current, photos[index]!.id);
    if (!result.ok) setError(result.error);
  }

  async function onRecorded(recording: Recording) {
    const form = new FormData();
    form.set("audio", new File([recording.blob], "voice", { type: recording.mime }));
    form.set("durationMs", String(recording.durationMs));
    if (draftRef.current) form.set("draftId", draftRef.current);
    const result = await uploadVoice(form);
    if (!result.ok) return setError(result.error);
    adoptDraft(result.draftId);
    setHasVoice(true);
  }

  const voice = useVoice({ lang: LOCALE_TAGS[locale], onTranscript: setTranscript, onRecorded: (r) => void onRecorded(r) });

  function onSubmit() {
    setError(undefined);
    if (!draftRef.current || photos.length === 0) return setError("capture.needPhoto");
    if (!transcript.trim() && !hasVoice) return setError("capture.needWords");
    const draftId = draftRef.current;
    startSubmit(async () => {
      const result = await finishCapture(draftId, transcript);
      if (result && !result.ok) setError(result.error);
    });
  }

  return (
    <div className="flex flex-col gap-6">
      <h1 className="font-heading text-2xl font-semibold tracking-tight">{t("capture.title")}</h1>
      <FormError error={error} />

      <section className="flex flex-col gap-3">
        <div>
          <h2 className="font-medium">{t("capture.photos")}</h2>
          <p className="text-sm text-muted-foreground">{t("capture.photosHint")}</p>
        </div>
        <ul className="grid grid-cols-2 gap-2">
          {photos.map((photo, i) => (
            <li key={photo.id} className="relative aspect-square overflow-hidden rounded-lg bg-muted">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src={`/api/photos/${photo.id}`} alt="" className="size-full object-cover" />
              <div className="absolute inset-x-1 top-1 flex justify-between">
                {i > 0 ? (
                  <Button type="button" size="icon-sm" variant="secondary" onClick={() => void onMoveEarlier(i)} aria-label={t("capture.moveEarlier")}>
                    <ArrowLeftIcon />
                  </Button>
                ) : (
                  <span />
                )}
                <Button type="button" size="icon-sm" variant="secondary" onClick={() => void onRemove(photo.id)} aria-label={t("capture.removePhoto")}>
                  <XIcon />
                </Button>
              </div>
            </li>
          ))}
          {Array.from({ length: uploading }, (_, i) => (
            <li key={`uploading-${i}`} className="flex aspect-square items-center justify-center rounded-lg bg-muted text-sm text-muted-foreground" aria-live="polite">
              {t("capture.uploading")}
            </li>
          ))}
          {photos.length + uploading < MAX_PHOTOS && <AddPhotoTiles onFiles={(input) => void onFiles(input)} />}
        </ul>
      </section>

      <section className="flex flex-col gap-3">
        <div>
          <h2 className="font-medium">{t("capture.voice")}</h2>
          <p className="text-sm text-muted-foreground">{t("capture.voiceHint")}</p>
        </div>
        {voice.state === "recording" ? (
          <Button type="button" size="lg" variant="destructive" className="h-14 text-base" onClick={voice.stop}>
            <SquareIcon className="size-5" aria-hidden />
            {t("capture.stop")} · {t("capture.recording", { seconds: voice.seconds })}
          </Button>
        ) : voice.state === "unsupported" ? (
          <p className="text-sm text-muted-foreground">{t("capture.noRecorder")}</p>
        ) : (
          <Button type="button" size="lg" variant="outline" className="h-14 text-base" onClick={() => void voice.start()}>
            <MicIcon className="size-5" aria-hidden />
            {hasVoice ? t("capture.recordAgain") : t("capture.record")}
          </Button>
        )}
        {voice.state === "denied" && <p className="text-sm text-destructive">{t("capture.micDenied")}</p>}
        {voice.speechError && (
          <p className="text-sm text-destructive">{t("capture.speechFailed", { error: voice.speechError })}</p>
        )}
        <TextAreaField
          name="transcript"
          label={t("capture.transcript")}
          hint={t("capture.transcriptHint")}
          rows={5}
          maxLength={5000}
          value={transcript}
          onChange={(e) => setTranscript(e.target.value)}
        />
      </section>

      <Button type="button" size="lg" className="h-12 text-base" onClick={onSubmit} disabled={submitting || uploading > 0 || voice.state === "recording"}>
        {t("capture.makeListing")}
      </Button>
    </div>
  );
}
