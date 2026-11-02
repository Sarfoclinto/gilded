import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import "./index.css";
import { AppProviders } from "@/app/providers/AppProviders";
import App from "@/app/App";
import { startPwa } from "@/shared/pwa/pwa";
import { toast } from "@/shared/ui/toast";

void startPwa(() =>
  toast.success(
    "Gilded is stored on this device and will now open without a connection.",
  ),
);

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <AppProviders>
      <App />
    </AppProviders>
  </StrictMode>,
);
