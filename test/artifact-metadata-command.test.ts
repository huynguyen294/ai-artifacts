import { describe, expect, it, vi } from "vitest";

vi.mock("vscode", () => ({
  window: {
    showInputBox: vi.fn(),
    showQuickPick: vi.fn(),
  },
}));

import {
  promptChangeArtifactType,
  promptRenameArtifact,
} from "../src/extension/artifact-metadata-command";
import type { ArtifactStore } from "../src/extension/artifact-store";

describe("artifact-metadata-command", () => {
  describe("promptRenameArtifact", () => {
    it("prefills title, validates input, and delegates to store", async () => {
      const mockStore = {
        load: vi.fn().mockResolvedValue({ artifact: { title: "Original Title", kind: "spec" } }),
        updateMetadata: vi.fn().mockResolvedValue({ title: "New Title", kind: "spec" }),
      } as unknown as ArtifactStore;

      let validator: ((val: string) => string | null) | undefined;
      const showInputBox = vi.fn().mockImplementation(async (options: any) => {
        validator = options.validateInput;
        return "New Title";
      });

      const result = await promptRenameArtifact(mockStore, undefined, { showInputBox });

      expect(showInputBox).toHaveBeenCalledWith(
        expect.objectContaining({
          title: "Rename artifact",
          prompt: "Enter a title for this artifact",
          placeHolder: "Artifact title",
          value: "Original Title",
        }),
      );
      expect(validator?.("")).toBe("Title must not be empty.");
      expect(validator?.("   ")).toBe("Title must not be empty.");
      expect(validator?.("a".repeat(201))).toBe("Title must not exceed 200 characters.");
      expect(validator?.("Valid Title")).toBeNull();

      expect(mockStore.updateMetadata).toHaveBeenCalledWith({ title: "New Title" });
      expect(result).toEqual({ title: "New Title", kind: "spec" });
    });

    it("returns undefined and does not update metadata when user cancels", async () => {
      const mockStore = {
        load: vi.fn().mockResolvedValue({ artifact: { title: "Original Title", kind: "spec" } }),
        updateMetadata: vi.fn(),
      } as unknown as ArtifactStore;

      const showInputBox = vi.fn().mockResolvedValue(undefined);

      const result = await promptRenameArtifact(mockStore, "Pre-provided Title", { showInputBox });

      expect(result).toBeUndefined();
      expect(mockStore.updateMetadata).not.toHaveBeenCalled();
    });
  });

  describe("promptChangeArtifactType", () => {
    it("displays fixed kinds, discovered open kinds, and Current indicator, updating on selection", async () => {
      const mockStore = {
        load: vi.fn().mockResolvedValue({ artifact: { title: "Title", kind: "plan" } }),
        updateMetadata: vi.fn().mockResolvedValue({ title: "Title", kind: "guide" }),
      } as unknown as ArtifactStore;

      const mockDiscover = vi.fn().mockResolvedValue({
        artifacts: [
          { kind: "meeting-note" },
          { kind: "architecture-decision" },
          { kind: "plan" }, // fixed kind, shouldn't duplicate
        ],
        skippedCount: 0,
      });

      let pickedItems: any[] = [];
      const showQuickPick = vi.fn().mockImplementation(async (items: any[]) => {
        pickedItems = items;
        // Select 'guide'
        return items.find((item) => item.kindSlug === "guide");
      });

      const result = await promptChangeArtifactType(mockStore, {}, undefined, {
        showQuickPick,
        discoverArtifacts: mockDiscover,
      });

      expect(showQuickPick).toHaveBeenCalled();
      // Verify fixed kind 'plan' is marked Current
      const planItem = pickedItems.find((item) => item.kindSlug === "plan");
      expect(planItem?.description).toBe("plan (Current)");

      // Verify discovered open kinds are present and sorted
      const customItem = pickedItems.find((item) => item.kindSlug === "meeting-note");
      expect(customItem).toBeDefined();
      expect(customItem?.label).toBe("Meeting note");

      // Verify Create new type item is present
      const createItem = pickedItems.find((item) => item.kindSlug === "__CREATE_NEW__");
      expect(createItem).toBeDefined();

      expect(mockStore.updateMetadata).toHaveBeenCalledWith({ kind: "guide" });
      expect(result).toEqual({ title: "Title", kind: "guide" });
    });

    it("supports creating a new custom type with validation", async () => {
      const mockStore = {
        load: vi.fn().mockResolvedValue({ artifact: { title: "Title", kind: "spec" } }),
        updateMetadata: vi.fn().mockResolvedValue({ title: "Title", kind: "incident-postmortem" }),
      } as unknown as ArtifactStore;

      const showQuickPick = vi.fn().mockImplementation(async (items: any[]) => {
        return items.find((item) => item.kindSlug === "__CREATE_NEW__");
      });

      let inputValidator: ((val: string) => string | null) | undefined;
      const showInputBox = vi.fn().mockImplementation(async (options: any) => {
        inputValidator = options.validateInput;
        return "incident-postmortem";
      });

      const result = await promptChangeArtifactType(mockStore, {}, "spec", {
        showQuickPick,
        showInputBox,
        discoverArtifacts: vi.fn().mockResolvedValue({ artifacts: [], skippedCount: 0 }),
      });

      expect(showInputBox).toHaveBeenCalledWith(
        expect.objectContaining({
          title: "Create artifact type",
          prompt: "Enter a type in lowercase, using hyphens between words",
          placeHolder: "meeting-note",
        }),
      );

      expect(inputValidator?.("Incident Postmortem")).toContain("Type must be lowercase");
      expect(inputValidator?.("incident_postmortem")).toContain("Type must be lowercase");
      expect(inputValidator?.("incident-postmortem")).toBeNull();

      expect(mockStore.updateMetadata).toHaveBeenCalledWith({ kind: "incident-postmortem" });
      expect(result).toEqual({ title: "Title", kind: "incident-postmortem" });
    });

    it("returns undefined if picker is cancelled or create new input is cancelled", async () => {
      const mockStore = {
        load: vi.fn().mockResolvedValue({ artifact: { title: "Title", kind: "spec" } }),
        updateMetadata: vi.fn(),
      } as unknown as ArtifactStore;

      // Picker cancelled
      const showQuickPickCancelled = vi.fn().mockResolvedValue(undefined);
      const res1 = await promptChangeArtifactType(mockStore, {}, "spec", {
        showQuickPick: showQuickPickCancelled,
        discoverArtifacts: vi.fn().mockResolvedValue({ artifacts: [], skippedCount: 0 }),
      });
      expect(res1).toBeUndefined();
      expect(mockStore.updateMetadata).not.toHaveBeenCalled();

      // Create new cancelled
      const showQuickPickCreate = vi.fn().mockImplementation(async (items: any[]) => {
        return items.find((item) => item.kindSlug === "__CREATE_NEW__");
      });
      const showInputBoxCancelled = vi.fn().mockResolvedValue(undefined);
      const res2 = await promptChangeArtifactType(mockStore, {}, "spec", {
        showQuickPick: showQuickPickCreate,
        showInputBox: showInputBoxCancelled,
        discoverArtifacts: vi.fn().mockResolvedValue({ artifacts: [], skippedCount: 0 }),
      });
      expect(res2).toBeUndefined();
      expect(mockStore.updateMetadata).not.toHaveBeenCalled();
    });
  });
});
