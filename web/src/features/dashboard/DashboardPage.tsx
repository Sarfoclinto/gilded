import { useAuth } from "@/features/auth/store";
import OversightHome from "./OversightHome";
import TellerHome from "./TellerHome";
import { viewFor } from "./model";

/** Home. Tellers get their working screen; managers and directors get the oversight view (the director sees a little more). */
export default function DashboardPage() {
  const user = useAuth((s) => s.user);
  const view = viewFor(user?.permissions ?? []);
  return view === "teller" ? <TellerHome /> : <OversightHome view={view} />;
}
