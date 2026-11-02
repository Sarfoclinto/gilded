import { useEffect, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { Input, Modal, Popconfirm, Progress, Segmented, Select } from "antd";
import {
  BellRingIcon,
  FolderPlusIcon,
  PencilIcon,
  PlusIcon,
  UsersIcon,
} from "lucide-react";
import paths from "@/config/paths";
import { Button } from "@/shared/ui/Button";
import { Card } from "@/shared/ui/Card";
import { PageHeader } from "@/shared/ui/PageHeader";
import { toast } from "@/shared/ui/toast";
import {
  useDeleteArticle,
  useDeleteCategory,
  useGuideAdmin,
  useReaders,
  useSaveCategory,
  useSaveReminders,
  useUnpublish,
  type ArticleRow,
  type Reminders,
} from "../api";
import { kindLabel } from "../blocks";

const DAYS = [
  "Monday",
  "Tuesday",
  "Wednesday",
  "Thursday",
  "Friday",
  "Saturday",
  "Sunday",
];
const when = (iso: string) =>
  new Date(iso).toLocaleString("en-GB", {
    day: "numeric",
    month: "short",
    hour: "2-digit",
    minute: "2-digit",
  });

function ReadersModal({
  article,
  staff,
  onClose,
}: {
  article: ArticleRow | null;
  staff: number;
  onClose: () => void;
}) {
  const q = useReaders(article?.id ?? null);
  const list = q.data ?? [];
  const done = list.filter((r) => r.read).length;
  return (
    <Modal
      open={!!article}
      onCancel={onClose}
      footer={null}
      title={article ? `Who has read “${article.title}”` : ""}
      destroyOnHidden
    >
      {q.isLoading ? (
        <p className="text-sm text-muted-foreground">Loading…</p>
      ) : null}
      {list.length > 0 ? (
        <>
          <Progress
            percent={Math.round((done / Math.max(1, list.length)) * 100)}
            format={() => `${done} of ${list.length}`}
          />
          <ul className="mt-3 divide-y divide-border">
            {list.map((r) => (
              <li
                key={r.userId}
                className="flex items-center justify-between gap-3 py-2 text-sm"
              >
                <span>{r.displayName}</span>
                {r.read ? (
                  <span className="text-emerald-700 dark:text-emerald-300">
                    Read{r.readAt ? ` · ${when(r.readAt)}` : ""}
                  </span>
                ) : (
                  <span className="font-medium text-amber-700 dark:text-amber-300">
                    {r.readVersion ? "Not yet (updated)" : "Not yet"}
                  </span>
                )}
              </li>
            ))}
          </ul>
        </>
      ) : null}
      {!q.isLoading && list.length === 0 ? (
        <p className="text-sm text-muted-foreground">
          {staff === 0 ? "No one to show." : "Nothing to show yet."}
        </p>
      ) : null}
    </Modal>
  );
}

function RemindersCard({ value }: { value: Reminders }) {
  const save = useSaveReminders();
  const [draft, setDraft] = useState<Reminders>(value);
  useEffect(() => setDraft(value), [value]);
  const dirty = JSON.stringify(draft) !== JSON.stringify(value);
  return (
    <Card className="space-y-4">
      <div className="flex items-center gap-2">
        <BellRingIcon className="size-5 text-gold" aria-hidden />
        <h2 className="text-base font-semibold">Reminders to read</h2>
      </div>
      <p className="text-sm text-muted-foreground">
        A notification asking people to go and read the guide, at the time you
        choose in your company’s own time.
      </p>
      <div className="space-y-3">
        <div>
          <p className="mb-1 text-sm font-medium">How often</p>
          <Segmented
            value={draft.frequency}
            onChange={(v) =>
              setDraft({ ...draft, frequency: v as Reminders["frequency"] })
            }
            options={[
              { value: "off", label: "Off" },
              { value: "daily", label: "Every day" },
              { value: "weekly", label: "Every week" },
              { value: "monthly", label: "Monthly" },
            ]}
            aria-label="How often"
          />
        </div>
        {draft.frequency !== "off" ? (
          <>
            <div className="flex flex-wrap items-end gap-3">
              <label className="text-sm font-medium">
                At
                <Input
                  type="time"
                  className="mt-1 block !w-32"
                  value={draft.time}
                  onChange={(e) => setDraft({ ...draft, time: e.target.value })}
                />
              </label>
              {draft.frequency === "weekly" ? (
                <label className="text-sm font-medium">
                  On
                  <Select
                    className="mt-1 !block !w-40"
                    value={draft.weekday}
                    onChange={(v) => setDraft({ ...draft, weekday: v })}
                    options={DAYS.map((d, i) => ({ value: i + 1, label: d }))}
                  />
                </label>
              ) : null}
              {draft.frequency === "monthly" ? (
                <p className="pb-1 text-sm text-muted-foreground">
                  On the 1st of each month.
                </p>
              ) : null}
            </div>
            <div>
              <p className="mb-1 text-sm font-medium">Who is reminded</p>
              <Segmented
                value={draft.audience}
                onChange={(v) =>
                  setDraft({ ...draft, audience: v as Reminders["audience"] })
                }
                options={[
                  { value: "unread", label: "Only those with unread" },
                  { value: "everyone", label: "Everyone" },
                ]}
                aria-label="Who is reminded"
              />
            </div>
          </>
        ) : null}
      </div>
      <Button
        onClick={() =>
          save.mutate(draft, {
            onSuccess: () => toast.success("Reminders saved"),
          })
        }
        disabled={!dirty || !/^\d\d:\d\d$/.test(draft.time)}
        loading={save.isPending}
      >
        Save reminders
      </Button>
    </Card>
  );
}

/** The director's side: every article, who has read it, categories, and reminders. */
export default function GuideManagePage() {
  const navigate = useNavigate();
  const q = useGuideAdmin();
  const unpublish = useUnpublish();
  const del = useDeleteArticle();
  const saveCat = useSaveCategory();
  const delCat = useDeleteCategory();
  const [readers, setReaders] = useState<ArticleRow | null>(null);
  const [catModal, setCatModal] = useState<{ id: string; name: string } | null>(
    null,
  );
  const data = q.data;

  const groups = [
    ...(data?.categories ?? []).map((c) => ({
      id: c.id,
      name: c.name,
      articles: (data?.articles ?? []).filter((a) => a.categoryId === c.id),
      real: true,
    })),
    {
      id: "none",
      name: "No category",
      articles: (data?.articles ?? []).filter((a) => !a.categoryId),
      real: false,
    },
  ].filter((g) => g.real || g.articles.length > 0);

  return (
    <div className="mx-auto max-w-5xl space-y-4 p-3 sm:p-4 lg:p-6">
      <PageHeader
        title="Write the guide"
        subtitle="The rules, dos and don’ts and how-tos everyone reads. Nothing reaches your team until you publish it."
        actions={
          <div className="flex flex-wrap gap-2">
            <Button
              variant="secondary"
              onClick={() => setCatModal({ id: crypto.randomUUID(), name: "" })}
            >
              <FolderPlusIcon className="mr-1.5 size-4" aria-hidden />
              New category
            </Button>
            <Button
              onClick={() => navigate(paths.guide.edit.to(crypto.randomUUID()))}
            >
              <PlusIcon className="mr-1.5 size-4" aria-hidden />
              New article
            </Button>
          </div>
        }
      />
      {q.isLoading ? (
        <p className="text-sm text-muted-foreground">Loading…</p>
      ) : null}
      {q.error ? (
        <Card>
          <p className="text-sm">This needs a connection.</p>
        </Card>
      ) : null}

      {data ? (
        <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_22rem] lg:items-start">
          <div className="space-y-4">
            {data.articles.length === 0 && data.categories.length === 0 ? (
              <Card className="space-y-2 text-center">
                <p className="text-base font-semibold">
                  Start with the rules you wish everyone had been told.
                </p>
                <p className="text-sm text-muted-foreground">
                  For example “Customer privacy”, “Handling cash” or “Opening
                  and closing the day”. Group them in categories and publish
                  when ready.
                </p>
              </Card>
            ) : null}
            {groups.map((g) => (
              <section key={g.id} className="space-y-2" aria-label={g.name}>
                <div className="flex items-center justify-between gap-2">
                  <h2 className="text-sm font-semibold uppercase tracking-wide text-muted-foreground">
                    {g.name}
                  </h2>
                  {g.real ? (
                    <span className="flex gap-1">
                      <button
                        type="button"
                        className="min-h-9 rounded-lg px-2 text-xs text-muted-foreground hover:bg-muted"
                        onClick={() => setCatModal({ id: g.id, name: g.name })}
                      >
                        Rename
                      </button>
                      {g.articles.length === 0 ? (
                        <Popconfirm
                          title="Delete this category?"
                          okText="Delete"
                          onConfirm={() => delCat.mutate(g.id)}
                        >
                          <button
                            type="button"
                            className="min-h-9 rounded-lg px-2 text-xs text-red-600 hover:bg-muted"
                          >
                            Delete
                          </button>
                        </Popconfirm>
                      ) : null}
                    </span>
                  ) : null}
                </div>
                {g.articles.length === 0 ? (
                  <p className="text-sm text-muted-foreground">
                    Nothing here yet.
                  </p>
                ) : null}
                {g.articles.map((a) => (
                  <Card key={a.id} className="space-y-2">
                    <div className="flex flex-wrap items-center gap-2 text-xs">
                      <span
                        className={`rounded-full px-2 py-0.5 font-semibold ${a.status === "published" ? "bg-emerald-500/15 text-emerald-800 dark:text-emerald-200" : "bg-muted text-muted-foreground"}`}
                      >
                        {a.status === "published"
                          ? `Published · v${a.version}`
                          : "Draft"}
                      </span>
                      <span className="rounded-full bg-muted px-2 py-0.5">
                        {kindLabel(a.kind)}
                      </span>
                      {a.mustRead ? null : (
                        <span className="text-muted-foreground">
                          Optional reading
                        </span>
                      )}
                      <span className="ml-auto text-muted-foreground">
                        Edited {when(a.updatedAt)}
                      </span>
                    </div>
                    <h3 className="text-base font-semibold">{a.title}</h3>
                    {a.status === "published" && data.staff > 0 ? (
                      <button
                        type="button"
                        onClick={() => setReaders(a)}
                        className="block w-full text-left"
                        aria-label={`Who has read ${a.title}`}
                      >
                        <Progress
                          percent={Math.round(
                            ((a.readers ?? 0) / data.staff) * 100,
                          )}
                          size="small"
                          format={() =>
                            `${a.readers ?? 0} of ${data.staff} read`
                          }
                        />
                      </button>
                    ) : null}
                    <div className="flex flex-wrap gap-2">
                      <Link to={paths.guide.edit.to(a.id)}>
                        <Button variant="secondary">
                          <PencilIcon className="mr-1.5 size-4" aria-hidden />
                          Edit
                        </Button>
                      </Link>
                      {a.status === "published" ? (
                        <Button
                          variant="secondary"
                          onClick={() => setReaders(a)}
                        >
                          <UsersIcon className="mr-1.5 size-4" aria-hidden />
                          Who has read
                        </Button>
                      ) : null}
                      {a.status === "published" ? (
                        <Popconfirm
                          title="Hide this from everyone?"
                          description="It stays here as a draft."
                          okText="Hide"
                          onConfirm={() => unpublish.mutate(a.id)}
                        >
                          <Button variant="secondary">Unpublish</Button>
                        </Popconfirm>
                      ) : null}
                      <Popconfirm
                        title="Delete this article?"
                        description="This cannot be undone."
                        okText="Delete"
                        okButtonProps={{ danger: true }}
                        onConfirm={() => del.mutate(a.id)}
                      >
                        <Button variant="secondary">Delete</Button>
                      </Popconfirm>
                    </div>
                  </Card>
                ))}
              </section>
            ))}
          </div>
          <RemindersCard value={data.reminders} />
        </div>
      ) : null}

      <ReadersModal
        article={readers}
        staff={data?.staff ?? 0}
        onClose={() => setReaders(null)}
      />
      <Modal
        open={!!catModal}
        title={
          catModal && data?.categories.some((c) => c.id === catModal.id)
            ? "Rename category"
            : "New category"
        }
        okText="Save"
        confirmLoading={saveCat.isPending}
        okButtonProps={{ disabled: (catModal?.name.trim().length ?? 0) < 2 }}
        onCancel={() => setCatModal(null)}
        onOk={() =>
          catModal &&
          saveCat.mutate(
            { id: catModal.id, name: catModal.name.trim() },
            { onSuccess: () => setCatModal(null) },
          )
        }
        destroyOnHidden
      >
        <Input
          size="large"
          maxLength={60}
          autoFocus
          placeholder="e.g. Customer privacy"
          value={catModal?.name ?? ""}
          onChange={(e) =>
            setCatModal((c) => (c ? { ...c, name: e.target.value } : c))
          }
          onPressEnter={() => undefined}
        />
      </Modal>
    </div>
  );
}
