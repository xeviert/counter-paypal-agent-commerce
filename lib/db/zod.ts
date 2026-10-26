import { createInsertSchema, createSelectSchema } from "drizzle-zod";
import {
  category,
  consentStatus,
  eventSource,
  events,
  offerDecision,
  offers,
  orderStatus,
  orders,
  photos,
  products,
  productStatus,
  refunds,
  releaseStatus,
  sellers,
  weightClass,
} from "./schema";

export const ORDER_STATUSES = orderStatus.enumValues;
export const RELEASE_STATUSES = releaseStatus.enumValues;
export const PRODUCT_STATUSES = productStatus.enumValues;
export const CONSENT_STATUSES = consentStatus.enumValues;
export const OFFER_DECISIONS = offerDecision.enumValues;
export const EVENT_SOURCES = eventSource.enumValues;
export const WEIGHT_CLASSES = weightClass.enumValues;
export const CATEGORIES = category.enumValues;

export type OrderStatus = (typeof ORDER_STATUSES)[number];
export type Category = (typeof CATEGORIES)[number];
export type WeightClass = (typeof WEIGHT_CLASSES)[number];

export const sellerSelect = createSelectSchema(sellers);
export const sellerInsert = createInsertSchema(sellers);
export const productSelect = createSelectSchema(products);
export const productInsert = createInsertSchema(products);
export const photoInsert = createInsertSchema(photos);
export const offerSelect = createSelectSchema(offers);
export const offerInsert = createInsertSchema(offers);
export const orderSelect = createSelectSchema(orders);
export const orderInsert = createInsertSchema(orders);
export const refundInsert = createInsertSchema(refunds);
export const eventInsert = createInsertSchema(events);
