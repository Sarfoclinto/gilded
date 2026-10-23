import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import "./index.css";
// import { env } from '@/shared/lib/env';
import { AppProviders } from "@/app/providers/AppProviders";
import App from "@/app/App";

// async function start() {
//   if (env.useMock) {
//     const { installMock } = await import('@/mock/install');
//     installMock();
//   }
createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <AppProviders>
      <App />
    </AppProviders>
  </StrictMode>,
);
// }

// void start();
