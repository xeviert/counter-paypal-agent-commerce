import { createInsertSchema, createSelectSchema } from "drizzle-zod";
import { listingContent } from "@/lib/schemas/listing";
import {
  consentStatus,
  eventSource,
  events,
  offerDecision,
  offers,
  orders,
  photos,
  products,
  productStatus,
  refunds,
  sellers,
} from "./schema";

export {
  CATEGORIES,
  ORDER_STATUSES,
  RELEASE_STATUSES,
  WEIGHT_CLASSES,
  type Category,
  type OrderStatus,
  type WeightClass,
} from "@/lib/schemas/common";

export const PRODUCT_STATUSES = productStatus.enumValues;
export const CONSENT_STATUSES = consentStatus.enumValues;
export const OFFER_DECISIONS = offerDecision.enumValues;
export const EVENT_SOURCES = eventSource.enumValues;

export const sellerSelect = createSelectSchema(sellers);
export const sellerInsert = createInsertSchema(sellers);
export const productSelect = createSelectSchema(products, { listing: listingContent });
export const productInsert = createInsertSchema(products, { listing: listingContent });
export const photoInsert = createInsertSchema(photos);
export const offerSelect = createSelectSchema(offers);
export const offerInsert = createInsertSchema(offers);
export const orderSelect = createSelectSchema(orders);
export const orderInsert = createInsertSchema(orders);
export const refundInsert = createInsertSchema(refunds);
export const eventInsert = createInsertSchema(events);
