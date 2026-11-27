import React from "react";
import ReactDOM from "react-dom/client";
import "../../styles/app.css";
import { SafeErrorBoundary } from "../../components/ui.tsx";
import { PopupApp } from "./PopupApp.tsx";

ReactDOM.createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <SafeErrorBoundary>
      <PopupApp />
    </SafeErrorBoundary>
  </React.StrictMode>
);
