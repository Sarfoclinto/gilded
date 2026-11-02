import { useEffect, useMemo, useRef, useState } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import { Input, Modal, Radio, Segmented, Select, Switch } from "antd";
import { ArrowLeftIcon, MonitorIcon, SmartphoneIcon } from "lucide-react";
import paths from "@/config/paths";
import { Button } from "@/shared/ui/Button";
import { Card } from "@/shared/ui/Card";
import { toast } from "@/shared/ui/toast";
import { useArticle, useGuideAdmin, usePublish, useSaveArticle } from "../api";
import { BlockCard } from "../BlockEditor";
import { BlocksView } from "../BlockView";
import {
  BLOCK_TYPES,
  cleanBlocks,
  KINDS,
  kindLabel,
  newBlock,
  readMinutes,
  type Block,
  type BlockType,
} from "../blocks";

interface Draft {
  title: string;
  summary: string;
  kind: string;
  categoryId: string | null;
  mustRead: boolean;
  blocks: Block[];
}
const EMPTY: Draft = {
  title: "",
  summary: "",
  kind: "rule",
  categoryId: null,
  mustRead: true,
  blocks: [],
};

/** How the article will look to people. The same components the readers use draw it, so this is not an approximation. */
function Preview({
  draft,
  device,
}: {
  draft: Draft;
  device: "phone" | "computer";
}) {
  const blocks = useMemo(() => cleanBlocks(draft.blocks), [draft.blocks]);
  return (
    <div className="rounded-2xl border border-border bg-muted/40 p-3">
      <div
        className={`mx-auto overflow-hidden rounded-xl border border-border bg-background shadow-sm ${device === "phone" ? "max-w-[390px]" : "max-w-3xl"}`}
      >
        <div className="space-y-4 p-4">
          <div className="space-y-2">
            <div className="flex flex-wrap items-center gap-2 text-xs">
              <span className="rounded-full bg-muted px-2 py-0.5 font-medium">
                {kindLabel(draft.kind)}
              </span>
              <span className="text-muted-foreground">
                {readMinutes(blocks)} min read
              </span>
            </div>
            <h1 className="text-2xl font-bold tracking-tight">
              {draft.title.trim() || (
                <span className="text-muted-foreground">Your title</span>
              )}
            </h1>
            {draft.summary.trim() ? (
              <p className="text-muted-foreground">{draft.summary}</p>
            ) : null}
          </div>
          {blocks.length > 0 ? (
            <BlocksView blocks={blocks} />
          ) : (
            <p className="rounded-lg border border-dashed border-border p-6 text-center text-sm text-muted-foreground">
              Add a block and it appears here, just as people will see it.
            </p>
          )}
          <div className="rounded-xl border border-border p-3 text-sm text-muted-foreground">
            I have read and understood this
          </div>
        </div>
      </div>
    </div>
  );
}

export default function GuideEditorPage() {
  const { id } = useParams();
  const navigate = useNavigate();
  const q = useArticle(id, true);
  const admin = useGuideAdmin();
  const save = useSaveArticle();
  const publish = usePublish();
  const [draft, setDraft] = useState<Draft>(EMPTY);
  const [rev, setRev] = useState<number | undefined>(undefined);
  const [status, setStatus] = useState<"new" | "draft" | "published">("new");
  const [dirty, setDirty] = useState(false);
  const [view, setView] = useState<"write" | "preview">("write");
  const [device, setDevice] = useState<"phone" | "computer">("phone");
  const [pub, setPub] = useState<{
    open: boolean;
    notify: boolean;
    material: boolean;
  }>({ open: false, notify: true, material: false });
  const loaded = useRef(false);

  // Load an existing article once. A 404 means it is a new one (its id was made when "New article" was pressed).
  useEffect(() => {
    if (loaded.current || !q.data) return;
    loaded.current = true;
    const a = q.data;
    setDraft({
      title: a.title,
      summary: a.summary ?? "",
      kind: a.kind,
      categoryId: a.categoryId ?? null,
      mustRead: a.mustRead,
      blocks: a.blocks,
    });
    setRev(a.rev);
    setStatus(a.status);
  }, [q.data]);

  useEffect(() => {
    if (!dirty) return;
    const warn = (e: BeforeUnloadEvent) => {
      e.preventDefault();
    };
    window.addEventListener("beforeunload", warn);
    return () => window.removeEventListener("beforeunload", warn);
  }, [dirty]);

  const change = (p: Partial<Draft>) => {
    setDraft((d) => ({ ...d, ...p }));
    setDirty(true);
  };
  const setBlock = (i: number, b: Block) =>
    change({ blocks: draft.blocks.map((x, k) => (k === i ? b : x)) });
  const move = (i: number, d: -1 | 1) => {
    const next = [...draft.blocks];
    const j = i + d;
    if (j < 0 || j >= next.length) return;
    [next[i], next[j]] = [next[j]!, next[i]!];
    change({ blocks: next });
  };
  const add = (t: BlockType) =>
    change({ blocks: [...draft.blocks, newBlock(t)] });

  const titleOk = draft.title.trim().length >= 3;
  const ready = cleanBlocks(draft.blocks).length > 0;

  async function doSave(quiet = false) {
    if (!id || !titleOk) return null;
    try {
      const a = await save.mutateAsync({
        id,
        draft: {
          ...draft,
          title: draft.title.trim(),
          summary: draft.summary.trim(),
          blocks: cleanBlocks(draft.blocks),
          ...(rev !== undefined ? { rev } : {}),
        },
      });
      setRev(a.rev);
      setStatus(a.status);
      setDirty(false);
      if (!quiet)
        toast.success(
          a.status === "published"
            ? "Saved. People see the saved version now."
            : "Draft saved",
        );
      return a;
    } catch {
      return null;
    }
  }

  async function doPublish() {
    if (!id) return;
    const a = await doSave(true);
    if (!a) return;
    try {
      const r = await publish.mutateAsync({
        id,
        notify: pub.notify,
        material: status === "published" ? pub.material : false,
      });
      setPub((p) => ({ ...p, open: false }));
      toast.success(
        r.notified > 0
          ? `Published. ${r.notified} ${r.notified === 1 ? "person was" : "people were"} told.`
          : "Published",
      );
      navigate(paths.guide.manage.href);
    } catch {
      /* the error is shown by the request */
    }
  }

  const categories = admin.data?.categories ?? [];
  const missing = q.error && q.error.status !== 404;

  return (
    <div className="mx-auto max-w-7xl space-y-4 p-3 sm:p-4 lg:p-6">
      <div className="flex flex-wrap items-center gap-3">
        <Link
          to={paths.guide.manage.href}
          className="inline-flex min-h-10 items-center gap-1.5 text-sm text-muted-foreground hover:text-foreground"
        >
          <ArrowLeftIcon className="size-4" aria-hidden />
          Back
        </Link>
        <span
          className={`rounded-full px-2 py-0.5 text-xs font-semibold ${status === "published" ? "bg-emerald-500/15 text-emerald-800 dark:text-emerald-200" : "bg-muted text-muted-foreground"}`}
        >
          {status === "published"
            ? "Published"
            : status === "draft"
              ? "Draft"
              : "New"}
        </span>
        {dirty ? (
          <span className="text-xs text-amber-700 dark:text-amber-300">
            Unsaved changes
          </span>
        ) : null}
        <div className="ml-auto flex flex-wrap gap-2">
          <Button
            variant="secondary"
            onClick={() => void doSave()}
            disabled={!titleOk || !dirty}
            loading={save.isPending}
          >
            {status === "published" ? "Save changes" : "Save draft"}
          </Button>
          <Button
            onClick={() =>
              setPub((p) => ({
                ...p,
                open: true,
                notify: true,
                material: false,
              }))
            }
            disabled={!titleOk || !ready}
          >
            {status === "published" ? "Republish…" : "Publish…"}
          </Button>
        </div>
      </div>
      {missing ? (
        <Card>
          <p className="text-sm">
            This article could not be opened. It needs a connection.
          </p>
        </Card>
      ) : null}

      <div className="lg:hidden">
        <Segmented
          block
          value={view}
          onChange={(v) => setView(v as "write" | "preview")}
          options={[
            { value: "write", label: "Write" },
            { value: "preview", label: "Preview" },
          ]}
          aria-label="Write or preview"
        />
      </div>

      <div className="grid gap-6 lg:grid-cols-2 lg:items-start">
        <div
          className={`space-y-4 ${view === "preview" ? "hidden lg:block" : ""}`}
        >
          <Card className="space-y-3">
            <label className="block text-sm font-medium">
              Title
              <Input
                size="large"
                className="mt-1"
                maxLength={120}
                placeholder="e.g. Never share a customer’s details"
                value={draft.title}
                onChange={(e) => change({ title: e.target.value })}
              />
            </label>
            <label className="block text-sm font-medium">
              One line about it (optional)
              <Input
                className="mt-1"
                maxLength={240}
                placeholder="Shown in the list, under the title"
                value={draft.summary}
                onChange={(e) => change({ summary: e.target.value })}
              />
            </label>
            <div className="grid gap-3 sm:grid-cols-2">
              <label className="block text-sm font-medium">
                Kind
                <Select
                  className="mt-1 !block"
                  value={draft.kind}
                  onChange={(v) => change({ kind: v })}
                  options={KINDS.map((k) => ({
                    value: k.value,
                    label: k.label,
                  }))}
                />
              </label>
              <label className="block text-sm font-medium">
                Category
                <Select
                  className="mt-1 !block"
                  allowClear
                  placeholder="None"
                  value={draft.categoryId ?? undefined}
                  onChange={(v) => change({ categoryId: v ?? null })}
                  options={categories.map((c) => ({
                    value: c.id,
                    label: c.name,
                  }))}
                />
              </label>
            </div>
            <label className="flex min-h-10 items-center gap-3 text-sm">
              <Switch
                checked={draft.mustRead}
                onChange={(v) => change({ mustRead: v })}
                aria-label="Everyone must read this"
              />
              <span>
                Everyone must read this{" "}
                <span className="text-muted-foreground">
                  (it counts as unread until they confirm)
                </span>
              </span>
            </label>
          </Card>

          {draft.blocks.map((b, i) => (
            <BlockCard
              key={i}
              block={b}
              index={i}
              count={draft.blocks.length}
              onChange={(nb) => setBlock(i, nb)}
              onMove={(d) => move(i, d)}
              onRemove={() =>
                change({ blocks: draft.blocks.filter((_, k) => k !== i) })
              }
            />
          ))}

          <Card className="space-y-2">
            <p className="text-sm font-semibold">Add to the article</p>
            <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
              {BLOCK_TYPES.map((t) => (
                <button
                  key={t.type}
                  type="button"
                  onClick={() => add(t.type)}
                  className="min-h-14 rounded-lg border border-border bg-card px-3 py-2 text-left hover:bg-muted"
                >
                  <span className="block text-sm font-medium">{t.label}</span>
                  <span className="block text-xs text-muted-foreground">
                    {t.hint}
                  </span>
                </button>
              ))}
            </div>
          </Card>
        </div>

        <div
          className={`space-y-3 lg:sticky lg:top-4 ${view === "write" ? "hidden lg:block" : ""}`}
        >
          <div className="flex items-center justify-between gap-2">
            <h2 className="text-sm font-semibold">How people will see it</h2>
            <Segmented
              value={device}
              onChange={(v) => setDevice(v as "phone" | "computer")}
              options={[
                {
                  value: "phone",
                  label: (
                    <span className="inline-flex items-center gap-1">
                      <SmartphoneIcon className="size-4" aria-hidden />
                      Phone
                    </span>
                  ),
                },
                {
                  value: "computer",
                  label: (
                    <span className="inline-flex items-center gap-1">
                      <MonitorIcon className="size-4" aria-hidden />
                      Computer
                    </span>
                  ),
                },
              ]}
              aria-label="Preview size"
            />
          </div>
          <div className="max-h-[calc(100vh-8rem)] overflow-y-auto">
            <Preview draft={draft} device={device} />
          </div>
        </div>
      </div>

      <Modal
        open={pub.open}
        title={
          status === "published"
            ? "Republish this article"
            : "Publish this article"
        }
        okText={status === "published" ? "Republish" : "Publish"}
        confirmLoading={save.isPending || publish.isPending}
        onCancel={() => setPub((p) => ({ ...p, open: false }))}
        onOk={() => void doPublish()}
        destroyOnHidden
      >
        {status === "published" ? (
          <div className="space-y-3">
            <p className="text-sm">What kind of change is this?</p>
            <Radio.Group
              value={pub.material ? "big" : "small"}
              onChange={(e) =>
                setPub((p) => ({
                  ...p,
                  material: e.target.value === "big",
                  notify: e.target.value === "big",
                }))
              }
              className="!flex flex-col gap-2"
            >
              <Radio value="small">
                A small fix (spelling, wording). People are not asked to read it
                again.
              </Radio>
              <Radio value="big">
                The rule changed. Everyone is told and must read it again.
              </Radio>
            </Radio.Group>
          </div>
        ) : (
          <div className="space-y-3">
            <p className="text-sm">Everyone will be able to read it.</p>
            <label className="flex items-center gap-3 text-sm">
              <Switch
                checked={pub.notify}
                onChange={(v) => setPub((p) => ({ ...p, notify: v }))}
                aria-label="Tell everyone"
              />
              Send everyone a notification
            </label>
          </div>
        )}
      </Modal>
    </div>
  );
}
