import { z } from "zod";
import { parseMoney } from "./common";
import { listingDraft } from "./listing";

// Maker app form inputs (BUILDOUT §6.1). Error messages are i18n keys, rendered by the form.

/** Countries a maker can sign up from. IN was dropped Oct 31 (no persona, no sandbox account). */
export const SIGNUP_COUNTRIES = ["MX", "PH", "KE"] as const;
export const SIGNUP_LANGUAGES = ["es", "fil", "sw", "en"] as const;

export const DEFAULT_LANGUAGE: Record<(typeof SIGNUP_COUNTRIES)[number], (typeof SIGNUP_LANGUAGES)[number]> = {
  MX: "es",
  PH: "fil",
  KE: "sw",
};

export const MIN_PASSWORD_LENGTH = 8;

const email = z.string().trim().toLowerCase().pipe(z.email({ error: "errors.email" }).max(254));

export const signupInput = z.object({
  name: z.string().trim().min(1, { error: "errors.required" }).max(80),
  email,
  password: z.string().min(MIN_PASSWORD_LENGTH, { error: "errors.passwordShort" }).max(200),
  country: z.enum(SIGNUP_COUNTRIES, { error: "errors.required" }),
  language: z.enum(SIGNUP_LANGUAGES, { error: "errors.required" }),
});

export const loginInput = z.object({
  email,
  password: z.string().min(1, { error: "errors.required" }).max(200),
});

export type SignupInput = z.infer<typeof signupInput>;

const MAX_LIST_CENTS = 1_000_000;

/** "45", "45.5", "45.50" → cents. Rejects anything PayPal wouldn't take as a USD amount. */
export const priceField = z
  .string()
  .trim()
  .regex(/^\d{1,5}(\.\d{1,2})?$/, { error: "review.invalidPrice" })
  .transform((value) => parseMoney(value))
  .refine((cents) => cents > 0 && cents <= MAX_LIST_CENTS, { error: "review.invalidPrice" });

export const reviewInput = z
  .object({
    draft: listingDraft,
    listPrice: priceField,
    floorPrice: priceField,
    stock: z.coerce.number({ error: "review.invalidStock" }).int({ error: "review.invalidStock" }).min(0, { error: "review.invalidStock" }).max(999, { error: "review.invalidStock" }),
  })
  .refine((r) => r.floorPrice <= r.listPrice, { error: "review.floorAboveList", path: ["floorPrice"] });

export type ReviewInput = z.output<typeof reviewInput>;

const LISTING_FIELDS = ["title", "description", "materials", "care", "provenance"] as const;

function text(form: FormData, name: string): string | undefined {
  const value = form.get(name);
  return typeof value === "string" && value.trim() ? value.trim() : undefined;
}

function number(form: FormData, name: string): number | undefined {
  const value = text(form, name);
  return value === undefined ? undefined : Number(value);
}

/** Review form → `reviewInput` shape. Blank optional fields are dropped so the listing schema stays strict. */
export function reviewFromForm(form: FormData, language: string) {
  const side = (prefix: string) =>
    Object.fromEntries(LISTING_FIELDS.flatMap((f) => (text(form, `${prefix}.${f}`) ? [[f, text(form, `${prefix}.${f}`)]] : [])));
  const length = number(form, "lengthCm");
  const width = number(form, "widthCm");
  const height = number(form, "heightCm");
  return {
    draft: {
      category: text(form, "category"),
      weightClass: text(form, "weightClass"),
      listing: {
        language,
        en: side("en"),
        ...(language !== "en" && { native: side("native") }),
        ...(length !== undefined && width !== undefined && {
          dimensions: { lengthCm: length, widthCm: width, ...(height !== undefined && { heightCm: height }) },
        }),
      },
    },
    listPrice: text(form, "listPrice") ?? "",
    floorPrice: text(form, "floorPrice") ?? "",
    stock: text(form, "stock") ?? "",
  };
}

/** Zod issue path → the form field name the error shows under, and the message key. */
export function reviewFieldError(issue: z.core.$ZodIssue): { field: string; key: string } {
  const path = issue.path.map(String);
  if (path[0] === "draft" && path[1] === "listing") {
    const [, , side, field] = path;
    if (side === "dimensions") return { field: "lengthCm", key: "errors.required" };
    if (side === "en") return { field: `en.${field ?? "title"}`, key: "review.needEnglish" };
    return { field: `native.${field ?? "title"}`, key: "review.needNative" };
  }
  if (path[0] === "draft") return { field: path[1] ?? "category", key: "errors.required" };
  const field = path[0] ?? "listPrice";
  return { field, key: issue.message.includes(".") ? issue.message : "errors.required" };
}
