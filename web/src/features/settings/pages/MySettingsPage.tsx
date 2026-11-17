import { useEffect, useState, type ReactNode } from "react";
import { Link } from "react-router-dom";
import { Segmented, Switch } from "antd";
import {
  BellRingIcon,
  KeyRoundIcon,
  LockKeyholeIcon,
  MonitorSmartphoneIcon,
  ReceiptIcon,
  ShoppingBagIcon,
  SlidersHorizontalIcon,
  type LucideIcon,
} from "lucide-react";
import paths from "@/config/paths";
import { PERMISSIONS } from "@/config/permissions";
import { useForgetDevice } from "@/features/auth/hooks";
import { promptInstall, usePwa } from "@/shared/pwa/pwa";
import { useAuth } from "@/features/auth/store";
import { Can } from "@/features/auth/useHasPermission";
import { useAllBranches } from "@/features/branches/api";
import { PAPER, type PaperSize } from "@/features/receipt/settings";
import { ring } from "@/shared/sound/ring";
import { useUI } from "@/store/ui";
import { Button } from "@/shared/ui/Button";
import { CoinEdge } from "@/shared/ui/BrandMark";
import { ProfilePhoto } from "@/features/photos/ProfilePhoto";
import { DesktopRows } from "../DesktopRows";
import { PinSettings } from "@/features/lock/PinSettings";
import { LayoutSwitch } from "@/features/transactions/focus/LayoutSwitch";
import { useSettings } from "../api";
import { usePersonalSettings, type PersonalSettings } from "../personal";

const SECTIONS: {
  id: string;
  title: string;
  blurb: string;
  icon: LucideIcon;
}[] = [
  {
    id: "receipts",
    title: "Receipts",
    blurb: "What the printer at this desk gives the customer.",
    icon: ReceiptIcon,
  },
  {
    id: "purchases",
    title: "New purchases",
    blurb: "How the buying screen behaves for you.",
    icon: ShoppingBagIcon,
  },
  {
    id: "notifications",
    title: "Notifications",
    blurb: "How you hear about new notices.",
    icon: BellRingIcon,
  },
  {
    id: "screen",
    title: "Screen",
    blurb: "How much room the pages get.",
    icon: SlidersHorizontalIcon,
  },
  {
    id: "lock",
    title: "Screen lock",
    blurb:
      "Locks this device when you step away, so nobody else can use your session.",
    icon: LockKeyholeIcon,
  },
  {
    id: "device",
    title: "This device",
    blurb: "Install, storage and signing out of this computer.",
    icon: MonitorSmartphoneIcon,
  },
];

/** One setting: its name and what it does on the left; its control on the right, or underneath on a phone. A switch stays on the same line. */
function Row({
  title,
  help,
  inline = false,
  children,
}: {
  title: string;
  help?: string;
  inline?: boolean;
  children: ReactNode;
}) {
  return (
    <div
      className={`flex gap-3 px-4 py-4 sm:px-5 ${inline ? "items-center justify-between gap-6" : "flex-col sm:flex-row sm:items-center sm:justify-between sm:gap-8"}`}
    >
      <div className="min-w-0 sm:max-w-md">
        <p className="text-sm font-semibold">{title}</p>
        {help ? (
          <p className="mt-0.5 text-sm leading-relaxed text-muted-foreground">
            {help}
          </p>
        ) : null}
      </div>
      <div
        className={`shrink-0 ${inline ? "" : "w-full sm:w-auto [&_.ant-segmented]:max-w-full [&_.ant-segmented]:w-full sm:[&_.ant-segmented]:w-auto"}`}
      >
        {children}
      </div>
    </div>
  );
}

function Section({
  id,
  children,
  danger = false,
}: {
  id: string;
  children: ReactNode;
  danger?: boolean;
}) {
  const s = SECTIONS.find((x) => x.id === id)!;
  const Icon = s.icon;
  return (
    <section
      id={id}
      aria-labelledby={`${id}-h`}
      className={`scroll-mt-4 overflow-hidden rounded-2xl border bg-card shadow-[0_1px_2px_rgba(13,27,46,0.04)] ${danger ? "border-red-200" : "border-border"}`}
    >
      <header className="flex items-center gap-3 border-b border-border px-4 py-3.5 sm:px-5">
        <span
          aria-hidden
          className="grid size-10 shrink-0 place-items-center rounded-xl bg-gold/15 text-brand"
        >
          <Icon className="size-5" />
        </span>
        <div className="min-w-0">
          <h2 id={`${id}-h`} className="text-base font-semibold leading-tight">
            {s.title}
          </h2>
          <p className="text-sm text-muted-foreground">{s.blurb}</p>
        </div>
      </header>
      <div className="divide-y divide-border">{children}</div>
    </section>
  );
}

/** Highlights the section being read, so the menu says where you are. */
function useActiveSection(): string {
  const [active, setActive] = useState(SECTIONS[0]!.id);
  useEffect(() => {
    const els = SECTIONS.map((s) => document.getElementById(s.id)).filter(
      (e): e is HTMLElement => !!e,
    );
    if (!("IntersectionObserver" in window)) return;
    const io = new IntersectionObserver(
      (entries) => {
        const seen = entries
          .filter((e) => e.isIntersecting)
          .sort(
            (a, b) => a.boundingClientRect.top - b.boundingClientRect.top,
          )[0];
        if (seen) setActive(seen.target.id);
      },
      { rootMargin: "-10% 0px -70% 0px" },
    );
    els.forEach((e) => io.observe(e));
    return () => io.disconnect();
  }, []);
  return active;
}

function goTo(id: string) {
  const reduce = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  document
    .getElementById(id)
    ?.scrollIntoView({ behavior: reduce ? "auto" : "smooth", block: "start" });
}

/**
 * Settings that belong to one person at one desk. They are kept on this device and only adjust what the company decided;
 * nothing here can turn off a company rule. Everyone has this page, including the people who manage the company.
 */
export default function MySettingsPage() {
  const user = useAuth((s) => s.user);
  const mine = usePersonalSettings();
  const forgetDevice = useForgetDevice();
  const pwa = usePwa();
  const company = useSettings();
  const branches = useAllBranches().data ?? [];
  const collapsed = useUI((s) => s.menuCollapsed);
  const setCollapsed = useUI((s) => s.setCollapsed);
  const active = useActiveSection();
  const companyPaper = PAPER[company["receipt.paper"]].label;
  const names = (user?.branchIds ?? [])
    .map((id) => branches.find((b) => b.id === id)?.name)
    .filter(Boolean);

  return (
    <div className="mx-auto max-w-5xl space-y-5 p-3 sm:p-4 lg:p-6">
      {/* Who you are */}
      <header className="relative isolate overflow-hidden rounded-2xl bg-navy p-5 text-white sm:p-7">
        <div
          aria-hidden
          className="pointer-events-none absolute inset-0 -z-10 bg-[radial-gradient(60%_80%_at_85%_20%,rgba(201,168,76,0.2),transparent_70%)]"
        />
        <CoinEdge className="pointer-events-none absolute -right-16 -top-20 -z-10 size-64 text-gold/35 sm:size-80" />
        <div className="flex flex-col items-center gap-5 text-center sm:flex-row sm:items-center sm:justify-between sm:text-left">
          <div className="flex flex-col items-center gap-4 sm:flex-row sm:gap-6">
            <ProfilePhoto onDark />
          </div>
          <div className="flex min-w-0 flex-col items-center gap-3 sm:items-end sm:text-right">
            <div className="min-w-0">
              <h1 className="font-display text-2xl font-semibold sm:text-3xl">
                {user?.displayName}
              </h1>
              <p className="text-sm text-white/60">
                Signed in as {user?.username}
              </p>
            </div>
            <div className="flex flex-wrap justify-center gap-1.5 sm:justify-end">
              {user?.role ? (
                <span className="rounded-full bg-gold px-2.5 py-0.5 text-xs font-semibold capitalize text-navy">
                  {user.role}
                </span>
              ) : null}
              {names.map((n) => (
                <span
                  key={n as string}
                  className="rounded-full bg-white/10 px-2.5 py-0.5 text-xs text-white/85"
                >
                  {n}
                </span>
              ))}
            </div>
            <Link to={paths.changePassword.href}>
              <Button
                variant="secondary"
                className="!border-white/20 !bg-white/10 !text-white hover:!bg-white/20"
              >
                <KeyRoundIcon className="mr-1.5 size-4" aria-hidden />
                Change my password
              </Button>
            </Link>
          </div>
        </div>
      </header>
      <p className="px-1 text-sm text-muted-foreground">
        These are only for you, at this desk. They are kept on this device.
      </p>

      <div className="lg:grid lg:grid-cols-[13rem_minmax(0,1fr)] lg:items-start lg:gap-6">
        {/* Where to jump: chips on a phone, a list beside the page on a desktop */}
        <nav
          aria-label="Sections"
          className="-mx-3 mb-4 flex gap-2 overflow-x-auto px-3 pb-1 [scrollbar-width:none] lg:sticky lg:top-4 lg:mx-0 lg:mb-0 lg:flex-col lg:gap-0.5 lg:overflow-visible lg:px-0 lg:pb-0"
        >
          {SECTIONS.map((s) => {
            const Icon = s.icon;
            const on = active === s.id;
            return (
              <button
                key={s.id}
                type="button"
                onClick={() => goTo(s.id)}
                aria-current={on ? "true" : undefined}
                className={`inline-flex min-h-10 shrink-0 items-center gap-2 rounded-full border px-3.5 text-sm font-medium transition-colors lg:rounded-lg lg:border-0 lg:px-3 ${on ? "border-navy bg-navy text-white lg:bg-gold/15 lg:text-navy" : "border-border bg-card text-foreground/80 hover:bg-muted lg:bg-transparent"}`}
              >
                <Icon
                  className={`size-4 ${on ? "lg:text-brand" : ""}`}
                  aria-hidden
                />
                {s.title}
              </button>
            );
          })}
        </nav>

        <div className="min-w-0 space-y-5">
          <Section id="receipts">
            <Row
              title="Paper"
              help={`Follow the company (${companyPaper}), or choose the paper of the printer at this desk.`}
            >
              <Segmented
                value={mine.receiptPaper}
                onChange={(v) =>
                  mine.update({
                    receiptPaper: v as PersonalSettings["receiptPaper"],
                  })
                }
                options={[
                  { value: "company", label: "Company" },
                  ...(Object.keys(PAPER) as PaperSize[]).map((k) => ({
                    value: k,
                    label: k === "a4" ? "A4" : `${k} mm`,
                  })),
                ]}
                aria-label="Receipt paper"
              />
            </Row>
            <Row
              title="Open the receipt after saving"
              help={`Open the receipt ready to print. The company ${company["receipt.printer"] ? "uses" : "does not use"} a receipt printer.`}
            >
              <Segmented
                value={mine.openReceipt}
                onChange={(v) =>
                  mine.update({
                    openReceipt: v as PersonalSettings["openReceipt"],
                  })
                }
                options={[
                  { value: "company", label: "Follow company" },
                  { value: "always", label: "Always" },
                  { value: "never", label: "Never" },
                ]}
                aria-label="Open the receipt after saving"
              />
            </Row>
            <Row
              inline
              title="Weights on the receipt"
              help="Top, down and density for each item, as written on the sticky note."
            >
              <Switch
                checked={mine.showWeights}
                onChange={(v) => mine.update({ showWeights: v })}
                aria-label="Show weights on the receipt"
              />
            </Row>
            <Row
              inline
              title="QR code on the receipt"
              help="Lets the paying desk find the purchase quickly."
            >
              <Switch
                checked={mine.showQr}
                onChange={(v) => mine.update({ showQr: v })}
                aria-label="Show the QR code on the receipt"
              />
            </Row>
          </Section>

          <Section id="purchases">
            <Row
              title="After saving a purchase"
              help="Open the purchase, or stay on a fresh New transaction page to enter the next one straight away. A receipt that opens automatically comes first."
            >
              <Segmented
                value={mine.afterSave}
                onChange={(v) =>
                  mine.update({ afterSave: v as PersonalSettings["afterSave"] })
                }
                options={[
                  { value: "detail", label: "Open the purchase" },
                  { value: "new", label: "Start a new one" },
                ]}
                aria-label="After saving a purchase"
              />
            </Row>
            <Row
              title="Screen design for a purchase"
              help="Classic is the compact form. Focus has big boxes to type in and a big result, like a calculator. You can also switch on the New transaction page."
            >
              <LayoutSwitch
                value={mine.purchaseLayout}
                onChange={(v) => mine.update({ purchaseLayout: v })}
              />
            </Row>
            <Row
              inline
              title="Number pad on touch screens"
              help="In the Focus design, type with a big on-screen number pad so the phone's keyboard does not cover the form."
            >
              <Switch
                checked={mine.keypad}
                onChange={(v) => mine.update({ keypad: v })}
                aria-label="Number pad on touch screens"
              />
            </Row>
            <Row
              title="Notes to pay with"
              help="How the cash is made up when you start a purchase. You can still change it on each purchase."
            >
              <Segmented
                value={mine.noteStrategy}
                onChange={(v) =>
                  mine.update({
                    noteStrategy: v as PersonalSettings["noteStrategy"],
                  })
                }
                options={[
                  { value: "prefer-100s", label: "Prefer 100s" },
                  { value: "fewest-notes", label: "Fewest notes" },
                ]}
                aria-label="Notes to pay with"
              />
            </Row>
          </Section>

          <Section id="notifications">
            <Row
              inline
              title="Ring when a notification arrives"
              help="A short bell, so you notice a new notice even when you are looking at something else. Your device must not be on silent."
            >
              <div className="flex items-center gap-3">
                <button
                  type="button"
                  onClick={() => ring(true)}
                  className="min-h-10 rounded-lg border border-border px-3 text-sm font-medium hover:bg-muted"
                >
                  Play it
                </button>
                <Switch
                  checked={mine.notifySound}
                  onChange={(v) => mine.update({ notifySound: v })}
                  aria-label="Ring when a notification arrives"
                />
              </div>
            </Row>
          </Section>

          <Section id="screen">
            <Row
              inline
              title="Slim menu"
              help="Show only icons in the side menu, to give pages more room on a small screen."
            >
              <Switch
                checked={collapsed}
                onChange={setCollapsed}
                aria-label="Slim menu"
              />
            </Row>
          </Section>

          <Section id="lock">
            <PinSettings Row={Row} />
          </Section>

          <Section id="device">
            <DesktopRows />
            <Row
              inline
              title="Install the app"
              help={
                pwa.installed
                  ? "Gilded is installed on this device and opens in its own window."
                  : pwa.installEvent
                    ? "Adds Gilded to this device like a normal app, and lets it open with no internet."
                    : "Your browser offers this from its menu (Install app / Add to home screen) when available."
              }
            >
              {pwa.installed ? (
                <span className="text-sm font-medium text-emerald-700">
                  Installed
                </span>
              ) : (
                <Button
                  variant="secondary"
                  disabled={!pwa.installEvent}
                  onClick={() => void promptInstall()}
                >
                  Install
                </Button>
              )}
            </Row>
            <Row
              inline
              title="Stored data protected"
              help="Asks the browser not to delete this device's saved price, customers and unsent purchases when the disk is short."
            >
              <span className="text-sm text-muted-foreground">
                {pwa.persisted === null
                  ? "Checking…"
                  : pwa.persisted
                    ? "Yes"
                    : "Not guaranteed"}
              </span>
            </Row>
            <Row
              title="Forget this device"
              help="Signs you out and removes the saved price, customers and offline sign-ins from this computer. Use it on a shared or handed-over computer. Purchases not yet sent stay and are sent when someone signs in with a connection."
            >
              <Button
                variant="secondary"
                className="!border-red-200 !text-red-700 hover:!bg-red-50"
                onClick={() => {
                  if (
                    window.confirm(
                      "Remove the saved data and offline sign-ins from this device and sign out?",
                    )
                  )
                    forgetDevice();
                }}
              >
                Forget this device
              </Button>
            </Row>
          </Section>

          <Can permission={PERMISSIONS.SETTINGS_MANAGE}>
            <div className="flex flex-wrap items-center justify-between gap-3 rounded-2xl border border-gold/50 bg-gold/10 p-4 sm:px-5">
              <p className="text-sm">
                You also manage the company&rsquo;s settings, which apply to
                everyone.
              </p>
              <Link to={paths.settings.company.href}>
                <Button variant="secondary">Company settings</Button>
              </Link>
            </div>
          </Can>
        </div>
      </div>
    </div>
  );
}
