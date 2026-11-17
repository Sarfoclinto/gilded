import paths from "@/config/paths";
import { PERMISSIONS, type Permission } from "@/config/permissions";
import { hasAccess } from "@/features/auth/access";
import type { User } from "@/features/auth/schemas";
import { appMenu, type AppMenuItem } from "@/layouts/menu";
import { filterMenu } from "@/layouts/menuFilter";
import { hasWords, rank, wordsOf } from "./match";

/** A screen or an action the search can take a person to. */
export interface PageHit {
  href: string;
  title: string;
  /** Where it lives in the menu, or "Action". */
  section: string;
  /** Other words people use for it. */
  keywords: string;
}

/** Every `{ href, label }` in the paths table, so a menu item without a plain title still gets its name. */
const LABELS: Record<string, string> = (() => {
  const out: Record<string, string> = {};
  const walk = (o: unknown) => {
    if (!o || typeof o !== "object") return;
    const r = o as { href?: unknown; label?: unknown };
    if (typeof r.href === "string" && typeof r.label === "string")
      out[r.href] = r.label;
    for (const v of Object.values(o)) walk(v);
  };
  walk(paths);
  return out;
})();

/** Things people do that are not menu items of their own, and the other words they use for menu items. */
const ACTIONS: {
  href: string;
  title: string;
  keywords: string;
  permission?: Permission;
}[] = [
  {
    href: paths.transactions.create.href,
    title: "New purchase",
    keywords: "buy gold new transaction customer sell",
    permission: PERMISSIONS.TRANSACTIONS_CREATE,
  },
  {
    href: paths.drawer.open.href,
    title: "Open the day",
    keywords: "start morning opening count",
    permission: PERMISSIONS.DAYS_MANAGE,
  },
  {
    href: paths.drawer.close.href,
    title: "Close the day",
    keywords: "end evening closing count balance",
    permission: PERMISSIONS.DAYS_MANAGE,
  },
  {
    href: paths.drawer.home.href,
    title: "Cash in or cash out",
    keywords: "top up topup withdraw withdrawal float bank allowance",
    permission: PERMISSIONS.DAYS_MANAGE,
  },
  {
    href: paths.settings.me.href,
    title: "My settings",
    keywords: "preferences receipt printer sound notes layout focus classic",
  },
  {
    href: paths.changePassword.href,
    title: "Change my password",
    keywords: "password security",
  },
  {
    href: paths.myPictures.href,
    title: "My pictures",
    keywords: "private camera photos personal gallery notes reference",
  },
];

const MORE_WORDS: Record<string, string> = {
  [paths.transactions.list.href]: "purchases history receipts sales",
  [paths.transactions.toPay.href]: "pay out payout waiting unpaid",
  [paths.drawer.home.href]: "cash money notes till balance",
  [paths.drawer.history.href]: "days closing sign-off signoff past",
  [paths.drawer.exchange.href]:
    "exchange change notes denominations smaller bigger",
  [paths.drawer.account.href]: "daily account report closing figures",
  [paths.payments.href]: "momo mobile money mtn vodafone telecel airteltigo",
  [paths.debts.href]: "loans lend owe owed credit repayment",
  [paths.photos.href]: "photos pictures images gallery evidence id scale gold",
  [paths.collateral.href]: "security collateral held gold custody",
  [paths.review.cases.href]: "discrepancies shortage surplus variance",
  [paths.review.sync.href]: "offline entries held rejected sync",
  [paths.prices.href]: "price margin goldbod rate",
  [paths.market.href]:
    "world gold price chart spot xau usd ounce market history trend",
  [paths.priceFeed.href]: "goldbod feed automatic price",
  [paths.people.users.href]: "staff tellers accounts people",
  [paths.people.roles.href]: "permissions access",
  [paths.audit.href]: "log history who did what",
  [paths.imports.href]: "import excel spreadsheet upload",
  [paths.guide.home.href]: "rules help how to",
  [paths.calculator.href]: "karat density purity value weigh",
  [paths.workings.href]:
    "scratch sheet rough calculations notes figures formula sum onenote paper",
};

/** The screens and actions this person can reach (the same rule as the menu: what they may not open is not offered). */
export function searchablePages(user: User | null): PageHit[] {
  const out: PageHit[] = [];
  const seen = new Set<string>();
  const add = (p: PageHit) => {
    const k = `${p.href}|${p.title}`;
    if (!seen.has(k)) {
      seen.add(k);
      out.push(p);
    }
  };
  for (const a of ACTIONS)
    if (!a.permission || hasAccess(user, { permission: a.permission }))
      add({
        href: a.href,
        title: a.title,
        section: "Action",
        keywords: a.keywords,
      });
  const text = (n: AppMenuItem) =>
    typeof n.label === "string" ? n.label : (n.title ?? "");
  const walk = (items: AppMenuItem[], section: string) => {
    for (const i of items) {
      if (i.children) walk(i.children, text(i) || section);
      else if (i.key.startsWith("/"))
        add({
          href: i.key,
          title: i.title ?? LABELS[i.key] ?? i.key,
          section,
          keywords: MORE_WORDS[i.key] ?? "",
        });
    }
  };
  walk(filterMenu(appMenu, user), "");
  return out;
}

/** Pages whose name (or one of their other words) has every word typed; the best names first. */
export function searchPages(pages: PageHit[], q: string, limit = 5): PageHit[] {
  const words = wordsOf(q);
  if (words.length === 0) return [];
  return pages
    .map((p) => ({
      p,
      s: Math.max(
        rank(p.title, q),
        hasWords(`${p.title} ${p.keywords} ${p.section}`, words) ? 60 : 0,
      ),
    }))
    .filter((x) => x.s > 0)
    .sort((a, b) => b.s - a.s || a.p.title.localeCompare(b.p.title))
    .slice(0, limit)
    .map((x) => x.p);
}
