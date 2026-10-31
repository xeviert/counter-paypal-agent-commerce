import Link from "next/link";
import { notFound } from "next/navigation";
import { Suspense } from "react";
import { requireSeller } from "@/lib/auth/seller";
import { getDb } from "@/lib/db";
import { translator } from "@/lib/i18n";
import { canPublish } from "@/lib/policy/seller";
import { sellerCountry } from "@/lib/schemas/common";
import { getSellerDraft } from "@/lib/shop/drafts";
import { Capture } from "../capture";
import { ReviewForm, type ReviewDefaults } from "../review-form";
import { StageProgress } from "../stage-progress";

export default function DraftPage({ params }: PageProps<"/s/drafts/[id]">) {
  return (
    <Suspense>
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

  if (draft.stage !== "ready" && draft.stage !== "failed") {
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
        stock: 1,
      }
    : { ...(seller.language === "en" ? { en: spoken } : { native: spoken }), stock: 1 };

  return (
    <>
      <header className="flex flex-col gap-2">
        <h1 className="font-heading text-2xl font-semibold tracking-tight">{t("review.title")}</h1>
        {draft.stage === "failed" && <p className="rounded-lg bg-muted p-3 text-sm">{t("stages.failed")}</p>}
      </header>
      {photos.length > 0 && (
        <ul className="flex gap-2 overflow-x-auto">
          {photos.map((photo) => (
            <li key={photo.id} className="size-20 shrink-0 overflow-hidden rounded-lg bg-muted">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src={`/api/photos/${photo.id}`} alt="" className="size-full object-cover" />
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
