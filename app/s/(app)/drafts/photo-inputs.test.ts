import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { I18nProvider } from "@/components/i18n";
import { en } from "@/lib/i18n/messages/en";
import { AddPhotoTiles } from "./photo-inputs";

describe("AddPhotoTiles", () => {
  it("offers the back camera and the gallery", () => {
    const html = renderToStaticMarkup(
      createElement(
        I18nProvider,
        { locale: "en", messages: en } as Parameters<typeof I18nProvider>[0],
        createElement(AddPhotoTiles, { onFiles: () => {} }),
      ),
    );
    const inputs = html.match(/<input[^>]*>/g) ?? [];
    expect(inputs).toHaveLength(2);
    expect(inputs.filter((i) => i.includes('capture="environment"'))).toHaveLength(1);
    expect(inputs.find((i) => i.includes("multiple"))).not.toContain("capture");
    expect(html).toContain(en.capture.takePhoto);
    expect(html).toContain(en.capture.addPhoto);
  });
});
