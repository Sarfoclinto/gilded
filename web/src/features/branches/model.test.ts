import { describe, expect, it } from "vitest";
import { attentionItems, groupWorkers } from "./model";

describe("branch model", () => {
  it("lists only what needs attention, with right wording", () => {
    const a = {
      signoffPending: 1,
      openDifferences: 0,
      transfersComing: 2,
      transfersGoing: 0,
      moneyWaiting: 0,
      moneyToSend: 0,
    };
    expect(attentionItems(a, 0).map((i) => i.label)).toEqual([
      "1 closed day waiting for sign-off",
      "2 transfers on their way here",
    ]);
    expect(
      attentionItems({ ...a, signoffPending: 0, transfersComing: 0 }, 0),
    ).toEqual([]);
    expect(
      attentionItems({ ...a, signoffPending: 0, transfersComing: 0 }, 3)[0]!
        .label,
    ).toBe("3 overdue debts");
  });
  it("groups workers by role, managers before tellers, unknown roles last", () => {
    const w = (id: string, key: string, name: string) => ({
      id,
      name: id,
      role: { key, name },
    });
    const g = groupWorkers([
      w("a", "teller", "Teller"),
      w("b", "kitchen-boy", "Kitchen boy"),
      w("c", "manager", "Manager"),
      w("d", "teller", "Teller"),
      w("e", "auditor", "Auditor"),
    ]);
    expect(g.map((x) => x.key)).toEqual([
      "manager",
      "teller",
      "kitchen-boy",
      "auditor",
    ]);
    expect(g[1]!.people).toHaveLength(2);
  });
});
