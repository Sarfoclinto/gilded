import { useMemo, useState } from "react";
import { useSearchParams } from "react-router-dom";
import { useQueryClient } from "@tanstack/react-query";
import { Tabs } from "antd";
import { Receipt } from "@/features/receipt/Receipt";
import { buildReceiptSettings } from "@/features/receipt/settings";
import { useApiMutation } from "@/shared/api/hooks";
import { useConnectivity } from "@/shared/offline/connectivity";
import { Button } from "@/shared/ui/Button";
import { Card } from "@/shared/ui/Card";
import { PageHeader } from "@/shared/ui/PageHeader";
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

/**
 * The company's settings, one tab per group. Nothing is saved until Save; the tabs with unsaved changes carry a dot.
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
    <div className="mx-auto max-w-6xl space-y-4 p-3 pb-8 sm:p-4 lg:p-6">
      <PageHeader
        title="Company settings"
        subtitle="How this company works. Changes apply to everyone, on every device, the next time they are online."
      />

      <Tabs
        activeKey={tab}
        onChange={(key) => setSp({ tab: key }, { replace: true })}
        items={SECTIONS.map((s) => ({
          key: s.key,
          label: (
            <span className="inline-flex items-center gap-1.5">
              {s.title}
              {dirty.has(s.key) ? (
                <span
                  aria-label="Unsaved changes"
                  className="size-2 rounded-full bg-amber-500"
                />
              ) : null}
            </span>
          ),
          children: (
            <div
              className={
                s.preview ? "grid gap-4 lg:grid-cols-[minmax(0,1fr)_360px]" : ""
              }
            >
              <Card>
                <p className="mb-1 text-sm text-muted-foreground">{s.blurb}</p>
                {s.fields.map((f) => (
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
              </Card>
              {s.preview ? (
                <div className="rounded-xl bg-muted/60 p-3">
                  <p className="mb-2 text-center text-xs font-medium uppercase tracking-widest text-muted-foreground">
                    Sample receipt
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
                </div>
              ) : null}
            </div>
          ),
        }))}
      />

      {count > 0 ? (
        <div className="sticky bottom-20 z-20 mr-16 rounded-xl border border-border bg-card p-3 shadow-lg md:bottom-4">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <p className="text-sm">
              <strong>{count}</strong> unsaved change{count > 1 ? "s" : ""}
              {!online ? (
                <span className="ml-2 text-amber-700 dark:text-amber-300">
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
