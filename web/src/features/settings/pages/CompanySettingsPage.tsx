import { useMemo, useState } from "react";
import { useSearchParams } from "react-router-dom";
import { useQueryClient } from "@tanstack/react-query";
import {
  BanknoteIcon,
  BuildingIcon,
  CameraIcon,
  LineChartIcon,
  PrinterIcon,
  ReceiptIcon,
  SettingsIcon,
  WalletIcon,
  WifiOffIcon,
  UsersIcon,
  ImagesIcon,
  LockKeyholeIcon,
  SigmaIcon,
  type LucideIcon,
} from "lucide-react";
import { Receipt } from "@/features/receipt/Receipt";
import { buildReceiptSettings } from "@/features/receipt/settings";
import { useApiMutation } from "@/shared/api/hooks";
import { useConnectivity } from "@/shared/offline/connectivity";
import { CoinEdge } from "@/shared/ui/BrandMark";
import { Button } from "@/shared/ui/Button";
import { settingsApi, settingsKeys, useSettings, type Settings } from "../api";
import { FieldRow } from "../FieldRow";
import {
  changes,
  dirtySections,
  SECTIONS,
  valueOf,
  type Draft,
} from "../model";
import { usePersonalSettings } from "../personal";
import { SAMPLE_PURCHASE } from "../sample";

/** An icon for each group; a group added later without one still works and gets the plain cog. */
const ICONS: Record<string, LucideIcon> = {
  offline: WifiOffIcon,
  payout: BanknoteIcon,
  receipts: PrinterIcon,
  business: BuildingIcon,
  cash: WalletIcon,
  photos: CameraIcon,
  market: LineChartIcon,
  customers: UsersIcon,
  personal: ImagesIcon,
  workings: SigmaIcon,
  security: LockKeyholeIcon,
};
const iconOf = (key: string): LucideIcon =>
  ICONS[key] ?? (key.startsWith("receipt") ? ReceiptIcon : SettingsIcon);

/**
 * The company's settings, one group at a time. Nothing is saved until Save; groups with unsaved changes carry a dot.
 * The groups and fields come from SECTIONS (../model.ts), so a new setting is added there, not here.
 */
export default function CompanySettingsPage() {
  const qc = useQueryClient();
  const saved = useSettings();
  const mine = usePersonalSettings();
  const online = useConnectivity((s) => s.online);
  const [sp, setSp] = useSearchParams();
  const [draft, setDraft] = useState<Draft>({});
  const tab = SECTIONS.some((s) => s.key === sp.get("tab"))
    ? (sp.get("tab") as string)
    : SECTIONS[0]!.key;
  const section = SECTIONS.find((s) => s.key === tab)!;
  const Icon = iconOf(section.key);

  const changed = useMemo(() => changes(saved, draft), [saved, draft]);
  const dirty = useMemo(() => dirtySections(saved, draft), [saved, draft]);
  const count = Object.keys(changed).length;
  const merged = { ...saved, ...draft } as Settings;
  const sample = useMemo(
    () => buildReceiptSettings(merged, mine),
    [merged, mine],
  );

  const save = useApiMutation({
    mutationFn: () => settingsApi.update(changed),
    onSuccess: (next) => {
      qc.setQueryData(settingsKeys.all, next);
      setDraft({});
    },
    successMessage: "Settings saved",
  });

  const set = (key: keyof Settings, v: unknown, confirmOn?: string) => {
    if (confirmOn && v === true && !window.confirm(confirmOn)) return;
    setDraft((d) => ({ ...d, [key]: v }) as Draft);
  };

  return (
    <div className="mx-auto max-w-6xl space-y-5 p-3 pb-28 sm:p-4 lg:p-6">
      <header className="relative isolate overflow-hidden rounded-2xl bg-navy p-5 text-white sm:p-7">
        <div
          aria-hidden
          className="pointer-events-none absolute inset-0 -z-10 bg-[radial-gradient(60%_90%_at_90%_10%,rgba(201,168,76,0.2),transparent_70%)]"
        />
        <CoinEdge className="pointer-events-none absolute -right-14 -top-16 -z-10 size-56 text-gold/35 sm:size-72" />
        <h1 className="font-display text-2xl font-semibold sm:text-3xl">
          Company settings
        </h1>
        <p className="mt-1 max-w-xl text-sm text-white/70">
          How this company works. Changes apply to everyone, on every device,
          the next time they are online.
        </p>
      </header>

      <div className="lg:grid lg:grid-cols-[13rem_minmax(0,1fr)] lg:items-start lg:gap-6">
        <nav
          aria-label="Groups of settings"
          className="-mx-3 mb-4 flex gap-2 overflow-x-auto px-3 pb-1 [scrollbar-width:none] lg:sticky lg:top-4 lg:mx-0 lg:mb-0 lg:flex-col lg:gap-0.5 lg:overflow-visible lg:px-0 lg:pb-0"
        >
          {SECTIONS.map((s) => {
            const NavIcon = iconOf(s.key);
            const on = s.key === tab;
            return (
              <button
                key={s.key}
                type="button"
                onClick={() => setSp({ tab: s.key }, { replace: true })}
                aria-current={on ? "page" : undefined}
                className={`relative inline-flex min-h-10 shrink-0 items-center gap-2 rounded-full border px-3.5 text-sm font-medium transition-colors lg:rounded-lg lg:border-0 lg:px-3 ${on ? "border-navy bg-navy text-white lg:bg-gold/15 lg:text-navy" : "border-border bg-card text-foreground/80 hover:bg-muted lg:bg-transparent"}`}
              >
                <NavIcon
                  className={`size-4 ${on ? "lg:text-brand" : ""}`}
                  aria-hidden
                />
                {s.title}
                {dirty.has(s.key) ? (
                  <span
                    role="img"
                    aria-label="Unsaved changes"
                    className="size-2 rounded-full bg-amber-500 lg:ml-auto"
                  />
                ) : null}
              </button>
            );
          })}
        </nav>

        <div
          key={section.key}
          className={
            section.preview
              ? "grid gap-5 xl:grid-cols-[minmax(0,1fr)_21rem]"
              : ""
          }
        >
          <section
            aria-labelledby="group-h"
            className="min-w-0 self-start overflow-hidden rounded-2xl border border-border bg-card shadow-[0_1px_2px_rgba(13,27,46,0.04)]"
          >
            <header className="flex items-center gap-3 border-b border-border px-4 py-3.5 sm:px-5">
              <span
                aria-hidden
                className="grid size-10 shrink-0 place-items-center rounded-xl bg-gold/15 text-brand"
              >
                <Icon className="size-5" />
              </span>
              <div className="min-w-0">
                <h2
                  id="group-h"
                  className="text-base font-semibold leading-tight"
                >
                  {section.title}
                </h2>
                <p className="text-sm text-muted-foreground">{section.blurb}</p>
              </div>
            </header>
            <div className="divide-y divide-border">
              {section.fields.map((f) => (
                <FieldRow
                  key={f.key}
                  field={f}
                  value={valueOf(saved, draft, f.key)}
                  disabled={
                    f.needs ? valueOf(saved, draft, f.needs) !== true : false
                  }
                  onChange={(v) => set(f.key, v, f.confirmOn)}
                />
              ))}
            </div>
          </section>

          {section.preview ? (
            <aside
              aria-label="Sample receipt"
              className="self-start rounded-2xl border border-border bg-muted/60 p-3 xl:sticky xl:top-4"
            >
              <p className="mb-2 text-center text-sm font-medium text-muted-foreground">
                How a receipt will look
              </p>
              <div className="max-h-[70vh] overflow-auto">
                <div className="mx-auto w-fit shadow-lg">
                  <Receipt
                    t={SAMPLE_PURCHASE}
                    settings={sample}
                    branchName="Takoradi"
                  />
                </div>
              </div>
            </aside>
          ) : null}
        </div>
      </div>

      {count > 0 ? (
        <div
          role="region"
          aria-label="Unsaved changes"
          className="fixed inset-x-3 bottom-20 z-20 mx-auto max-w-2xl rounded-2xl border border-border bg-card/95 p-3 shadow-[0_12px_40px_-8px_rgba(13,27,46,0.35)] backdrop-blur sm:p-4 md:bottom-4 lg:left-[calc(50%+7rem)]"
        >
          <div className="flex flex-wrap items-center justify-between gap-3">
            <p className="flex items-center gap-2 text-sm">
              <span aria-hidden className="size-2 rounded-full bg-amber-500" />
              <span>
                <strong>{count}</strong> unsaved change{count > 1 ? "s" : ""}
              </span>
              {!online ? (
                <span className="font-medium text-amber-800">
                  Offline: connect to save.
                </span>
              ) : null}
            </p>
            <div className="flex gap-2">
              <Button
                variant="secondary"
                onClick={() => setDraft({})}
                disabled={save.isPending}
              >
                Discard
              </Button>
              <Button
                onClick={() => save.mutate()}
                loading={save.isPending}
                disabled={!online}
              >
                Save changes
              </Button>
            </div>
          </div>
        </div>
      ) : null}
    </div>
  );
}
