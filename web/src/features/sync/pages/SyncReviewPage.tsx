import { useState } from "react";
import { Alert, Modal } from "antd";
import { errorMessage } from "@/shared/api/errors";
import { Button } from "@/shared/ui/Button";
import { Card } from "@/shared/ui/Card";
import { EmptyState } from "@/shared/ui/DataTable";
import { PageHeader } from "@/shared/ui/PageHeader";
import { TextField } from "@/shared/ui/TextField";
import { toast } from "@/shared/ui/toast";
import { when } from "@/features/transactions/format";
import { useResolveSync, useSyncReview, type ReviewItem } from "../api";
import { commandLabel, statusLabel } from "../labels";

/** A short plain-words line about what the entry holds. */
function summary(i: ReviewItem): string {
  const p = i.payload as Record<string, unknown>;
  const bits: string[] = [];
  if (typeof p.kind === "string") bits.push(p.kind);
  if (typeof p.note === "string" && p.note) bits.push(p.note);
  if (typeof p.businessDate === "string") bits.push(p.businessDate);
  return bits.join(" · ");
}

export default function SyncReviewPage() {
  const q = useSyncReview();
  const resolve = useResolveSync();
  const [dismissing, setDismissing] = useState<ReviewItem | null>(null);
  const [note, setNote] = useState("");
  const data = q.data;

  const retry = (i: ReviewItem) =>
    resolve.mutate(
      { id: i.id, action: "retry" },
      {
        onSuccess: (r) =>
          r.status === "applied"
            ? toast.success("Applied")
            : toast.error(r.message ?? "Still cannot be applied."),
      },
    );
  const dismiss = () => {
    if (!dismissing) return;
    resolve.mutate(
      { id: dismissing.id, action: "dismiss", note: note.trim() },
      {
        onSuccess: () => {
          toast.success("Dismissed");
          setDismissing(null);
          setNote("");
        },
      },
    );
  };

  return (
    <div className="mx-auto max-w-3xl space-y-4 p-4">
      <PageHeader
        title="Offline entries to review"
        subtitle="Saved on a computer or phone while it had no connection, and could not be applied when it reconnected."
      />
      {q.error ? (
        <Alert type="error" showIcon title={errorMessage(q.error)} />
      ) : null}
      {data && data.items.length === 0 ? (
        <EmptyState
          title="Nothing to review"
          hint="Everything saved offline has been applied."
        />
      ) : null}
      <ul className="space-y-3">
        {data?.items.map((i) => (
          <li key={i.id}>
            <Card className="space-y-2">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <div className="font-medium">
                  {commandLabel[i.type] ?? i.type}{" "}
                  <span className="text-sm font-normal text-muted-foreground">
                    · {i.by.name}
                    {i.branchName ? ` · ${i.branchName}` : ""}
                  </span>
                </div>
                <span
                  className={`rounded-full px-2 py-0.5 text-xs font-medium ${i.status === "rejected" ? "bg-red-100 text-red-800" : "bg-amber-100 text-amber-800"}`}
                >
                  {statusLabel[i.status]}
                </span>
              </div>
              <p className="text-sm">
                {i.message ?? "It could not be applied."}
              </p>
              {summary(i) ? (
                <p className="text-sm text-muted-foreground">{summary(i)}</p>
              ) : null}
              <p className="text-xs text-muted-foreground">
                Made {i.capturedAt ? when(i.capturedAt) : "at an unknown time"}{" "}
                · received {when(i.receivedAt)}
              </p>
              <div className="flex flex-wrap gap-2 pt-1">
                <Button
                  loading={resolve.isPending && resolve.variables?.id === i.id}
                  onClick={() => retry(i)}
                >
                  Try again
                </Button>
                <Button variant="secondary" onClick={() => setDismissing(i)}>
                  Dismiss
                </Button>
              </div>
            </Card>
          </li>
        ))}
      </ul>

      {data && data.recent.length > 0 ? (
        <div>
          <h3 className="mb-2 text-sm font-semibold">Recently dealt with</h3>
          <ul className="space-y-1 text-sm">
            {data.recent.map((r) => (
              <li
                key={r.id}
                className="flex justify-between gap-2 rounded-lg border border-border px-3 py-2"
              >
                <span>
                  {commandLabel[r.type] ?? r.type} · {r.by.name} ·{" "}
                  {r.status === "dismissed" ? "Dismissed" : "Applied"}
                  {r.resolution ? ` — ${r.resolution}` : ""}
                </span>
                <span className="shrink-0 text-xs text-muted-foreground">
                  {r.resolvedAt ? when(r.resolvedAt) : ""}
                </span>
              </li>
            ))}
          </ul>
        </div>
      ) : null}

      <Modal
        title="Dismiss this entry?"
        open={!!dismissing}
        onCancel={() => setDismissing(null)}
        onOk={dismiss}
        okText="Dismiss"
        okButtonProps={{
          disabled: note.trim().length < 5,
          loading: resolve.isPending,
        }}
        destroyOnHidden
      >
        <p className="mb-3 text-sm text-muted-foreground">
          It will not be applied. Say why, so the books explain themselves
          later.
        </p>
        <TextField
          label="Reason"
          value={note}
          onChange={(e) => setNote(e.target.value)}
          maxLength={200}
        />
      </Modal>
    </div>
  );
}
