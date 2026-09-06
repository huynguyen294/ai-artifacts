import { describe, expect, it } from "vitest";
import { shouldSubmitCommentOnKeyDown } from "../src/webview/SelectionCommentPopover";

describe("SelectionCommentPopover keyboard behavior", () => {
  it.each([
    { name: "plain Enter", key: "Enter", shiftKey: false, isComposing: false, body: "Send this", expected: true },
    { name: "Shift+Enter", key: "Enter", shiftKey: true, isComposing: false, body: "Keep editing", expected: false },
    { name: "IME composition", key: "Enter", shiftKey: false, isComposing: true, body: "Tiếng Việt", expected: false },
    { name: "blank body", key: "Enter", shiftKey: false, isComposing: false, body: "   ", expected: false },
    { name: "another key", key: "a", shiftKey: false, isComposing: false, body: "Keep editing", expected: false },
  ])("returns $expected for $name", ({ key, shiftKey, isComposing, body, expected }) => {
    expect(shouldSubmitCommentOnKeyDown({ key, shiftKey, isComposing, body })).toBe(expected);
  });
});
