import { useEffect, useState } from "react";
import type { SessionExtensionToWebviewMessage, WorkSessionViewData } from "../shared/contracts";
import { vscode } from "./vscode-api";

export type SessionAppState =
  | { status: "loading" }
  | { status: "ready"; data: WorkSessionViewData }
  | { status: "error"; message: string };

export function SessionApp() {
  const [state, setState] = useState<SessionAppState>({ status: "loading" });

  useEffect(() => {
    const handleMessage = (event: MessageEvent<SessionExtensionToWebviewMessage>) => {
      const msg = event.data;
      if (!msg) return;

      if (msg.type === "workSessionState") {
        if (msg.state.status === "ready") {
          setState({ status: "ready", data: msg.state.data });
        } else {
          setState({ status: "error", message: msg.state.message });
        }
      } else if (msg.type === "error") {
        setState({ status: "error", message: msg.message });
      }
    };

    window.addEventListener("message", handleMessage);
    vscode.postMessage({ type: "ready" });

    return () => {
      window.removeEventListener("message", handleMessage);
    };
  }, []);

  if (state.status === "loading") {
    return (
      <div className="session-app loading">
        <div className="session-status-text">Đang tải phiên làm việc...</div>
      </div>
    );
  }

  if (state.status === "error") {
    return (
      <div className="session-app error">
        <div className="session-error-banner">
          <h3>Lỗi tải phiên làm việc</h3>
          <p>{state.message}</p>
        </div>
      </div>
    );
  }

  const { data } = state;

  const renderZone = (title: string, zoneKey: "working" | "references" | "archived", items: typeof data.working) => {
    return (
      <section className={`session-zone session-zone-${zoneKey}`}>
        <div className="session-zone-header">
          <h4>
            {title} <span className="session-zone-count">({items.length})</span>
          </h4>
        </div>
        {items.length === 0 ? (
          <div className="session-zone-empty">Không có artifact trong vùng này</div>
        ) : (
          <div className="session-artifact-list">
            {items.map((artifact) => (
              <div
                key={artifact.artifactId}
                className={`session-artifact-card ${artifact.unavailable ? "session-artifact-card-unavailable" : ""}`}
                onClick={() => {
                  if (artifact.unavailable) return;
                  vscode.postMessage({ type: "openArtifact", artifactId: artifact.artifactId });
                }}
                role="button"
                tabIndex={artifact.unavailable ? -1 : 0}
                aria-disabled={artifact.unavailable ? true : undefined}
                onKeyDown={(e) => {
                  if (artifact.unavailable) return;
                  if (e.key === "Enter" || e.key === " ") {
                    vscode.postMessage({ type: "openArtifact", artifactId: artifact.artifactId });
                  }
                }}
              >
                <div className="session-card-main">
                  <span className="session-card-title">{artifact.title}</span>
                  {artifact.unavailable ? (
                    <span className="session-card-unavailable-badge">Không khả dụng</span>
                  ) : (
                    <span className="session-card-kind-badge">{artifact.kind}</span>
                  )}
                </div>
                <div className="session-card-meta">
                  <span className="session-card-updated">{artifact.updatedAt}</span>
                  <span className="session-card-id">{artifact.artifactId}</span>
                </div>
              </div>
            ))}
          </div>
        )}
      </section>
    );
  };

  return (
    <div className="session-app-container">
      <header className="session-header">
        <div className="session-header-top">
          <h2 className="session-title">{data.title}</h2>
          <span className="session-type-badge">{data.typeLabel}</span>
        </div>
        <div className="session-header-meta">
          <span>Cập nhật: {data.updatedAt}</span>
          <span>·</span>
          <span>Tạo lúc: {data.createdAt}</span>
        </div>
      </header>

      {data.instructions.trim().length > 0 && (
        <section className="session-instructions-section">
          <h4>Hướng dẫn</h4>
          <div className="session-instructions-content">
            <pre className="session-instructions-markdown">{data.instructions}</pre>
          </div>
        </section>
      )}

      <main className="session-zones-container">
        {renderZone("Working", "working", data.working)}
        {renderZone("References", "references", data.references)}
        {renderZone("Archived", "archived", data.archived)}
      </main>
    </div>
  );
}
