import { useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { Input } from "antd";
import { BookOpenIcon, CheckCircle2Icon, PenLineIcon } from "lucide-react";
import paths from "@/config/paths";
import { PERMISSIONS } from "@/config/permissions";
import { Can } from "@/features/auth/useHasPermission";
import { Button } from "@/shared/ui/Button";
import { Card } from "@/shared/ui/Card";
import { PageHeader } from "@/shared/ui/PageHeader";
import { useGuide } from "../api";
import { kindLabel } from "../blocks";

const OTHER = "__other";

/** The rules and guides, by category. What a person still has to read is marked, so nothing is missed. */
export default function GuidePage() {
  const q = useGuide();
  const [cat, setCat] = useState<string>("all");
  const [search, setSearch] = useState("");
  const data = q.data;

  const shown = useMemo(() => {
    const text = search.trim().toLowerCase();
    return (data?.articles ?? []).filter((a) => {
      if (cat !== "all" && (a.categoryId ?? OTHER) !== cat) return false;
      return (
        !text || `${a.title} ${a.summary ?? ""}`.toLowerCase().includes(text)
      );
    });
  }, [data, cat, search]);

  const unreadIn = (id: string) =>
    (data?.articles ?? []).filter(
      (a) => (a.categoryId ?? OTHER) === id && a.mustRead && !a.read,
    ).length;
  const cats = [
    ...(data?.categories ?? []).map((c) => ({ id: c.id, name: c.name })),
    ...((data?.articles ?? []).some((a) => !a.categoryId)
      ? [{ id: OTHER, name: "Other" }]
      : []),
  ];
  const nameOf = (id: string | null | undefined) =>
    cats.find((c) => c.id === (id ?? OTHER))?.name;

  return (
    <div className="mx-auto max-w-5xl space-y-4 p-3 sm:p-4 lg:p-6">
      <PageHeader
        title="Rules and guides"
        subtitle="How we work here. Read each one once, and again when it is updated."
        actions={
          <Can permission={PERMISSIONS.GUIDE_MANAGE}>
            <Link to={paths.guide.manage.href}>
              <Button variant="secondary">
                <PenLineIcon className="mr-1.5 size-4" aria-hidden />
                Write the guide
              </Button>
            </Link>
          </Can>
        }
      />

      {data && data.unread > 0 ? (
        <Card
          role="status"
          className="flex items-center gap-3 border-amber-500/60 bg-amber-500/10"
        >
          <BookOpenIcon
            className="size-5 shrink-0 text-amber-600"
            aria-hidden
          />
          <p className="text-sm">
            <strong>{data.unread}</strong>{" "}
            {data.unread === 1 ? "guide is" : "guides are"} waiting for you to
            read.
          </p>
        </Card>
      ) : data && data.articles.length > 0 ? (
        <Card
          role="status"
          className="flex items-center gap-3 border-emerald-500/50 bg-emerald-500/10"
        >
          <CheckCircle2Icon
            className="size-5 shrink-0 text-emerald-600"
            aria-hidden
          />
          <p className="text-sm">You are up to date. Thank you for reading.</p>
        </Card>
      ) : null}

      <Input.Search
        size="large"
        allowClear
        placeholder="Search the guide"
        value={search}
        onChange={(e) => setSearch(e.target.value)}
        aria-label="Search the guide"
      />

      <div className="grid gap-4 lg:grid-cols-[14rem_minmax(0,1fr)]">
        <nav
          aria-label="Categories"
          className="-mx-3 flex gap-2 overflow-x-auto px-3 pb-1 lg:mx-0 lg:flex-col lg:gap-1 lg:overflow-visible lg:px-0"
        >
          {[{ id: "all", name: "Everything" }, ...cats].map((c) => {
            const n = c.id === "all" ? (data?.unread ?? 0) : unreadIn(c.id);
            const on = cat === c.id;
            return (
              <button
                key={c.id}
                type="button"
                onClick={() => setCat(c.id)}
                aria-current={on ? "true" : undefined}
                className={`flex min-h-10 shrink-0 items-center justify-between gap-3 rounded-lg border px-3 text-sm font-medium lg:w-full ${on ? "border-navy bg-navy text-white" : "border-border bg-card hover:bg-muted"}`}
              >
                <span className="truncate">{c.name}</span>
                {n > 0 ? (
                  <span
                    className={`tnum rounded-full px-2 text-xs font-semibold ${on ? "bg-gold text-navy" : "bg-amber-500/20 text-amber-800 dark:text-amber-200"}`}
                  >
                    {n}
                  </span>
                ) : null}
              </button>
            );
          })}
        </nav>

        <div className="space-y-3">
          {q.isLoading ? (
            <p className="text-sm text-muted-foreground">Loading…</p>
          ) : null}
          {q.error ? (
            <p className="text-sm text-muted-foreground">
              The guide needs a connection the first time. Try again when you
              are online.
            </p>
          ) : null}
          {data && shown.length === 0 ? (
            <Card>
              <p className="text-sm text-muted-foreground">
                {data.articles.length === 0
                  ? "Nothing has been written here yet."
                  : "Nothing matches."}
              </p>
            </Card>
          ) : null}
          {shown.map((a) => (
            <Link
              key={a.id}
              to={paths.guide.article.to(a.id)}
              className="block"
            >
              <Card className="transition hover:shadow-md">
                <div className="flex flex-wrap items-center gap-2 text-xs">
                  <span className="rounded-full bg-muted px-2 py-0.5 font-medium">
                    {kindLabel(a.kind)}
                  </span>
                  {cat === "all" && nameOf(a.categoryId) ? (
                    <span className="text-muted-foreground">
                      {nameOf(a.categoryId)}
                    </span>
                  ) : null}
                  {a.mustRead && !a.read ? (
                    <span className="ml-auto rounded-full bg-amber-500/20 px-2 py-0.5 font-semibold text-amber-800 dark:text-amber-200">
                      {a.readAt ? "Updated · read again" : "To read"}
                    </span>
                  ) : a.read ? (
                    <span className="ml-auto inline-flex items-center gap-1 text-emerald-700 dark:text-emerald-300">
                      <CheckCircle2Icon className="size-3.5" aria-hidden />
                      Read
                    </span>
                  ) : null}
                </div>
                <h3 className="mt-1.5 text-base font-semibold">{a.title}</h3>
                {a.summary ? (
                  <p className="mt-0.5 text-sm text-muted-foreground">
                    {a.summary}
                  </p>
                ) : null}
              </Card>
            </Link>
          ))}
        </div>
      </div>
    </div>
  );
}
