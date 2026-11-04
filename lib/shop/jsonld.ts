import { formatCents, SHIPPING_REGIONS, type WeightClass } from "@/lib/schemas/common";
import { regionCountries, SHIPPING_USD_CENTS } from "@/lib/policy/shipping";
import type { ProductDetail } from "./catalog";

// schema.org Product markup for `/p/[slug]` (BUILDOUT §7.5). Built from the agent-facing detail, so
// the floor, stock count and maker contact details can't reach it.

export function productJsonLd(detail: ProductDetail, weightClass: WeightClass) {
  const seller = detail.maker.country;
  return {
    "@context": "https://schema.org",
    "@type": "Product",
    name: detail.en.title,
    description: detail.en.description,
    ...(detail.photoUrls.length > 0 && { image: detail.photoUrls }),
    sku: detail.productId,
    brand: { "@type": "Brand", name: detail.maker.name },
    ...(detail.en.materials && { material: detail.en.materials }),
    offers: {
      "@type": "Offer",
      price: detail.price.value,
      priceCurrency: detail.price.currency,
      availability: detail.inStock ? "https://schema.org/InStock" : "https://schema.org/OutOfStock",
      itemCondition: "https://schema.org/NewCondition",
      url: detail.url,
      shippingDetails: SHIPPING_REGIONS.flatMap((region) => {
        const countries = regionCountries(seller, region);
        if (countries.length === 0) return [];
        return [
          {
            "@type": "OfferShippingDetails",
            shippingRate: {
              "@type": "MonetaryAmount",
              value: formatCents(SHIPPING_USD_CENTS[seller][region][weightClass]),
              currency: "USD",
            },
            shippingDestination: { "@type": "DefinedRegion", addressCountry: countries },
          },
        ];
      }),
    },
  };
}

/** For a `<script>` body: listing text is maker- and model-written, so `</script>` must not survive. */
export function serializeJsonLd(value: unknown): string {
  return JSON.stringify(value).replace(/[<\u2028\u2029]/g, (c) => `\\u${c.charCodeAt(0).toString(16).padStart(4, "0")}`);
}
