import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { Drawer } from "antd";
import { BellIcon } from "lucide-react";
import { when } from "@/features/transactions/format";
import { Button } from "@/shared/ui/Button";
import { useMarkRead, useNotifications, type AppNotification } from "./api";

/** The bell in the header: a count of what has not been read, and the list. Opening one marks it read and goes to the page it is about. */
export function NotificationBell() {
  const [open, setOpen] = useState(false);
  const navigate = useNavigate();
  const inbox = useNotifications();
  const mark = useMarkRead();
  const unread = inbox.data?.unread ?? 0;
  const items = inbox.data?.items ?? [];

  const go = (n: AppNotification) => {
    if (!n.read) mark.mutate({ ids: [n.id] });
    setOpen(false);
    if (n.link) navigate(n.link);
  };

  return (
    <>
      <button
        type="button"
        aria-label={
          unread ? `Notifications, ${unread} unread` : "Notifications"
        }
        onClick={() => setOpen(true)}
        className="relative grid size-10 place-items-center rounded-full border border-border bg-background"
      >
        <BellIcon className="size-4" />
        {unread > 0 ? (
          <span className="absolute -right-1 -top-1 grid min-w-5 place-items-center rounded-full bg-red-600 px-1 text-[11px] font-semibold leading-5 text-white">
            {unread > 99 ? "99+" : unread}
          </span>
        ) : null}
      </button>
      <Drawer
        open={open}
        onClose={() => setOpen(false)}
        title="Notifications"
        size="default"
        extra={
          unread > 0 ? (
            <Button
              variant="secondary"
              onClick={() => mark.mutate({ all: true })}
            >
              Mark all read
            </Button>
          ) : null
        }
      >
        {items.length === 0 ? (
          <p className="text-sm text-muted-foreground">
            Nothing yet. Things that need you will show up here.
          </p>
        ) : null}
        <ul className="space-y-2">
          {items.map((n) => (
            <li key={n.id}>
              <button
                type="button"
                onClick={() => go(n)}
                className={`w-full rounded-lg border p-3 text-left text-sm ${n.read ? "border-border" : "border-primary/40 bg-primary/5"}`}
              >
                <div className="flex items-start justify-between gap-2">
                  <span className={n.read ? "" : "font-semibold"}>
                    {n.title}
                  </span>
                  {!n.read ? (
                    <span className="mt-1 size-2 shrink-0 rounded-full bg-primary" />
                  ) : null}
                </div>
                {n.body ? (
                  <p className="mt-0.5 text-muted-foreground">{n.body}</p>
                ) : null}
                <p className="mt-1 text-xs text-muted-foreground">
                  {when(n.createdAt)}
                </p>
              </button>
            </li>
          ))}
        </ul>
      </Drawer>
    </>
  );
}
