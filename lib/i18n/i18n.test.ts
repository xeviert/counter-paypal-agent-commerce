import { describe, expect, it } from "vitest";
import { createT, formatMoney, uiLocale, UI_LOCALES } from "./core";
import { messagesFor } from "./index";
import { en } from "./messages/en";

function keys(node: object, prefix = ""): string[] {
  return Object.entries(node).flatMap(([k, v]) =>
    typeof v === "string" ? [`${prefix}${k}`] : keys(v as object, `${prefix}${k}.`),
  );
}

function placeholders(text: string): string[] {
  return [...text.matchAll(/\{(\w+)\}/g)].map((m) => m[1]!).sort();
}

describe("catalogs", () => {
  const source = keys(en);

  it.each(UI_LOCALES)("%s has exactly the English keys, each non-empty", (locale) => {
    const messages = messagesFor(locale);
    expect(keys(messages).sort()).toEqual([...source].sort());
    const t = createT(messages);
    for (const key of source) expect(t(key as never).trim()).not.toBe("");
  });

  it.each(UI_LOCALES)("%s keeps every placeholder", (locale) => {
    const t = createT(messagesFor(locale));
    const tEn = createT(en);
    for (const key of source) expect(placeholders(t(key as never)), key).toEqual(placeholders(tEn(key as never)));
  });
});

describe("createT", () => {
  const t = createT(en);

  it("fills params and leaves unknown placeholders", () => {
    expect(t("home.greeting", { name: "Lucía" })).toBe("Hi, Lucía");
    expect(t("home.greeting")).toBe("Hi, {name}");
  });

  it("returns the key for a missing message", () => {
    expect(t("nope.missing" as never)).toBe("nope.missing");
  });
});

describe("uiLocale", () => {
  it("falls back to English for languages without a catalog", () => {
    expect(uiLocale("es")).toBe("es");
    expect(uiLocale("hi")).toBe("en");
    expect(uiLocale(undefined)).toBe("en");
  });
});

describe("formatMoney", () => {
  it("formats cents in the maker's locale", () => {
    expect(formatMoney(14500, "USD", "en")).toBe("$145.00");
    expect(formatMoney(14500, "USD", "es")).toContain("145.00");
  });
});
