import React from "react";
import ReactDOM from "react-dom/client";
import "../../styles/app.css";
import { SafeErrorBoundary } from "../../components/ui.tsx";
import { DashboardApp } from "./DashboardApp.tsx";

ReactDOM.createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <SafeErrorBoundary>
      <DashboardApp />
    </SafeErrorBoundary>
  </React.StrictMode>
);
