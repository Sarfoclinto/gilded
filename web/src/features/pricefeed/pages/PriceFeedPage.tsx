import { useEffect, useMemo, useState } from "react";
import {
  Alert,
  Checkbox,
  InputNumber,
  Modal,
  Radio,
  Switch,
  Table,
  Tag,
} from "antd";
import { MinusCircleIcon, PlusIcon } from "lucide-react";
import { cedis } from "@/features/calculator/format";
import { errorMessage } from "@/shared/api/errors";
import { Button } from "@/shared/ui/Button";
import { PageHeader } from "@/shared/ui/PageHeader";
import {
  useCheckNow,
  useDecideHeld,
  usePreviewFeed,
  usePriceFeed,
  useSaveFeed,
  type Feed,
  type FeedEvent,
  type FeedSettings,
  type FeedWindow,
  type Preview,
} from "../api";
import { DAYS, PRESETS, sameWindows, windowProblems } from "../presets";

const when = (iso?: string | null) =>
  iso
    ? new Date(iso).toLocaleString("en-GH", {
        day: "numeric",
        month: "short",
        hour: "2-digit",
        minute: "2-digit",
      })
    : "never";

const fromFeed = (f: Feed): FeedSettings => ({
  enabled: f.enabled,
  windows: f.windows,
  weekdays: f.weekdays,
  timezone: f.timezone,
  marginPolicy: f.marginPolicy,
  maxJumpPct: Number(f.maxJumpPct),
});

export default function PriceFeedPage() {
  const q = usePriceFeed();
  const save = useSaveFeed();
  const preview = usePreviewFeed();
  const check = useCheckNow();
  const decide = useDecideHeld();
  const [s, setS] = useState<FeedSettings | null>(null);
  const [seen, setSeen] = useState<Preview | null>(null);
  const [asking, setAsking] = useState<FeedEvent | null>(null);

  // The form starts from what is saved, and resets only when a save comes back.
  useEffect(() => {
    if (q.data && !s) setS(fromFeed(q.data));
  }, [q.data, s]);
  const saved = q.data ? fromFeed(q.data) : null;
  const dirty = !!s && !!saved && JSON.stringify(s) !== JSON.stringify(saved);
  const problems = useMemo(() => (s ? windowProblems(s.windows) : []), [s]);
  if (q.error)
    return (
      <div className="p-4">
        <Alert type="error" showIcon title={errorMessage(q.error)} />
      </div>
    );
  if (!q.data || !s)
    return <div className="p-4 text-sm text-muted-foreground">Loading…</div>;
  const feed = q.data;
  const set = (patch: Partial<FeedSettings>) => setS({ ...s, ...patch });
  const setWindow = (i: number, patch: Partial<FeedWindow>) =>
    set({
      windows: s.windows.map((w, j) => (j === i ? { ...w, ...patch } : w)),
    });
  const pending = feed.events.filter(
    (e) => e.kind === "held" && e.state === "pending",
  );

  return (
    <div className="mx-auto max-w-4xl space-y-4 p-4 pb-10">
      <PageHeader
        title="Automatic price"
        subtitle="Reads GoldBod's published price for you and sends each branch's margin to a manager to approve."
      />

      {pending.map((e) => (
        <Alert
          key={e.id}
          type="warning"
          showIcon
          title="A price is waiting for you"
          description={e.message}
          action={<Button onClick={() => setAsking(e)}>Review</Button>}
        />
      ))}

      <section className="rounded-xl border border-border bg-card p-4">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <div className="text-sm text-muted-foreground">Price in use</div>
            <div className="tnum text-2xl font-bold">
              {feed.latest ? cedis(feed.latest.basePrice) : "none yet"}
            </div>
            <div className="text-xs text-muted-foreground">
              {feed.latest
                ? `${feed.latest.source === "goldbod" ? "From GoldBod" : "Typed by hand"} · published ${when(feed.latest.publishedAt)}`
                : ""}
            </div>
          </div>
          <label className="flex items-center gap-2 text-sm font-medium">
            Look automatically{" "}
            <Switch checked={s.enabled} onChange={(v) => set({ enabled: v })} />
          </label>
        </div>
        <div className="mt-3 text-sm text-muted-foreground">
          Last look: {when(feed.lastCheckedAt)}
          {feed.lastResult ? ` · ${feed.lastResult}` : ""}
          {feed.updatedBy ? (
            <div>
              The automatic price is recorded under {feed.updatedBy.displayName}
              's name (the person who last saved these settings).
            </div>
          ) : null}
        </div>
      </section>

      <section className="space-y-3 rounded-xl border border-border bg-card p-4">
        <h2 className="font-semibold">When to look</h2>
        <div className="flex flex-wrap gap-2">
          {PRESETS.map((p) => (
            <Button
              key={p.key}
              variant={
                sameWindows(s.windows, p.windows) ? "primary" : "secondary"
              }
              onClick={() => set({ windows: p.windows })}
              title={p.help}
            >
              {p.label}
            </Button>
          ))}
        </div>
        <p className="text-sm text-muted-foreground">
          {PRESETS.find((p) => sameWindows(s.windows, p.windows))?.help ??
            "Your own times. Between a start and an end the system looks at the interval you choose, and stops as soon as the new price is found."}
        </p>
        <div className="space-y-2">
          {s.windows.map((w, i) => (
            <div key={i} className="flex flex-wrap items-center gap-2">
              <input
                type="time"
                aria-label="Start"
                className="min-h-10 rounded-lg border border-border bg-background px-2"
                value={w.start}
                onChange={(e) => setWindow(i, { start: e.target.value })}
              />
              <span className="text-sm">to</span>
              <input
                type="time"
                aria-label="End"
                className="min-h-10 rounded-lg border border-border bg-background px-2"
                value={w.end}
                onChange={(e) => setWindow(i, { end: e.target.value })}
              />
              <span className="text-sm">every</span>
              <InputNumber
                min={1}
                max={120}
                value={w.everyMinutes}
                onChange={(v) => setWindow(i, { everyMinutes: Number(v ?? 5) })}
                style={{ width: 80 }}
              />
              <span className="text-sm">minutes</span>
              <button
                type="button"
                aria-label="Remove this check time"
                className="text-muted-foreground hover:text-foreground"
                onClick={() =>
                  set({ windows: s.windows.filter((_, j) => j !== i) })
                }
              >
                <MinusCircleIcon className="size-5" />
              </button>
            </div>
          ))}
          {s.windows.length < 6 ? (
            <Button
              variant="ghost"
              onClick={() =>
                set({
                  windows: [
                    ...s.windows,
                    { start: "12:00", end: "13:00", everyMinutes: 10 },
                  ],
                })
              }
            >
              <PlusIcon className="size-4" /> Add a check time
            </Button>
          ) : null}
        </div>
        <div>
          <div className="mb-1 text-sm font-medium">On these days</div>
          <Checkbox.Group
            options={DAYS}
            value={s.weekdays}
            onChange={(v) => set({ weekdays: (v as number[]).sort() })}
          />
        </div>
        <p className="text-xs text-muted-foreground">
          Times are in {s.timezone}.
        </p>
        {problems.map((p) => (
          <Alert key={p} type="error" showIcon title={p} />
        ))}
      </section>

      <section className="space-y-3 rounded-xl border border-border bg-card p-4">
        <h2 className="font-semibold">What happens to each branch's margin</h2>
        <Radio.Group
          value={s.marginPolicy}
          onChange={(e) => set({ marginPolicy: e.target.value })}
          className="flex flex-col gap-2"
        >
          <Radio value="approve">
            Ask a manager to approve it again (recommended). Tellers keep buying
            at the carried-over margin until it is approved.
          </Radio>
          <Radio value="carry">
            Keep approved margins as they are. Only the base price changes.
          </Radio>
        </Radio.Group>
        <label className="flex flex-wrap items-center gap-2 text-sm">
          Hold a new price for your confirmation if it differs from the current
          one by more than
          <InputNumber
            min={1}
            max={50}
            value={s.maxJumpPct}
            onChange={(v) => set({ maxJumpPct: Number(v ?? 10) })}
            style={{ width: 80 }}
          />{" "}
          %
        </label>
        <p className="text-xs text-muted-foreground">
          A price is also held when the cedi figure on the page does not match
          its own LBMA price and exchange rate.
        </p>
      </section>

      <div className="flex flex-wrap gap-2">
        <Button
          loading={save.isPending}
          disabled={!dirty || problems.length > 0 || s.weekdays.length === 0}
          onClick={() =>
            save.mutate(s, { onSuccess: (f) => setS(fromFeed(f)) })
          }
        >
          Save
        </Button>
        {dirty ? (
          <Button variant="ghost" onClick={() => setS(fromFeed(feed))}>
            Undo changes
          </Button>
        ) : null}
        <Button
          variant="secondary"
          loading={preview.isPending}
          onClick={() => preview.mutate(undefined, { onSuccess: setSeen })}
        >
          See what the page says now
        </Button>
        <Button
          variant="secondary"
          loading={check.isPending}
          disabled={dirty || !feed.updatedBy}
          title={dirty ? "Save first" : undefined}
          onClick={() => check.mutate()}
        >
          Check and use it now
        </Button>
      </div>

      {seen ? (
        <Alert
          type={seen.found ? "info" : "error"}
          showIcon
          closable
          onClose={() => setSeen(null)}
          title={seen.message}
          description={
            seen.price ? (
              <div className="text-sm">
                <div>
                  LBMA price:{" "}
                  {seen.price.usdPerOunce
                    ? `USD ${seen.price.usdPerOunce.toLocaleString("en-GH")} per ounce`
                    : "not shown"}{" "}
                  · Rate: {seen.price.rate ?? "not shown"} · Discount:{" "}
                  {seen.price.discountPct ?? 0}%
                </div>
                <div>Published: {when(seen.price.publishedAt)}</div>
                {seen.price.expected ? (
                  <div>
                    Worked out from those figures: GH₵{" "}
                    {seen.price.expected.toLocaleString("en-GH")} (the page
                    shows GH₵ {seen.price.ghsPerPound.toLocaleString("en-GH")})
                  </div>
                ) : null}
                <div className="text-muted-foreground">
                  Nothing was saved. This only shows what would be read.
                </div>
              </div>
            ) : seen.excerpt ? (
              <div className="text-xs">What the page said: {seen.excerpt}</div>
            ) : null
          }
        />
      ) : null}

      <section className="space-y-2">
        <h2 className="font-semibold">Recent activity</h2>
        <Table<FeedEvent>
          rowKey="id"
          size="small"
          dataSource={feed.events}
          pagination={false}
          scroll={{ x: 560 }}
          locale={{ emptyText: "Nothing yet." }}
          columns={[
            {
              title: "When",
              width: 130,
              render: (_: unknown, e) => when(e.at),
            },
            {
              title: "",
              width: 110,
              render: (_: unknown, e) =>
                e.kind === "applied" ? (
                  <Tag color="green">Used</Tag>
                ) : e.kind === "held" ? (
                  <Tag
                    color={
                      e.state === "pending"
                        ? "orange"
                        : e.state === "accepted"
                          ? "green"
                          : "default"
                    }
                  >
                    {e.state === "pending"
                      ? "Waiting"
                      : e.state === "accepted"
                        ? "Accepted"
                        : "Dismissed"}
                  </Tag>
                ) : (
                  <Tag color="red">Could not read</Tag>
                ),
            },
            {
              title: "What happened",
              render: (_: unknown, e) => (
                <div>
                  <div>{e.message}</div>
                  {e.decidedBy ? (
                    <div className="text-xs text-muted-foreground">
                      {e.state === "accepted" ? "Accepted" : "Dismissed"} by{" "}
                      {e.decidedBy.displayName}
                    </div>
                  ) : null}
                </div>
              ),
            },
            {
              title: "Price",
              align: "right",
              render: (_: unknown, e) =>
                e.basePrice ? cedis(e.basePrice) : "",
            },
          ]}
        />
      </section>

      <Modal
        open={!!asking}
        title="Use this price?"
        onCancel={() => setAsking(null)}
        destroyOnHidden
        footer={
          <div className="flex justify-end gap-2">
            <Button
              variant="secondary"
              loading={decide.isPending}
              onClick={() =>
                asking &&
                decide.mutate(
                  { id: asking.id, accept: false },
                  { onSuccess: () => setAsking(null) },
                )
              }
            >
              Dismiss it
            </Button>
            <Button
              loading={decide.isPending}
              onClick={() =>
                asking &&
                decide.mutate(
                  { id: asking.id, accept: true },
                  { onSuccess: () => setAsking(null) },
                )
              }
            >
              Use this price
            </Button>
          </div>
        }
      >
        {asking ? (
          <div className="space-y-2 text-sm">
            <p>{asking.message}</p>
            <ul className="list-disc pl-5">
              <li>
                Price on the page:{" "}
                {asking.basePrice ? cedis(asking.basePrice) : "—"} per pound
              </li>
              {asking.usdPerOunce ? (
                <li>
                  LBMA price: USD {asking.usdPerOunce} per ounce, rate{" "}
                  {asking.rate ?? "—"}
                </li>
              ) : null}
              {asking.computed ? (
                <li>Worked out from those: {cedis(asking.computed)}</li>
              ) : null}
              <li>
                Current price:{" "}
                {feed.latest ? cedis(feed.latest.basePrice) : "none"}
              </li>
            </ul>
            <p className="text-muted-foreground">
              If you use it, branch margins follow the choice above. If you
              dismiss it, nothing changes; you can still type a price by hand on
              the Prices page.
            </p>
          </div>
        ) : null}
      </Modal>
    </div>
  );
}
