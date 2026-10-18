/**
 * Browser-compatible shim for node:crypto used exclusively by dev host
 * to enable src/shared/markdown-blocks.ts to run in browser without Node.js.
 */
export function createHash(_algorithm: string) {
  let buffer = "";
  return {
    update(data: string) {
      buffer += data;
      return this;
    },
    digest(_encoding?: string) {
      // 32-bit FNV-1a / DJB2 hash generator returning hex string
      let h1 = 0xdeadbeef;
      let h2 = 0x41c64e6d;
      for (let i = 0; i < buffer.length; i++) {
        const ch = buffer.charCodeAt(i);
        h1 = Math.imul(h1 ^ ch, 2654435761);
        h2 = Math.imul(h2 ^ ch, 1597334677);
      }
      h1 = Math.imul(h1 ^ (h1 >>> 16), 2246822507);
      h1 ^= Math.imul(h2 ^ (h2 >>> 13), 3266489909);
      h2 = Math.imul(h2 ^ (h2 >>> 16), 2246822507);
      h2 ^= Math.imul(h1 ^ (h1 >>> 13), 3266489909);
      const hex1 = (h1 >>> 0).toString(16).padStart(8, "0");
      const hex2 = (h2 >>> 0).toString(16).padStart(8, "0");
      return (hex1 + hex2).repeat(4);
    },
  };
}

export function randomUUID(): string {
  if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") {
    return crypto.randomUUID();
  }
  return "xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx".replace(/[xy]/g, (c) => {
    const r = (Math.random() * 16) | 0;
    const v = c === "x" ? r : (r & 0x3) | 0x8;
    return v.toString(16);
  });
}
