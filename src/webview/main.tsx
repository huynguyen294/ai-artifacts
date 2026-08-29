import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { App } from "./ReviewApp";
import "./styles.css";

const root = document.getElementById("root");
if (!root) throw new Error("Missing webview root element.");

createRoot(root).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
