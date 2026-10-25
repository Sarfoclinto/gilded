import { useMemo, useState } from "react";
import { Alert, Modal } from "antd";
import { Button } from "@/shared/ui/Button";
import { SelectField } from "@/shared/ui/SelectField";
import { TextField } from "@/shared/ui/TextField";
import { useCreateBranch, useUpdateBranch, type ManagedBranch } from "./api";

const DEFAULT_ZONE = "Africa/Accra";

function zones(): string[] {
  const list = (
    Intl as unknown as { supportedValuesOf?: (key: string) => string[] }
  ).supportedValuesOf?.("timeZone");
  return list && list.length > 0
    ? list
    : [DEFAULT_ZONE, "Africa/Abidjan", "Africa/Lagos", "Europe/London", "UTC"];
}

function Form({
  branch,
  onDone,
}: {
  branch: ManagedBranch | null;
  onDone: (b: ManagedBranch) => void;
}) {
  const create = useCreateBranch();
  const update = useUpdateBranch();
  const [commandId] = useState(() => crypto.randomUUID());
  const [code, setCode] = useState("");
  const [name, setName] = useState(branch?.name ?? "");
  const [timezone, setTimezone] = useState(branch?.timezone ?? DEFAULT_ZONE);
  const options = useMemo(() => zones(), []);
  const pending = create.isPending || update.isPending;
  const error = (create.error ?? update.error)?.message;

  const changed =
    !branch || name.trim() !== branch.name || timezone !== branch.timezone;
  const ok =
    name.trim().length >= 2 &&
    (branch ? true : /^[A-Za-z0-9]{2,6}$/.test(code.trim())) &&
    changed &&
    !pending;

  function submit() {
    if (!ok) return;
    if (branch)
      update.mutate(
        {
          id: branch.id,
          changes: {
            ...(name.trim() !== branch.name ? { name: name.trim() } : {}),
            ...(timezone !== branch.timezone ? { timezone } : {}),
          },
        },
        { onSuccess: onDone },
      );
    else
      create.mutate(
        {
          id: commandId,
          code: code.trim().toUpperCase(),
          name: name.trim(),
          timezone,
        },
        { onSuccess: onDone },
      );
  }

  return (
    <div className="space-y-3">
      {branch ? (
        <p className="text-sm text-muted-foreground">
          Code <strong className="text-foreground">{branch.code}</strong> (part
          of every document number, so it cannot change)
        </p>
      ) : (
        <TextField
          label="Code"
          value={code}
          onChange={(e) => setCode(e.target.value.toUpperCase())}
          maxLength={6}
          autoComplete="off"
          hint="2 to 6 letters or digits, for example TKW. It appears in every receipt number and cannot be changed later."
        />
      )}
      <TextField
        label="Name"
        value={name}
        onChange={(e) => setName(e.target.value)}
      />
      <SelectField
        label="Time zone"
        value={timezone}
        onChange={(e) => setTimezone(e.target.value)}
        hint="Decides which calendar day a purchase belongs to."
      >
        {options.map((z) => (
          <option key={z} value={z}>
            {z}
          </option>
        ))}
      </SelectField>
      {error ? <Alert type="error" showIcon title={error} /> : null}
      <Button
        className="w-full"
        onClick={submit}
        disabled={!ok}
        loading={pending}
      >
        {branch ? "Save" : "Add branch"}
      </Button>
    </div>
  );
}

export function BranchModal({
  open,
  branch,
  onClose,
  onDone,
}: {
  open: boolean;
  branch: ManagedBranch | null;
  onClose: () => void;
  onDone: (b: ManagedBranch) => void;
}) {
  return (
    <Modal
      open={open}
      onCancel={onClose}
      title={branch ? `Edit ${branch.name}` : "Add a branch"}
      footer={null}
      destroyOnHidden
    >
      <Form branch={branch} onDone={onDone} />
    </Modal>
  );
}
