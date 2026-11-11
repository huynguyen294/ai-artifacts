import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { App as ReviewApp } from "./ReviewApp";
import { SessionApp } from "./SessionApp";
import { WhatsNewApp } from "./WhatsNewApp";
import "./styles.css";

const root = document.getElementById("root");
if (!root) throw new Error("Missing webview root element.");

const appName = root.getAttribute("data-app");
const mediaBaseUri = root.getAttribute("data-content-media-base-uri") ?? "";

createRoot(root).render(
  <StrictMode>
    {appName === "session" ? (
      <SessionApp />
    ) : appName === "whats-new" ? (
      <WhatsNewApp mediaBaseUri={mediaBaseUri} />
    ) : (
      <ReviewApp />
    )}
  </StrictMode>,
);
