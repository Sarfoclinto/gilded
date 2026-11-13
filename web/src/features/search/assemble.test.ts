import { describe, expect, it } from "vitest";
import type { SearchResult } from "./api";
import { searchDevice } from "./local";
import { searchPages, type PageHit } from "./pages";
import { toRows } from "./rows";
import { assemble } from "./useGlobalSearch";

const can = { customers: true, buy: true };
const pages: PageHit[] = [
  {
    href: "/drawer",
    title: "Cash drawer",
    section: "Cash",
    keywords: "cash money notes till balance",
  },
  {
    href: "/drawer/close",
    title: "Close the day",
    section: "Action",
    keywords: "end evening closing count balance",
  },
  {
    href: "/people/customers",
    title: "Customers",
    section: "Operations",
    keywords: "",
  },
  {
    href: "/payments",
    title: "Mobile money",
    section: "Money",
    keywords: "momo mobile money mtn",
  },
];
const server: SearchResult = {
  q: "drew",
  groups: [
    {
      key: "customers",
      total: 1,
      items: [
        {
          id: "c1",
          name: "Drew Mensah",
          phone: "0244123456",
          score: 90,
          close: false,
          purchases: 3,
          lastPurchaseAt: "2026-11-12T10:00:00Z",
          lastAmount: "2500",
          owes: "500",
        },
      ],
    },
    {
      key: "purchases",
      total: 12,
      items: [
        {
          id: "t1",
          reference: "TKW-20261112-0003",
          customerId: "c1",
          customerName: "Drew Mensah",
          customerPhone: null,
          amount: "2500",
          status: "saved",
          capturedAt: "2026-11-12T10:00:00Z",
          branch: "Tarkwa",
          flagged: true,
          top: "7.77",
          down: "0.41",
          karat: "22.5",
          items: 2,
        },
      ],
    },
  ],
};

describe("pages and actions", () => {
  it("finds a page by its name, by other words people use, and best names first", () => {
    expect(searchPages(pages, "close").map((p) => p.title)).toEqual([
      "Close the day",
    ]);
    expect(searchPages(pages, "momo").map((p) => p.title)).toEqual([
      "Mobile money",
    ]);
    expect(searchPages(pages, "cash").map((p) => p.title)[0]).toBe(
      "Cash drawer",
    );
    expect(
      searchPages(pages, "balance")
        .map((p) => p.title)
        .sort(),
    ).toEqual(["Cash drawer", "Close the day"]);
    expect(searchPages(pages, "zzz")).toEqual([]);
  });
});

describe("rows a person can recognise", () => {
  it("a customer: phone, purchases, last purchase, what they owe, and a purchase one tap away", () => {
    const [r] = toRows(server.groups[0]!, can);
    expect(r).toMatchObject({
      title: "Drew Mensah",
      value: "GHS 500",
      valueNote: "owes",
      href: "/people/customers/c1",
      action: { label: "New purchase", href: "/transactions/new" },
    });
    expect(r!.subtitle).toContain("0244123456");
    expect(r!.subtitle).toContain("3 purchases");
    expect(r!.subtitle).toContain("last GHS 2,500");
  });

  it("someone who may not open customer pages is taken to a purchase for that customer instead", () => {
    const [r] = toRows(server.groups[0]!, { customers: false, buy: true });
    expect(r).toMatchObject({
      href: "/transactions/new",
      state: { customer: { id: "c1", name: "Drew Mensah" } },
    });
    expect(r!.action).toBeUndefined();
  });

  it("a purchase: receipt number, weights, karat, amount and flags", () => {
    const [r] = toRows(server.groups[1]!, can);
    expect(r).toMatchObject({
      title: "Drew Mensah",
      value: "GHS 2,500",
      href: "/transactions/t1",
    });
    expect(r!.subtitle).toContain("TKW-20261112-0003");
    expect(r!.subtitle).toContain("7.77 g top, 0.41 g down");
    expect(r!.subtitle).toContain("22.5K +1 more");
    expect(r!.chips).toEqual([{ text: "Flagged", tone: "amber" }]);
  });
});

describe("putting the answer together", () => {
  it("pages go last when the typing is a name, first when it names a page", () => {
    const drew = assemble("drew", server, [], [], can, null);
    expect(drew.map((s) => s.key)).toEqual(["customers", "purchases"]);
    const withPage = assemble(
      "custom",
      server,
      [],
      searchPages(pages, "custom"),
      can,
      null,
    );
    expect(withPage[0]!.key).toBe("pages");
    const weak = assemble(
      "balance",
      server,
      [],
      searchPages(pages, "balance"),
      can,
      null,
    );
    expect(weak[weak.length - 1]!.key).toBe("pages");
  });

  it("keeps the full count next to the few rows shown", () => {
    expect(assemble("drew", server, [], [], can, null)[1]).toMatchObject({
      key: "purchases",
      total: 12,
      label: "Purchases",
    });
  });

  it("one group only, when asked", () => {
    expect(
      assemble(
        "drew",
        server,
        [],
        searchPages(pages, "cash"),
        can,
        "purchases",
      ).map((s) => s.key),
    ).toEqual(["purchases"]);
  });
});

describe("with no connection: what the device holds", () => {
  const people = [
    { id: "c1", name: "Ama Serwaa", phone: "0244123456" },
    { id: "c2", name: "Kwame Amankwah", phone: "+233201112223" },
    { id: "c1", name: "Ama Serwaa", phone: "0244123456" },
  ];
  const purchases = [
    {
      id: "t1",
      reference: "TKW-20261112-0003",
      customerName: "Ama Serwaa",
      customerPhone: "0244123456",
      status: "saved",
      capturedAt: "2026-11-12T10:00:00Z",
      payout: { payable: "8605" },
    },
    {
      id: "t2",
      reference: "TKW-20261112-0004",
      customerName: "Kofi Annan",
      customerPhone: null,
      status: "void",
      capturedAt: "2026-11-12T11:00:00Z",
      payout: { payable: "1200" },
    },
  ] as never;

  it("finds customers by name or phone, once each, and leads to a purchase (their page needs a connection)", () => {
    const r = searchDevice("ama", { people, purchases: [] }, can);
    expect(r[0]!.rows.map((x) => x.title)).toEqual([
      "Ama Serwaa",
      "Kwame Amankwah",
    ]);
    expect(r[0]!.rows[0]).toMatchObject({
      href: "/transactions/new",
      state: { customer: { id: "c1" } },
    });
    expect(
      searchDevice("020 111 2223", { people, purchases: [] }, can)[0]!.rows[0]!
        .title,
    ).toBe("Kwame Amankwah");
  });

  it("finds recent purchases by receipt number, name or amount", () => {
    expect(
      searchDevice("0004", { people: [], purchases }, can)[0]!.rows[0],
    ).toMatchObject({
      title: "Kofi Annan",
      chips: [{ text: "Cancelled", tone: "red" }],
    });
    expect(
      searchDevice("8,605", { people: [], purchases }, can)[0]!.rows[0]!.title,
    ).toBe("Ama Serwaa");
    expect(searchDevice("a", { people, purchases }, can)).toEqual([]);
  });

  it("is what the answer is made of when the server cannot be reached", () => {
    const s = assemble(
      "ama",
      null,
      searchDevice("ama", { people, purchases }, can),
      [],
      can,
      null,
    );
    expect(s.map((x) => x.key)).toEqual(["customers", "purchases"]);
  });
});
