import { describeCarat, useExpectations } from "./expectations";

/** "Usually 22 high" for the town and for the customer. A guide for new tellers; it never changes the price or the result. */
export function ExpectationHint({
  townId,
  townName,
  customerId,
  customerName,
}: {
  townId: string | null;
  townName?: string | null;
  customerId: string | null;
  customerName?: string | null;
}) {
  const { data } = useExpectations(townId, customerId);
  const lines = [
    describeCarat(
      townName || data?.town?.name || "This town",
      data?.town,
      "is usually",
    ),
    describeCarat(
      customerName || "This customer",
      data?.customer,
      "usually brings",
    ),
  ].filter((l): l is string => !!l);
  if (lines.length === 0) return null;
  return (
    <div
      className="mt-3 rounded-lg bg-muted px-3 py-2 text-sm"
      role="note"
      aria-label="What carat to expect"
    >
      <div className="text-xs font-medium uppercase text-muted-foreground">
        Expect
      </div>
      {lines.map((l) => (
        <p key={l}>{l}</p>
      ))}
      <p className="mt-1 text-xs text-muted-foreground">
        A guide from past purchases. Measure as usual.
      </p>
    </div>
  );
}
