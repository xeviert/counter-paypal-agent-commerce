import { describe, expect, it } from "vitest";
import type { ProductDetail } from "./catalog";
import { productJsonLd, serializeJsonLd } from "./jsonld";

const detail: ProductDetail = {
  productId: "6f1c2b0e-1d2a-4c55-9a3e-0d9f3f0b7a11",
  title: "Rug",
  category: "textiles",
  price: { currency: "USD", value: "150.00" },
  inStock: true,
  negotiable: true,
  maker: { name: "Ana", country: "MX", locality: "Teotitlán del Valle" },
  url: "https://counter.test/p/rug",
  photoUrl: "https://counter.test/api/photos/a",
  available: 2,
  language: "es",
  en: { title: "Rug", description: "A rug", materials: "wool" },
  native: { title: "Tapete", description: "Un tapete" },
  photoUrls: ["https://counter.test/api/photos/a"],
};

describe("productJsonLd", () => {
  it("describes the product, its offer and shipping by region", () => {
    const ld = productJsonLd(detail, "medium");
    expect(ld).toMatchObject({
      "@type": "Product",
      name: "Rug",
      sku: detail.productId,
      brand: { "@type": "Brand", name: "Ana" },
      material: "wool",
      image: detail.photoUrls,
      offers: {
        "@type": "Offer",
        price: "150.00",
        priceCurrency: "USD",
        availability: "https://schema.org/InStock",
        itemCondition: "https://schema.org/NewCondition",
        url: detail.url,
      },
    });
    const shipping = ld.offers.shippingDetails;
    expect(shipping.map((s) => s.shippingRate.value)).toEqual(["9.00", "22.00", "32.00"]);
    expect(shipping[0]!.shippingDestination.addressCountry).toEqual(["MX"]);
    expect(shipping[1]!.shippingDestination.addressCountry).toEqual(["US", "CA"]);
    expect(productJsonLd({ ...detail, inStock: false }, "small").offers.availability).toBe(
      "https://schema.org/OutOfStock",
    );
  });

  it("leaves out stock counts and the native listing", () => {
    const text = serializeJsonLd(productJsonLd(detail, "medium"));
    expect(text).not.toContain("available");
    expect(text).not.toContain("Tapete");
  });
});

describe("serializeJsonLd", () => {
  it("can't close the script tag", () => {
    const title = "</script><script>alert(1)</script> ";
    const text = serializeJsonLd(productJsonLd({ ...detail, en: { ...detail.en, title } }, "medium"));
    expect(text).not.toContain("<");
    expect(text).not.toContain(" ");
    expect(JSON.parse(text).name).toBe(title);
  });
});
