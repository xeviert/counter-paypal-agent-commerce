import { z } from "zod";

// Rows of the OpenAI Commerce product feed (BUILDOUT §7.5), served over HTTP at `/feed.json`.
// Unknown optional fields are left out, never null.

export const FEED_SPEC_URL = "https://developers.openai.com/commerce/specs/file-upload/products";

export const FEED_AVAILABILITY = ["in_stock", "out_of_stock", "pre_order", "backorder", "unknown"] as const;

const feedMoney = z.string().regex(/^\d+\.\d{2} [A-Z]{3}$/, 'expected "79.99 USD"');
const httpsUrl = z.url({ protocol: /^https$/ });
const decimal = z.string().regex(/^\d+(\.\d+)?$/);

export const feedItem = z.object({
  item_id: z.string().min(1),
  title: z.string().min(1).max(150),
  description: z.string().min(1).max(5000),
  url: httpsUrl,
  brand: z.string().min(1),
  seller_name: z.string().min(1),
  image_url: httpsUrl,
  additional_image_urls: z.array(httpsUrl).min(1).optional(),
  availability: z.enum(FEED_AVAILABILITY),
  price: feedMoney,
  condition: z.literal("new"),
  product_category: z.string().min(1),
  material: z.string().min(1).optional(),
  dimensions: z
    .object({ length: decimal.optional(), width: decimal.optional(), height: decimal.optional(), unit: z.literal("cm") })
    .refine((d) => [d.length, d.width, d.height].filter(Boolean).length >= 2, "needs at least two sides")
    .optional(),
  /** `country:region:service_class:price`, e.g. `US::Standard:22.00 USD`. */
  shipping: z.array(z.string().regex(/^[A-Z]{2}:[^:]*:[^:]+:\d+\.\d{2} [A-Z]{3}$/)).optional(),
  is_eligible_search: z.boolean(),
  is_eligible_checkout: z.boolean(),
});

export type FeedItem = z.output<typeof feedItem>;

export type ProductFeed = {
  spec: string;
  generated_at: string;
  /** Sellable products left out because the spec requires an image. */
  skipped: number;
  items: FeedItem[];
};
