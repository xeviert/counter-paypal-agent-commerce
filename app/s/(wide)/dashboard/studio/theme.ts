import { studioTheme } from "ag-studio";

// AG Studio in Counter's look: every value points at a token in app/globals.css, so Studio's
// canvas, widgets, grids and charts follow the maker app (white cards, 1px borders, neutral ink,
// the validated chart palette).

const token = (name: string) => `var(--${name})`;
const line = (name: string) => ({ width: 1, color: token(name) });

const palette = Object.fromEntries(
  Array.from({ length: 6 }, (_, i) => [
    [`chartPaletteFills${i + 1}Color`, token(`chart-${i + 1}`)],
    [`chartPaletteStrokes${i + 1}Color`, token(`chart-${i + 1}`)],
  ]).flat(),
);

export const counterStudioTheme = studioTheme.withParams({
  fontFamily: token("font-sans"),
  fontSize: 14,
  textColor: token("foreground"),
  foregroundColor: token("foreground"),
  subtleTextColor: token("muted-foreground"),
  backgroundColor: token("card"),
  borderColor: token("border"),
  accentColor: token("chart-1"),
  rowHoverColor: token("muted"),

  studioWrapperBorder: false,
  studioWrapperBorderRadius: 0,
  studioWrapperSpacing: 0,
  studioWrapperBackgroundColor: token("muted"),
  studioCanvasBorder: false,
  studioCanvasBorderRadius: 0,
  studioCanvasShadow: false,
  studioCanvasBackgroundColor: token("muted"),
  studioCanvasPadding: 12,
  studioCanvasRowHeight: 18,
  studioCanvasFontFamily: token("font-sans"),

  studioWidgetBackgroundColor: token("card"),
  studioWidgetBorder: line("border"),
  studioWidgetBorderRadius: 10,
  studioWidgetPadding: 12,
  studioWidgetTitleFontFamily: token("font-sans"),
  studioWidgetTitleFontSize: 15,
  studioWidgetTitleFontWeight: 600,
  studioWidgetTitleTextColor: token("foreground"),
  studioWidgetSubtitleFontSize: 13,
  studioWidgetSubtitleTextColor: token("muted-foreground"),
  studioWidgetCaptionFontSize: 13,
  studioWidgetCaptionTextColor: token("muted-foreground"),
  studioWidgetResizeBorderColor: token("chart-1"),

  studioPanelContainerBackgroundColor: token("card"),
  studioPanelContainerBorder: line("border"),
  studioPanelContainerBorderRadius: 0,
  studioPanelDividerColor: token("border"),
  studioPanelDividerActiveColor: token("chart-1"),
  studioPanelSectionBorderColor: token("border"),
  studioPanelHeaderFontFamily: token("font-sans"),
  studioPanelHeaderFontWeight: 600,

  gridFontFamily: token("font-sans"),
  gridFontSize: 14,
  gridCellTextColor: token("foreground"),
  gridHeaderBackgroundColor: token("card"),
  gridHeaderTextColor: token("muted-foreground"),
  gridHeaderFontWeight: 600,
  gridHeaderFontSize: 13,
  gridRowHeight: 40,
  gridRowBorder: line("border"),
  gridHeaderRowBorder: line("border"),
  gridRowHoverColor: token("muted"),
  gridWrapperBorder: false,

  chartFontFamily: token("font-sans"),
  chartTextColor: token("foreground"),
  chartSubtleTextColor: token("muted-foreground"),
  chartAxisLineColor: token("border"),
  chartGridLineColor: token("border"),
  ...palette,
});

// Studio seeds its edit-mode layout form from these and its color picker can't parse oklch() or
// var(), so they are the hex values of --muted, --card and --border.
export const counterStudioLayout = {
  backgroundColor: "#f5f5f5",
  widgetBackgroundColor: "#ffffff",
  widgetBorderEnabled: true,
  widgetBorderWidth: 1,
  widgetBorderColor: "#e5e5e5",
};
