import Link from "next/link";
import { notFound } from "next/navigation";
import { Suspense } from "react";
import { PageLoading } from "@/components/maker/page-loading";
import { requireSeller } from "@/lib/auth/seller";
import { getDb } from "@/lib/db";
import { translator } from "@/lib/i18n";
import { canPublish } from "@/lib/policy/seller";
import { sellerCountry } from "@/lib/schemas/common";
import { getSellerDraft } from "@/lib/shop/drafts";
import { isStalePipeline, PIPELINE_STAGES } from "@/lib/shop/listing-pipeline";
import { Button } from "@/components/ui/button";
import { retryListing } from "../actions";
import { Capture } from "../capture";
import { ReviewForm, type ReviewDefaults } from "../review-form";
import { StageProgress } from "../stage-progress";

export default function DraftPage({ params }: PageProps<"/s/drafts/[id]">) {
  return (
    <Suspense fallback={<PageLoading />}>
      <Draft params={params} />
    </Suspense>
  );
}

async function Draft({ params }: { params: PageProps<"/s/drafts/[id]">["params"] }) {
  const seller = await requireSeller();
  const { id } = await params;
  const found = await getSellerDraft(getDb(), seller.id, id);
  if (!found) notFound();
  const { draft, photos } = found;
  const t = translator(seller.locale);

  if (draft.stage === "capturing") {
    return (
      <Capture
        initial={{ draftId: draft.id, photos, transcript: draft.transcript ?? "", hasVoice: draft.voiceNoteId !== null }}
      />
    );
  }

  if (draft.stage === "published") {
    return (
      <>
        <h1 className="font-heading text-2xl font-semibold tracking-tight">{t("stages.published")}</h1>
        <Link href="/s/listings" className="underline underline-offset-4">
          {t("listings.title")}
        </Link>
      </>
    );
  }

  // A run that died mid-way would leave the spinner up forever; the cron sweep fails these too.
  const stale = isStalePipeline(draft);
  if (PIPELINE_STAGES.includes(draft.stage) && !stale) {
    return (
      <>
        <h1 className="font-heading text-2xl font-semibold tracking-tight">{t(`stages.${draft.stage}`)}</h1>
        <StageProgress stage={draft.stage} />
      </>
    );
  }

  const generated = draft.result?.draft;
  // Without a generated draft the maker writes it; their own words start the native description.
  const spoken = { description: draft.transcript ?? "" };
  const defaults: ReviewDefaults = generated
    ? {
        category: generated.category,
        weightClass: generated.weightClass,
        en: generated.listing.en,
        native: generated.listing.native,
        dimensions: generated.listing.dimensions,
        listPrice: draft.result?.spokenPrice,
        stock: 1,
      }
    : { ...(seller.language === "en" ? { en: spoken } : { native: spoken }), stock: 1 };

  return (
    <>
      <header className="flex flex-col gap-2">
        <h1 className="font-heading text-2xl font-semibold tracking-tight">{t("review.title")}</h1>
        {(draft.stage === "failed" || stale) && (
          <div className="flex flex-col gap-2 rounded-lg bg-muted p-3 text-sm">
            <p>{draft.error === "capped" ? t("review.aiPaused") : t("stages.failed")}</p>
            {draft.error !== "capped" && (
              <form action={retryListing.bind(null, draft.id)}>
                <Button type="submit" variant="outline">
                  {t("review.retry")}
                </Button>
              </form>
            )}
          </div>
        )}
      </header>
      {photos.length > 0 && (
        <ul className="flex gap-2 overflow-x-auto">
          {photos.map((photo, i) => (
            <li key={photo.id} className="size-20 shrink-0 overflow-hidden rounded-lg bg-muted">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src={`/api/photos/${photo.id}`} alt={t("capture.photoAlt", { n: i + 1 })} className="size-full object-cover" />
            </li>
          ))}
        </ul>
      )}
      <ReviewForm
        draftId={draft.id}
        language={seller.language}
        country={sellerCountry.parse(seller.country)}
        defaults={defaults}
        guidance={draft.result?.priceGuidance}
        canGoLive={canPublish(seller)}
      />
    </>
  );
}
