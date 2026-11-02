import { Link } from "react-router-dom";
import { Segmented, Switch } from "antd";
import { KeyRoundIcon } from "lucide-react";
import paths from "@/config/paths";
import { PERMISSIONS } from "@/config/permissions";
import { useForgetDevice } from "@/features/auth/hooks";
import { useAuth } from "@/features/auth/store";
import { Can } from "@/features/auth/useHasPermission";
import { useAllBranches } from "@/features/branches/api";
import { PAPER, type PaperSize } from "@/features/receipt/settings";
import { ring } from "@/shared/sound/ring";
import { useUI } from "@/store/ui";
import { Button } from "@/shared/ui/Button";
import { Card } from "@/shared/ui/Card";
import { PageHeader } from "@/shared/ui/PageHeader";
import { LayoutSwitch } from "@/features/transactions/focus/LayoutSwitch";
import { useSettings } from "../api";
import { usePersonalSettings, type PersonalSettings } from "../personal";

function Row({
  title,
  help,
  children,
}: {
  title: string;
  help?: string;
  children: React.ReactNode;
}) {
  return (
    <div className="flex flex-col gap-2 border-b border-border py-4 last:border-b-0 sm:flex-row sm:items-center sm:justify-between sm:gap-6">
      <div className="min-w-0 sm:max-w-md">
        <p className="text-sm font-semibold">{title}</p>
        {help ? (
          <p className="mt-0.5 text-sm text-muted-foreground">{help}</p>
        ) : null}
      </div>
      <div className="shrink-0">{children}</div>
    </div>
  );
}

/**
 * Settings that belong to one person at one desk. They are kept on this device and only adjust what the company decided;
 * nothing here can turn off a company rule. Everyone has this page, including the people who manage the company.
 */
export default function MySettingsPage() {
  const user = useAuth((s) => s.user);
  const mine = usePersonalSettings();
  const forgetDevice = useForgetDevice();
  const company = useSettings();
  const branches = useAllBranches().data ?? [];
  const collapsed = useUI((s) => s.menuCollapsed);
  const setCollapsed = useUI((s) => s.setCollapsed);
  const companyPaper = PAPER[company["receipt.paper"]].label;
  const names = (user?.branchIds ?? [])
    .map((id) => branches.find((b) => b.id === id)?.name)
    .filter(Boolean);

  return (
    <div className="mx-auto max-w-3xl space-y-4 p-3 sm:p-4 lg:p-6">
      <PageHeader
        title="My settings"
        subtitle="Only for you, at this desk. They are kept on this device."
      />

      <Card className="flex flex-wrap items-center justify-between gap-3">
        <div className="min-w-0">
          <p className="text-base font-semibold">{user?.displayName}</p>
          <p className="text-sm capitalize text-muted-foreground">
            {user?.role}
            {names.length ? ` · ${names.join(", ")}` : ""}
          </p>
          <p className="text-xs text-muted-foreground">
            Signed in as {user?.username}
          </p>
        </div>
        <Link to={paths.changePassword.href}>
          <Button variant="secondary">
            <KeyRoundIcon className="mr-1.5 size-4" aria-hidden />
            Change my password
          </Button>
        </Link>
      </Card>

      <Card>
        <h2 className="text-base font-semibold">Receipts at this desk</h2>
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
              mine.update({ openReceipt: v as PersonalSettings["openReceipt"] })
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
          title="QR code on the receipt"
          help="Lets the paying desk find the purchase quickly."
        >
          <Switch
            checked={mine.showQr}
            onChange={(v) => mine.update({ showQr: v })}
            aria-label="Show the QR code on the receipt"
          />
        </Row>
      </Card>

      <Card>
        <h2 className="text-base font-semibold">New purchases</h2>
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
              { value: "new", label: "Stay and start a new one" },
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
      </Card>

      <Card>
        <h2 className="text-base font-semibold">Notifications</h2>
        <Row
          title="Ring when a notification arrives"
          help="A short bell, so you notice a new notice even when you are looking at something else. Your device must not be on silent."
        >
          <div className="flex items-center gap-3">
            <button
              type="button"
              onClick={() => ring(true)}
              className="min-h-9 rounded-lg border border-border px-3 text-sm hover:bg-muted"
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
      </Card>

      <Card>
        <h2 className="text-base font-semibold">Screen</h2>
        <Row
          title="Slim menu"
          help="Show only icons in the side menu, to give pages more room on a small screen."
        >
          <Switch
            checked={collapsed}
            onChange={setCollapsed}
            aria-label="Slim menu"
          />
        </Row>
      </Card>

      <Card>
        <h2 className="text-base font-semibold">This device</h2>
        <Row
          title="Forget this device"
          help="Signs you out and removes the saved price, customers and offline sign-ins from this computer. Use it on a shared or handed-over computer. Purchases not yet sent stay and are sent when someone signs in with a connection."
        >
          <Button
            variant="secondary"
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
      </Card>

      <Can permission={PERMISSIONS.SETTINGS_MANAGE}>
        <Card className="flex flex-wrap items-center justify-between gap-3">
          <p className="text-sm text-muted-foreground">
            You also manage the company's settings, which apply to everyone.
          </p>
          <Link to={paths.settings.company.href}>
            <Button variant="secondary">Company settings</Button>
          </Link>
        </Card>
      </Can>
    </div>
  );
}
