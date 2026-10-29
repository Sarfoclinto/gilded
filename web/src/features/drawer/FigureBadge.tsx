import { Chip } from "@/shared/ui/Chip";
import type { FigureState } from "./closing";

const map: Record<
  FigureState,
  { tone: "grey" | "green" | "amber" | "red" | "sky"; text: string }
> = {
  empty: { tone: "grey", text: "Not entered" },
  invalid: { tone: "red", text: "Check the number" },
  matches: { tone: "green", text: "Matches the books" },
  notes: { tone: "amber", text: "Different notes" },
  short: { tone: "red", text: "Short" },
  over: { tone: "amber", text: "Over" },
};

export function FigureBadge({ state }: { state: FigureState }) {
  const m = map[state];
  return <Chip tone={m.tone}>{m.text}</Chip>;
}
