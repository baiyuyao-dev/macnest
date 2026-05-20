import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import TrayPopup from "@/pages/TrayPopup";
import "./styles.css";

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <TrayPopup />
  </StrictMode>
);
