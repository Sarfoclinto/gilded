import { useMemo, useState } from "react";
import {
  Alert,
  Input,
  Modal,
  Progress,
  Segmented,
  Select,
  Table,
  Tag,
  Upload,
} from "antd";
import { DownloadIcon, InboxIcon } from "lucide-react";
import { useManagedBranches } from "@/features/branches/api";
import { errorMessage } from "@/shared/api/errors";
import { Button } from "@/shared/ui/Button";
import { PageHeader } from "@/shared/ui/PageHeader";
import { useQueryClient } from "@tanstack/react-query";
import {
  importsApi,
  useImportBatches,
  useUndoImport,
  type ImportBatch,
} from "../api";
import {
  chunk,
  customersTemplate,
  download,
  historyTemplate,
  parseCustomers,
  parseHistory,
  readTable,
  type CustomerRow,
  type HistoryPurchase,
  type Problem,
} from "../parse";

type Tab = "history" | "customers" | "done";

export default function ImportPage() {
  const [tab, setTab] = useState<Tab>("customers");
  return (
    <div className="mx-auto max-w-5xl space-y-4 p-4 pb-8">
      <PageHeader
        title="Bring in your data"
        subtitle="Load customers and past purchases from your spreadsheets, so the lists, timeline and reports show your real history. Start with customers."
      />
      <Segmented<Tab>
        value={tab}
        onChange={setTab}
        options={[
          { value: "customers", label: "1. Customers" },
          { value: "history", label: "2. Past purchases" },
          { value: "done", label: "Earlier imports" },
        ]}
      />
      {tab === "customers" ? (
        <CustomersImport />
      ) : tab === "history" ? (
        <HistoryImport />
      ) : (
        <EarlierImports />
      )}
    </div>
  );
}

// ------------------------------------------------------------------------------------------------ shared bits
function Problems({ problems }: { problems: Problem[] }) {
  if (problems.length === 0) return null;
  return (
    <Alert
      type="warning"
      showIcon
      title={`${problems.length} row${problems.length === 1 ? "" : "s"} will be left out until fixed`}
      description={
        <div className="max-h-48 overflow-auto text-sm">
          {problems.slice(0, 100).map((p, i) => (
            <div key={i}>
              Row {p.row}: {p.message}
            </div>
          ))}
          {problems.length > 100 ? (
            <div>…and {problems.length - 100} more.</div>
          ) : null}
          <div className="mt-2 text-muted-foreground">
            Fix them in the sheet and choose the file again, or import the good
            rows now and add the rest later.
          </div>
        </div>
      }
    />
  );
}

function Pick({ onFile, hint }: { onFile: (f: File) => void; hint: string }) {
  return (
    <Upload.Dragger
      accept=".xlsx,.csv,.txt"
      maxCount={1}
      showUploadList={false}
      beforeUpload={(f) => {
        onFile(f);
        return false;
      }}
    >
      <p className="flex justify-center">
        <InboxIcon className="size-8 text-muted-foreground" />
      </p>
      <p className="font-medium">Choose your Excel or csv file</p>
      <p className="text-sm text-muted-foreground">{hint}</p>
    </Upload.Dragger>
  );
}

interface Run {
  total: number;
  done: number;
  error: string | null;
  finished: boolean;
  summary: string;
}

// ------------------------------------------------------------------------------------------------ customers
function CustomersImport() {
  const [rows, setRows] = useState<CustomerRow[] | null>(null);
  const [problems, setProblems] = useState<Problem[]>([]);
  const [fileError, setFileError] = useState<string | null>(null);
  const [run, setRun] = useState<Run | null>(null);

  async function load(file: File) {
    setFileError(null);
    setRun(null);
    try {
      const r = parseCustomers(await readTable(file));
      setRows(r.rows);
      setProblems(r.problems);
    } catch (e) {
      setRows(null);
      setFileError(
        e instanceof Error ? e.message : "That file could not be read.",
      );
    }
  }

  async function go() {
    if (!rows) return;
    const parts = chunk(rows, 500);
    let created = 0,
      existing = 0;
    setRun({
      total: rows.length,
      done: 0,
      error: null,
      finished: false,
      summary: "",
    });
    try {
      for (const [i, part] of parts.entries()) {
        const r = await importsApi.customers(part);
        created += r.created;
        existing += r.existing;
        setRun({
          total: rows.length,
          done: Math.min(rows.length, (i + 1) * 500),
          error: null,
          finished: false,
          summary: "",
        });
      }
      setRun({
        total: rows.length,
        done: rows.length,
        error: null,
        finished: true,
        summary: `${created} customers added. ${existing} were already there.`,
      });
    } catch (e) {
      setRun((r) => ({
        ...(r ?? { total: rows.length, done: 0, finished: false, summary: "" }),
        error: errorMessage(e),
      }));
    }
  }

  return (
    <div className="space-y-4">
      <Alert
        type="info"
        showIcon
        title="A customer needs a name and a phone number. Someone who is already in (same name and phone) is left alone, so it is safe to run this twice."
      />
      <div>
        <Button
          variant="secondary"
          onClick={() => download("customers-template.csv", customersTemplate)}
        >
          <DownloadIcon className="size-4" /> Download the template
        </Button>
      </div>
      <Pick onFile={load} hint="Columns: Name, Phone, Notes (optional)" />
      {fileError ? <Alert type="error" showIcon title={fileError} /> : null}
      {rows ? (
        <>
          <Problems problems={problems} />
          <Table<CustomerRow>
            rowKey={(r) => `${r.name}|${r.phone}`}
            size="small"
            dataSource={rows}
            pagination={{ pageSize: 8, hideOnSinglePage: true }}
            columns={[
              { title: "Name", dataIndex: "name" },
              { title: "Phone", dataIndex: "phone" },
              { title: "Notes", dataIndex: "notes" },
            ]}
          />
          <Runner run={run} count={rows.length} noun="customers" onGo={go} />
        </>
      ) : null}
    </div>
  );
}

function Runner({
  run,
  count,
  noun,
  onGo,
}: {
  run: Run | null;
  count: number;
  noun: string;
  onGo: () => void;
}) {
  const running = !!run && !run.finished && !run.error;
  return (
    <div className="space-y-3">
      {run && !run.finished ? (
        <Progress
          percent={Math.round((run.done / Math.max(1, run.total)) * 100)}
          status={run.error ? "exception" : "active"}
        />
      ) : null}
      {run?.error ? (
        <Alert
          type="error"
          showIcon
          title="The import stopped"
          description={`${run.error} Nothing is doubled if you press the button again.`}
        />
      ) : null}
      {run?.finished ? (
        <Alert type="success" showIcon title="Done" description={run.summary} />
      ) : null}
      {!run?.finished ? (
        <Button loading={running} disabled={count === 0} onClick={onGo}>
          {run?.error ? "Try again" : `Import ${count} ${noun}`}
        </Button>
      ) : null}
    </div>
  );
}

// ------------------------------------------------------------------------------------------------ past purchases
function HistoryImport() {
  const qc = useQueryClient();
  const branchList = useManagedBranches();
  const branches = useMemo(
    () => (branchList.data ?? []).filter((b) => b.isActive),
    [branchList.data],
  );
  const [defaultBranch, setDefaultBranch] = useState<string | null>(null);
  const [table, setTable] = useState<Awaited<
    ReturnType<typeof readTable>
  > | null>(null);
  const [fileName, setFileName] = useState("");
  const [label, setLabel] = useState("");
  const [fileError, setFileError] = useState<string | null>(null);
  const [run, setRun] = useState<Run | null>(null);
  const [batchId, setBatchId] = useState(() => crypto.randomUUID());

  const parsed = useMemo(
    () => (table ? parseHistory(table, branches, defaultBranch) : null),
    [table, branches, defaultBranch],
  );

  async function load(file: File) {
    setFileError(null);
    setRun(null);
    setBatchId(crypto.randomUUID());
    try {
      setTable(await readTable(file));
      setFileName(file.name);
      setLabel(file.name.replace(/\.[^.]+$/, ""));
    } catch (e) {
      setTable(null);
      setFileError(
        e instanceof Error ? e.message : "That file could not be read.",
      );
    }
  }

  async function go() {
    if (!parsed) return;
    const parts = chunk(parsed.purchases, 200);
    const total = parsed.purchases.length;
    let created = 0,
      skipped = 0;
    setRun({ total, done: 0, error: null, finished: false, summary: "" });
    try {
      for (const [i, part] of parts.entries()) {
        const r = await importsApi.history(batchId, label || fileName, part);
        created += r.created;
        skipped += r.skipped;
        setRun({
          total,
          done: Math.min(total, (i + 1) * 200),
          error: null,
          finished: false,
          summary: "",
        });
      }
      setRun({
        total,
        done: total,
        error: null,
        finished: true,
        summary: `${created} purchases added${skipped ? `, ${skipped} were already imported` : ""}. They are in the transaction lists, customer histories and the branch timeline, marked as imported. No cash or gold was moved.`,
      });
      void qc.invalidateQueries();
    } catch (e) {
      setRun((r) => ({
        ...(r ?? { total, done: 0, finished: false, summary: "" }),
        error: errorMessage(e),
      }));
    }
  }

  const purchases = parsed?.purchases ?? [];
  const pieces = purchases.reduce((s, p) => s + p.items.length, 0);
  const days = purchases.map((p) => p.capturedAt.slice(0, 10)).sort();
  const worth = purchases.reduce(
    (s, p) => s + Number(p.amountPaid ?? Math.trunc(Number(p.previewAmount))),
    0,
  );

  return (
    <div className="space-y-4">
      <Alert
        type="info"
        showIcon
        title="Past purchases are kept as records only. They do not change the cash in a drawer, the gold on hand or any debt. Set those separately when you go live. Lines with the same Receipt no, day and customer become one purchase."
      />
      <div className="flex flex-wrap items-center gap-3">
        <Button
          variant="secondary"
          onClick={() =>
            download("past-purchases-template.csv", historyTemplate)
          }
        >
          <DownloadIcon className="size-4" /> Download the template
        </Button>
        <label className="flex items-center gap-2 text-sm">
          Branch for rows with no Branch cell
          <Select<string>
            allowClear
            placeholder="None"
            value={defaultBranch ?? undefined}
            onChange={(v) => setDefaultBranch(v ?? null)}
            style={{ minWidth: 180 }}
            options={branches.map((b) => ({
              value: b.id,
              label: `${b.name} (${b.code})`,
            }))}
          />
        </label>
      </div>
      <Pick
        onFile={load}
        hint="Columns: Date, Branch, Customer, Phone, Top, Down, Price, Amount paid, Receipt no, Note. Branch is the code or the name."
      />
      {fileError ? <Alert type="error" showIcon title={fileError} /> : null}
      {parsed ? (
        <>
          <div className="flex flex-wrap gap-2 text-sm">
            <Tag color="green">
              {purchases.length} purchases · {pieces} pieces
            </Tag>
            {days.length > 0 ? (
              <Tag>
                {days[0]} to {days[days.length - 1]}
              </Tag>
            ) : null}
            <Tag color="gold">
              About GH₵ {worth.toLocaleString("en-GH")} paid out
            </Tag>
            {parsed.problems.length > 0 ? (
              <Tag color="orange">
                {parsed.problems.length} rows need fixing
              </Tag>
            ) : null}
          </div>
          <Problems problems={parsed.problems} />
          <Table<HistoryPurchase>
            rowKey="key"
            size="small"
            dataSource={purchases}
            pagination={{ pageSize: 8, hideOnSinglePage: true }}
            scroll={{ x: 640 }}
            columns={[
              { title: "Row", dataIndex: "key", width: 60 },
              {
                title: "Day",
                render: (_: unknown, p) => p.capturedAt.slice(0, 10),
              },
              {
                title: "Branch",
                render: (_: unknown, p) =>
                  branches.find((b) => b.id === p.branchId)?.code,
              },
              { title: "Customer", dataIndex: "customerName" },
              {
                title: "Pieces",
                render: (_: unknown, p) => p.items.length,
                align: "right",
              },
              {
                title: "Calculated",
                render: (_: unknown, p) =>
                  Number(p.previewAmount).toLocaleString("en-GH", {
                    maximumFractionDigits: 2,
                  }),
                align: "right",
              },
              {
                title: "Paid",
                render: (_: unknown, p) =>
                  p.amountPaid
                    ? Number(p.amountPaid).toLocaleString("en-GH")
                    : "as calculated",
                align: "right",
              },
            ]}
          />
          <label className="block text-sm">
            Name of this import (so you can find or undo it later)
            <Input
              value={label}
              onChange={(e) => setLabel(e.target.value)}
              maxLength={80}
              className="mt-1"
            />
          </label>
          <Runner
            run={run}
            count={purchases.length}
            noun="purchases"
            onGo={go}
          />
        </>
      ) : null}
    </div>
  );
}

// ------------------------------------------------------------------------------------------------ earlier imports
function EarlierImports() {
  const list = useImportBatches();
  const undo = useUndoImport();
  const [target, setTarget] = useState<ImportBatch | null>(null);
  const [reason, setReason] = useState("");

  return (
    <div className="space-y-3">
      {list.error ? (
        <Alert type="error" showIcon title={errorMessage(list.error)} />
      ) : null}
      <Table<ImportBatch>
        rowKey="id"
        size="middle"
        loading={list.isLoading}
        dataSource={list.data ?? []}
        pagination={false}
        scroll={{ x: 560 }}
        locale={{ emptyText: "Nothing has been imported yet." }}
        columns={[
          {
            title: "Import",
            render: (_: unknown, b) => (
              <div>
                <div className="font-medium">{b.label ?? "Past purchases"}</div>
                <div className="text-xs text-muted-foreground">
                  {new Date(b.createdAt).toLocaleString()} ·{" "}
                  {b.createdBy?.displayName}
                </div>
              </div>
            ),
          },
          {
            title: "Purchases",
            align: "right",
            render: (_: unknown, b) => b.purchases,
          },
          {
            title: "Covers",
            render: (_: unknown, b) => (b.from ? `${b.from} to ${b.to}` : ""),
          },
          {
            title: "",
            align: "right",
            render: (_: unknown, b) =>
              b.undone ? (
                <Tag>Undone</Tag>
              ) : (
                <Button
                  variant="ghost"
                  onClick={() => {
                    setTarget(b);
                    setReason("");
                  }}
                >
                  Undo
                </Button>
              ),
          },
        ]}
      />
      <Modal
        open={!!target}
        title="Undo this import?"
        onCancel={() => setTarget(null)}
        destroyOnHidden
        footer={
          <div className="flex justify-end gap-2">
            <Button variant="secondary" onClick={() => setTarget(null)}>
              Keep it
            </Button>
            <Button
              loading={undo.isPending}
              disabled={reason.trim().length < 5}
              onClick={() =>
                target &&
                undo.mutate(
                  { id: target.id, reason: reason.trim() },
                  { onSuccess: () => setTarget(null) },
                )
              }
            >
              Void {target?.purchases} purchases
            </Button>
          </div>
        }
      >
        <p className="mb-2 text-sm">
          Every purchase from this import is voided with your reason. Nothing is
          deleted, and the import cannot be used again.
        </p>
        <Input.TextArea
          rows={3}
          value={reason}
          onChange={(e) => setReason(e.target.value)}
          placeholder="Why? (at least 5 characters)"
        />
      </Modal>
    </div>
  );
}
