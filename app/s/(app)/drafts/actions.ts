"use server";

import { redirect } from "next/navigation";
import { requireSeller } from "@/lib/auth/seller";
import { getDb } from "@/lib/db";
import type { MessageKey } from "@/lib/i18n/core";
import { log } from "@/lib/log";
import { MAX_PHOTO_BYTES, UnsupportedPhotoError } from "@/lib/photos";
import { reviewFieldError, reviewFromForm, reviewInput } from "@/lib/schemas/maker";
import { startListing } from "@/lib/shop/listing-runner";
import {
  addDraftPhoto,
  DraftError,
  movePhotoEarlier,
  publishDraft,
  removeDraftPhoto,
  retryDraft,
  saveVoiceNote,
  submitCapture,
  type DraftPhoto,
} from "@/lib/shop/drafts";

type Result<T> = ({ ok: true } & T) | { ok: false; error: MessageKey };

function failure(err: unknown, fallback: MessageKey): { ok: false; error: MessageKey } {
  if (err instanceof DraftError) return { ok: false, error: err.code };
  if (err instanceof UnsupportedPhotoError) return { ok: false, error: "capture.photoFailed" };
  log.error("draft action failed", { error: err });
  return { ok: false, error: fallback };
}

const optionalId = (value: FormDataEntryValue | null) => (typeof value === "string" && value ? value : undefined);

export async function uploadPhoto(form: FormData): Promise<Result<{ draftId: string; photo: DraftPhoto }>> {
  const seller = await requireSeller();
  const file = form.get("photo");
  if (!(file instanceof File) || file.size === 0 || file.size > MAX_PHOTO_BYTES) {
    return { ok: false, error: "capture.photoFailed" };
  }
  try {
    const result = await addDraftPhoto(getDb(), seller.id, optionalId(form.get("draftId")), Buffer.from(await file.arrayBuffer()));
    return { ok: true, ...result };
  } catch (err) {
    return failure(err, "capture.photoFailed");
  }
}

export async function removePhoto(draftId: string, photoId: string): Promise<Result<object>> {
  const seller = await requireSeller();
  try {
    await removeDraftPhoto(getDb(), seller.id, draftId, photoId);
    return { ok: true };
  } catch (err) {
    return failure(err, "errors.generic");
  }
}

export async function movePhoto(draftId: string, photoId: string): Promise<Result<object>> {
  const seller = await requireSeller();
  try {
    await movePhotoEarlier(getDb(), seller.id, draftId, photoId);
    return { ok: true };
  } catch (err) {
    return failure(err, "errors.generic");
  }
}

export async function uploadVoice(form: FormData): Promise<Result<{ draftId: string }>> {
  const seller = await requireSeller();
  const file = form.get("audio");
  if (!(file instanceof File)) return { ok: false, error: "errors.generic" };
  const durationMs = Number(form.get("durationMs"));
  try {
    const result = await saveVoiceNote(getDb(), seller.id, optionalId(form.get("draftId")), {
      mime: file.type,
      bytes: Buffer.from(await file.arrayBuffer()),
      durationMs: Number.isFinite(durationMs) ? Math.round(durationMs) : undefined,
    });
    return { ok: true, ...result };
  } catch (err) {
    return failure(err, "errors.generic");
  }
}

export async function finishCapture(draftId: string, transcript: string): Promise<Result<object>> {
  const seller = await requireSeller();
  try {
    const { startPipeline } = await submitCapture(getDb(), seller.id, draftId, transcript);
    if (startPipeline) await startListing(draftId);
  } catch (err) {
    return failure(err, "errors.generic");
  }
  redirect(`/s/drafts/${draftId}`);
}

export async function retryListing(draftId: string): Promise<void> {
  const seller = await requireSeller();
  if (await retryDraft(getDb(), seller.id, draftId)) await startListing(draftId);
  redirect(`/s/drafts/${draftId}`);
}

export type PublishState = {
  error?: MessageKey;
  fields?: Record<string, MessageKey>;
};

export async function publish(draftId: string, _prev: PublishState, form: FormData): Promise<PublishState> {
  const seller = await requireSeller();
  const parsed = reviewInput.safeParse(reviewFromForm(form, seller.language));
  if (!parsed.success) {
    const fields: Record<string, MessageKey> = {};
    for (const issue of parsed.error.issues) {
      const { field, key } = reviewFieldError(issue);
      fields[field] ??= key as MessageKey;
    }
    return { fields };
  }
  try {
    await publishDraft(getDb(), seller, draftId, parsed.data);
  } catch (err) {
    return { error: failure(err, "errors.generic").error };
  }
  redirect("/s/listings");
}
