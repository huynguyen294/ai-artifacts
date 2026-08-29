import type { MermaidEnhancement, ShikiEnhancement } from "./enhancement-api";

type EnhancementName = "shiki" | "mermaid";
type Enhancement = ShikiEnhancement | MermaidEnhancement;

const loading = new Map<EnhancementName, Promise<Enhancement>>();

function enhancementRoot(): HTMLElement {
  const root = document.getElementById("root");
  if (!root) throw new Error("Missing webview root element.");
  return root;
}

function loadEnhancement(name: EnhancementName): Promise<Enhancement> {
  const existing = window.codexArtifactsEnhancements?.[name];
  if (existing) return Promise.resolve(existing);
  const inFlight = loading.get(name);
  if (inFlight) return inFlight;

  const root = enhancementRoot();
  const uri = name === "shiki" ? root.dataset.shikiUri : root.dataset.mermaidUri;
  const nonce = root.dataset.styleNonce;
  if (!uri || !nonce) return Promise.reject(new Error(`Missing ${name} enhancement configuration.`));

  const promise = new Promise<Enhancement>((resolve, reject) => {
    const script = document.createElement("script");
    script.src = uri;
    script.nonce = nonce;
    script.async = true;
    script.addEventListener("load", () => {
      const loaded = window.codexArtifactsEnhancements?.[name];
      if (loaded) resolve(loaded);
      else reject(new Error(`${name} enhancement did not register its API.`));
    }, { once: true });
    script.addEventListener("error", () => reject(new Error(`Failed to load ${name} enhancement.`)), { once: true });
    document.head.append(script);
  });
  loading.set(name, promise);
  return promise;
}

export function loadShiki(): Promise<ShikiEnhancement> {
  return loadEnhancement("shiki") as Promise<ShikiEnhancement>;
}

export function loadMermaid(): Promise<MermaidEnhancement> {
  return loadEnhancement("mermaid") as Promise<MermaidEnhancement>;
}

export function styleNonce(): string | undefined {
  return enhancementRoot().dataset.styleNonce;
}
