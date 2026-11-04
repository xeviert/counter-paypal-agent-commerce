import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { Suspense } from "react";
import { getDb } from "@/lib/db";
import { getEnv } from "@/lib/env";
import { PolicyError } from "@/lib/policy/errors";
import type { Money } from "@/lib/schemas/common";
import type { ListingText } from "@/lib/schemas/listing";
import { getProductBySlug } from "@/lib/shop/catalog";
import { productJsonLd, serializeJsonLd } from "@/lib/shop/jsonld";

// Plain product page for humans, with schema.org JSON-LD for crawlers (BUILDOUT §7.5). Buying happens through an agent.

export const metadata: Metadata = { title: "Handmade on Counter" };

const regionNames = new Intl.DisplayNames(["en"], { type: "region" });
const fmt = (m: Money) => `${m.value} ${m.currency}`;

export default function ProductPage({ params }: PageProps<"/p/[slug]">) {
  return (
    <main className="mx-auto flex w-full max-w-2xl flex-1 flex-col gap-6 p-6">
      <p className="text-sm font-medium text-muted-foreground">Counter</p>
      <Suspense fallback={<p className="text-muted-foreground">Loading…</p>}>
        <Product params={params} />
      </Suspense>
    </main>
  );
}

async function Product({ params }: { params: PageProps<"/p/[slug]">["params"] }) {
  const { slug } = await params;
  let found;
  try {
    found = await getProductBySlug(getDb(), slug);
  } catch (err) {
    if (err instanceof PolicyError && err.code === "PRODUCT_NOT_FOUND") notFound();
    if (err instanceof PolicyError && (err.code === "PRODUCT_UNAVAILABLE" || err.code === "SELLER_NOT_RECEIVABLE")) {
      return <p>This piece isn&apos;t for sale right now.</p>;
    }
    throw err;
  }
  const { detail: p, seller, product } = found;
  const where = [seller.locality, regionNames.of(p.maker.country)].filter(Boolean).join(", ");

  return (
    <article className="flex flex-col gap-6">
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{ __html: serializeJsonLd(productJsonLd(p, product.weightClass)) }}
      />
      {p.photoUrls.length > 0 && (
        <div className="grid grid-cols-2 gap-2">
          {p.photoUrls.map((src, i) => (
            // Photos are already resized WebP from our own route; next/image adds nothing here.
            // eslint-disable-next-line @next/next/no-img-element
            <img
              key={src}
              src={src}
              alt={i === 0 ? p.en.title : ""}
              className="aspect-square w-full rounded-lg object-cover"
            />
          ))}
        </div>
      )}

      <header className="flex flex-col gap-1">
        <h1 className="font-heading text-2xl font-semibold tracking-tight">{p.en.title}</h1>
        {p.native && (
          <p lang={p.language} className="text-muted-foreground">
            {p.native.title}
          </p>
        )}
        <p className="text-sm">
          By {p.maker.name}
          {where && ` · ${where}`}
        </p>
      </header>

      <div className="flex flex-col gap-1">
        <p className="text-xl font-semibold tabular-nums">{fmt(p.price)}</p>
        {p.approxLocalPrice && (
          <p className="text-sm text-muted-foreground">≈ {fmt(p.approxLocalPrice)} (approx.)</p>
        )}
        <p className="text-sm text-muted-foreground">{p.available > 0 ? `${p.available} available` : "Sold out"}</p>
      </div>

      <ListingSection text={p.en} />
      {p.native && (
        <details className="rounded-lg border p-4">
          <summary className="cursor-pointer text-sm font-medium">In the maker&apos;s words</summary>
          <div lang={p.language} className="mt-4">
            <ListingSection text={p.native} />
          </div>
        </details>
      )}

      {p.dimensions && (
        <p className="text-sm">
          Size: {p.dimensions.lengthCm} × {p.dimensions.widthCm}
          {p.dimensions.heightCm && ` × ${p.dimensions.heightCm}`} cm
          {p.dimensions.note && ` (${p.dimensions.note})`}
        </p>
      )}

      <aside className="rounded-lg bg-muted p-4 text-sm">
        To buy, ask an AI assistant connected to Counter ({getEnv().APP_BASE_URL}/api/mcp). You approve the payment
        on PayPal, and PayPal holds it until your order arrives.
      </aside>
    </article>
  );
}

function ListingSection({ text }: { text: ListingText }) {
  return (
    <div className="flex flex-col gap-4">
      <p className="whitespace-pre-line">{text.description}</p>
      {text.provenance && (
        <section>
          <h2 className="font-medium">Who made it</h2>
          <p className="whitespace-pre-line">{text.provenance}</p>
        </section>
      )}
      {text.materials && (
        <section>
          <h2 className="font-medium">Materials</h2>
          <p>{text.materials}</p>
        </section>
      )}
      {text.care && (
        <section>
          <h2 className="font-medium">Care</h2>
          <p>{text.care}</p>
        </section>
      )}
    </div>
  );
}
