import { Link, useParams } from "react-router-dom";
import { ArrowLeftIcon, CheckCircle2Icon } from "lucide-react";
import paths from "@/config/paths";
import { Button } from "@/shared/ui/Button";
import { Card } from "@/shared/ui/Card";
import { useArticle, useGuide, useMarkRead } from "../api";
import { BlocksView } from "../BlockView";
import { kindLabel, readMinutes } from "../blocks";

const date = (iso: string) =>
  new Date(iso).toLocaleDateString("en-GB", {
    day: "numeric",
    month: "short",
    year: "numeric",
  });

/** One article. Reading it to the end and pressing the button is how a person says they have read it. */
export default function GuideArticlePage() {
  const { id } = useParams();
  const q = useArticle(id);
  const list = useGuide();
  const mark = useMarkRead();
  const a = q.data;
  const next = (list.data?.articles ?? []).find(
    (x) => x.id !== id && x.mustRead && !x.read,
  );

  return (
    <div className="mx-auto max-w-3xl space-y-4 p-3 sm:p-4 lg:p-6">
      <Link
        to={paths.guide.home.href}
        className="inline-flex min-h-10 items-center gap-1.5 text-sm text-muted-foreground hover:text-foreground"
      >
        <ArrowLeftIcon className="size-4" aria-hidden />
        All guides
      </Link>
      {q.isLoading ? (
        <p className="text-sm text-muted-foreground">Loading…</p>
      ) : null}
      {q.error ? (
        <Card>
          <p className="text-sm">
            {q.error.status === 404
              ? "This guide is not available any more."
              : "It could not be opened. It needs a connection."}
          </p>
        </Card>
      ) : null}
      {a ? (
        <article className="space-y-5">
          <header className="space-y-2">
            <div className="flex flex-wrap items-center gap-2 text-xs">
              <span className="rounded-full bg-muted px-2 py-0.5 font-medium">
                {kindLabel(a.kind)}
              </span>
              <span className="text-muted-foreground">
                {readMinutes(a.blocks)} min read
                {a.publishedAt
                  ? ` · ${a.version > 1 ? "updated" : "posted"} ${date(a.updatedAt)}`
                  : ""}
              </span>
            </div>
            <h1 className="text-2xl font-bold tracking-tight">{a.title}</h1>
            {a.summary ? (
              <p className="text-muted-foreground">{a.summary}</p>
            ) : null}
          </header>
          <BlocksView blocks={a.blocks} />
          <Card
            className={a.read ? "border-emerald-500/50 bg-emerald-500/10" : ""}
          >
            {a.read ? (
              <p className="flex items-center gap-2 text-sm">
                <CheckCircle2Icon
                  className="size-5 text-emerald-600"
                  aria-hidden
                />
                You have read this{a.readAt ? ` on ${date(a.readAt)}` : ""}.
              </p>
            ) : (
              <div className="space-y-3">
                <p className="text-sm">
                  When you have read all of it, confirm below. This is recorded.
                </p>
                <Button
                  className="w-full sm:w-auto"
                  onClick={() =>
                    id && mark.mutate(id, { onSuccess: () => void q.refetch() })
                  }
                  loading={mark.isPending}
                >
                  I have read and understood this
                </Button>
              </div>
            )}
            {next ? (
              <p className="mt-3 text-sm">
                Next to read:{" "}
                <Link
                  className="font-medium underline"
                  to={paths.guide.article.to(next.id)}
                >
                  {next.title}
                </Link>
              </p>
            ) : null}
          </Card>
        </article>
      ) : null}
    </div>
  );
}
