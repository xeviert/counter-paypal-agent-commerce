"use client";

import { createAiHarness, AgStudioAiModule, enableStudioDevValidations, type AgReportState, type AgStudioApi } from "ag-studio";
import { AG_STUDIO_LOCALE_ES } from "ag-studio-locale";
import { AgStudio, AgStudioProvider } from "ag-studio-react";
import { RefreshCwIcon, RotateCcwIcon, SparklesIcon } from "lucide-react";
import { useRouter } from "next/navigation";
import { useEffect, useMemo, useRef, useState, useTransition } from "react";
import { useI18n } from "@/components/i18n";
import { Button } from "@/components/ui/button";
import { Dialog, DialogClose, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { DASHBOARD_DAYS } from "@/lib/schemas/dashboard";
import type { DashboardDataset } from "@/lib/schemas/dashboard";
import { resetReport, saveReport } from "./actions";
import { claudeAdapter } from "./studio/adapter";
import { counterWidgets } from "./studio/payout-timeline";
import { buildStudioData } from "./studio/data";
import { defaultReport, pageTitle } from "./studio/report";
import { counterStudioLayout, counterStudioTheme } from "./studio/theme";

// The AG Studio instance (BUILDOUT §7.3). Loaded only in the browser (./dashboard.tsx). View mode
// shows the maker's report; edit mode adds Studio's panels, including its AI chat, whose agents run
// on Claude through ./studio/adapter.ts. Every change is saved for the maker, debounced.

if (process.env.NODE_ENV !== "production") enableStudioDevValidations();

const SAVE_DELAY_MS = 1_000;

type SaveStatus = "idle" | "saving" | "saved" | "failed";

export default function Studio({
  dataset,
  saved,
  licenseKey,
}: {
  dataset: DashboardDataset;
  saved: AgReportState | null;
  licenseKey?: string;
}) {
  const { t, locale } = useI18n();
  const router = useRouter();
  const apiRef = useRef<AgStudioApi | null>(null);
  const saveTimer = useRef<ReturnType<typeof setTimeout>>(undefined);
  const recovered = useRef(false);
  const [mode, setMode] = useState<"view" | "edit">("view");
  const [state, setState] = useState<AgReportState | null>(null);
  const [status, setStatus] = useState<SaveStatus>("idle");
  const [failed, setFailed] = useState(false);
  const [resetOpen, setResetOpen] = useState(false);
  const [refreshing, startRefresh] = useTransition();

  const data = useMemo(() => buildStudioData(dataset, t, locale), [dataset, t, locale]);
  // Studio rebuilds its widget registry whenever this changes identity.
  const widgets = useMemo(() => counterWidgets({ t, locale, today: dataset.to }), [t, locale, dataset.to]);
  // Read once, when Studio is created.
  const [initialState] = useState(() => saved ?? defaultReport(t));
  const [ai] = useState(() => {
    const adapter = claudeAdapter();
    const promptStarters = (["payday", "country", "week", "questions"] as const).map((k) => ({
      label: t(`dashboard.ai.starters.${k}.label`),
      prompt: t(`dashboard.ai.starters.${k}.prompt`),
    }));
    return ({ api }: { api: AgStudioApi }) => createAiHarness(api, { adapter, promptStarters });
  });

  useEffect(() => () => clearTimeout(saveTimer.current), []);

  const scheduleSave = (next: AgReportState) => {
    clearTimeout(saveTimer.current);
    saveTimer.current = setTimeout(() => {
      setStatus("saving");
      void saveReport(next)
        .catch(() => false)
        .then((ok) => setStatus(ok ? "saved" : "failed"));
    }, SAVE_DELAY_MS);
  };

  const showPage = (pageId: string) => {
    const api = apiRef.current;
    if (api) api.setState({ ...api.getState(), selectedPageId: pageId });
  };

  const reset = async () => {
    setResetOpen(false);
    clearTimeout(saveTimer.current);
    await resetReport();
    const api = apiRef.current;
    if (!api) return;
    api.setState(defaultReport(t));
    api.clearHistory();
    setStatus("idle");
  };

  if (failed) return <p className="p-6 text-sm text-destructive">{t("dashboard.error")}</p>;

  return (
    <div className="flex flex-1 flex-col">
      <div className="flex flex-wrap items-center gap-2 border-b px-4 py-2">
        <h1 className="mr-2 font-heading text-lg font-semibold">{t("dashboard.title")}</h1>
        <nav className="flex gap-1" aria-label={t("dashboard.title")}>
          {(state?.pages ?? initialState.pages).map((page, i) => {
            const selected = page.id === (state ?? initialState).selectedPageId;
            return (
              <Button
                key={page.id}
                size="sm"
                variant={selected ? "secondary" : "ghost"}
                aria-current={selected ? "page" : undefined}
                onClick={() => showPage(page.id)}
              >
                {pageTitle(page.id, i, t)}
              </Button>
            );
          })}
        </nav>
        <span className="text-xs text-muted-foreground">{t("dashboard.range", { days: DASHBOARD_DAYS })}</span>
        <span className="ml-auto text-xs text-muted-foreground" role="status" aria-live="polite">
          {status === "saving" && t("dashboard.saving")}
          {status === "saved" && t("dashboard.saved")}
          {status === "failed" && <span className="text-destructive">{t("dashboard.saveFailed")}</span>}
        </span>
        <Button size="sm" variant="ghost" disabled={refreshing} onClick={() => startRefresh(() => router.refresh())}>
          <RefreshCwIcon className={refreshing ? "animate-spin" : undefined} aria-hidden />
          {t("dashboard.refresh")}
        </Button>
        <Button size="sm" variant="ghost" onClick={() => setResetOpen(true)}>
          <RotateCcwIcon aria-hidden />
          {t("dashboard.reset")}
        </Button>
        <Button size="sm" variant={mode === "edit" ? "default" : "outline"} onClick={() => setMode(mode === "edit" ? "view" : "edit")}>
          <SparklesIcon aria-hidden />
          {mode === "edit" ? t("dashboard.done") : t("dashboard.edit")}
        </Button>
      </div>
      <p className="px-4 py-2 text-xs text-muted-foreground md:hidden">{t("dashboard.phoneHint")}</p>

      <div className="relative min-h-[640px] flex-1">
        <AgStudioProvider licenseKey={licenseKey} modules={[AgStudioAiModule]}>
          <AgStudio
            style={{ position: "absolute", inset: 0 }}
            theme={counterStudioTheme}
            layout={counterStudioLayout}
            data={data}
            widgets={widgets}
            ai={ai}
            initialState={initialState}
            mode={mode}
            panels={{ edit: { right: ["ai", "edit", "data"] } }}
            localeText={locale === "es" ? AG_STUDIO_LOCALE_ES : undefined}
            onApiReady={(e) => {
              apiRef.current = e.api;
            }}
            onStudioReady={(e) => setState(e.api.getState())}
            onStateUpdated={(e) => {
              setState(e.state);
              scheduleSave(e.state);
            }}
            onErrorRaised={(e) => {
              // eslint-disable-next-line no-console -- Studio's own validation details, for debugging
              console.error("[AG Studio]", e.errorType, e.errorDetails);
              if (!e.fatal) return;
              // A saved report Studio can't show: start over from the default once, not a blank page.
              if (saved && !recovered.current) {
                recovered.current = true;
                clearTimeout(saveTimer.current);
                void resetReport();
                apiRef.current?.setState(defaultReport(t));
              } else setFailed(true);
            }}
          />
        </AgStudioProvider>
      </div>

      <Dialog open={resetOpen} onOpenChange={setResetOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{t("dashboard.reset")}</DialogTitle>
            <DialogDescription>{t("dashboard.resetConfirm")}</DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <DialogClose render={<Button variant="outline" />}>{t("common.cancel")}</DialogClose>
            <Button variant="destructive" onClick={() => void reset()}>
              {t("dashboard.reset")}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
