import * as vscode from "vscode";
import { FIXED_ARTIFACT_KINDS, formatArtifactKindLabel } from "../shared/artifact-kinds";
import { artifactKindSchema } from "../shared/contracts";
import type { GlobalArtifactsRootOptions } from "../shared/artifact-files";
import { discoverSearchableArtifacts } from "./artifact-search";
import type { ArtifactStore } from "./artifact-store";

export interface ArtifactMetadataControllerDeps {
  showInputBox?: typeof vscode.window.showInputBox;
  showQuickPick?: typeof vscode.window.showQuickPick;
  discoverArtifacts?: typeof discoverSearchableArtifacts;
}

export async function promptRenameArtifact(
  store: ArtifactStore,
  currentTitle?: string,
  deps: ArtifactMetadataControllerDeps = {},
): Promise<{ title: string; kind: string } | undefined> {
  const showInput = deps.showInputBox ?? vscode.window.showInputBox;

  let initialTitle = currentTitle;
  if (!initialTitle) {
    try {
      const state = await store.load();
      initialTitle = state.artifact.title;
    } catch {
      initialTitle = "";
    }
  }

  const result = await showInput({
    title: "Rename artifact",
    prompt: "Enter a title for this artifact",
    placeHolder: "Artifact title",
    value: initialTitle,
    validateInput: (value) => {
      const trimmed = value.trim();
      if (trimmed.length < 1) {
        return "Title must not be empty.";
      }
      if (trimmed.length > 200) {
        return "Title must not exceed 200 characters.";
      }
      return null;
    },
  });

  if (result === undefined) {
    return undefined;
  }

  const trimmed = result.trim();
  return store.updateMetadata({ title: trimmed });
}

export async function promptChangeArtifactType(
  store: ArtifactStore,
  options: GlobalArtifactsRootOptions = {},
  currentKind?: string,
  deps: ArtifactMetadataControllerDeps = {},
): Promise<{ title: string; kind: string } | undefined> {
  const showInput = deps.showInputBox ?? vscode.window.showInputBox;
  const showQuickPick = deps.showQuickPick ?? vscode.window.showQuickPick;
  const discover = deps.discoverArtifacts ?? discoverSearchableArtifacts;

  let effectiveCurrentKind = currentKind;
  if (!effectiveCurrentKind) {
    try {
      const state = await store.load();
      effectiveCurrentKind = state.artifact.kind;
    } catch {
      effectiveCurrentKind = "";
    }
  }

  // 1. Fixed kinds
  const fixedSet = new Set<string>(FIXED_ARTIFACT_KINDS);
  const fixedItems = FIXED_ARTIFACT_KINDS.map((kind) => {
    const isCurrent = kind === effectiveCurrentKind;
    return {
      label: formatArtifactKindLabel(kind),
      description: isCurrent ? `${kind} (Current)` : kind,
      kindSlug: kind,
    };
  });

  // 2. Discovered open kinds
  const openKindsSet = new Set<string>();
  try {
    const discovery = await discover(options);
    for (const art of discovery.artifacts) {
      if (art.kind && !fixedSet.has(art.kind)) {
        openKindsSet.add(art.kind);
      }
    }
  } catch (error) {
    console.warn("[promptChangeArtifactType] Failed to discover artifacts:", error);
  }

  // Include current kind if open
  if (effectiveCurrentKind && !fixedSet.has(effectiveCurrentKind)) {
    openKindsSet.add(effectiveCurrentKind);
  }

  const openKinds = Array.from(openKindsSet).sort();
  const openItems = openKinds.map((kind) => {
    const isCurrent = kind === effectiveCurrentKind;
    return {
      label: formatArtifactKindLabel(kind),
      description: isCurrent ? `${kind} (Current)` : kind,
      kindSlug: kind,
    };
  });

  const createItem = {
    label: "$(add) Create new type...",
    description: "Enter a custom type slug",
    kindSlug: "__CREATE_NEW__",
  };

  const pickItems = [
    ...fixedItems,
    ...openItems,
    createItem,
  ];

  const selected = await showQuickPick(pickItems, {
    title: "Change artifact type",
    placeHolder: "Select a type or create a new one",
  });

  if (!selected) {
    return undefined;
  }

  if (selected.kindSlug !== "__CREATE_NEW__") {
    return store.updateMetadata({ kind: selected.kindSlug });
  }

  // Create new type flow
  const newTypeInput = await showInput({
    title: "Create artifact type",
    prompt: "Enter a type in lowercase, using hyphens between words",
    placeHolder: "meeting-note",
    validateInput: (value) => {
      const trimmed = value.trim();
      const parseResult = artifactKindSchema.safeParse(trimmed);
      if (!parseResult.success) {
        return "Type must be lowercase and contain only letters, numbers, and hyphens (e.g. meeting-note).";
      }
      return null;
    },
  });

  if (newTypeInput === undefined) {
    return undefined;
  }

  const trimmedSlug = newTypeInput.trim();
  return store.updateMetadata({ kind: trimmedSlug });
}

