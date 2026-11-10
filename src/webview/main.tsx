import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { App as ReviewApp } from "./ReviewApp";
import { SessionApp } from "./SessionApp";
import "./styles.css";

const root = document.getElementById("root");
if (!root) throw new Error("Missing webview root element.");

const appName = root.getAttribute("data-app");

createRoot(root).render(
  <StrictMode>
    {appName === "session" ? <SessionApp /> : <ReviewApp />}
  </StrictMode>,
);
