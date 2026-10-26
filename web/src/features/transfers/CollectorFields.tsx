import { Segmented } from "antd";
import { SelectField } from "@/shared/ui/SelectField";
import { TextField } from "@/shared/ui/TextField";
import { useStaff } from "./api";
import type { CollectorInput } from "./schemas";

/** Who carries it: a staff member, or someone from outside whose details are written down. */
export function CollectorFields({
  value,
  onChange,
}: {
  value: CollectorInput;
  onChange: (next: CollectorInput) => void;
}) {
  const staff = useStaff(value.type === "staff");
  const set = (patch: Partial<CollectorInput>) =>
    onChange({ ...value, ...patch });
  return (
    <div className="space-y-3">
      <Segmented
        block
        value={value.type}
        onChange={(v) =>
          onChange(v === "staff" ? { type: "staff" } : { type: "external" })
        }
        options={[
          { label: "Our staff", value: "staff" },
          { label: "Someone outside", value: "external" },
        ]}
      />
      {value.type === "staff" ? (
        <SelectField
          label="Staff member"
          value={value.userId ?? ""}
          onChange={(e) => set({ userId: e.target.value })}
        >
          <option value="">Choose…</option>
          {(staff.data ?? []).map((s) => (
            <option key={s.id} value={s.id}>
              {s.displayName}
            </option>
          ))}
        </SelectField>
      ) : (
        <>
          <TextField
            label="Full name"
            value={value.name ?? ""}
            onChange={(e) => set({ name: e.target.value })}
          />
          <TextField
            label="Phone"
            inputMode="tel"
            value={value.phone ?? ""}
            onChange={(e) => set({ phone: e.target.value })}
          />
          <div className="grid grid-cols-2 gap-3">
            <TextField
              label="ID type"
              placeholder="Ghana card"
              value={value.idType ?? ""}
              onChange={(e) => set({ idType: e.target.value })}
            />
            <TextField
              label="ID number"
              value={value.idNumber ?? ""}
              onChange={(e) => set({ idNumber: e.target.value })}
            />
          </div>
          <TextField
            label="Who sent them (optional)"
            value={value.relationship ?? ""}
            onChange={(e) => set({ relationship: e.target.value })}
          />
        </>
      )}
    </div>
  );
}

export const collectorReady = (c: CollectorInput) =>
  c.type === "staff" ? !!c.userId : !!c.name?.trim();

/** Drops empty fields so only what was typed is sent. */
export function cleanCollector(c: CollectorInput): CollectorInput {
  const out: Record<string, string> = { type: c.type };
  for (const [k, v] of Object.entries(c))
    if (k !== "type" && typeof v === "string" && v.trim()) out[k] = v.trim();
  return out as unknown as CollectorInput;
}
