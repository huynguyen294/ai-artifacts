export const WHATS_NEW_HIGHEST_OBSERVED_VERSION_KEY = "whatsNew.highestObservedVersion";

/** The standard get/update methods supplied by context.globalState. */
export interface WhatsNewVersionState {
  get(key: string): unknown;
  update(key: string, value: string): PromiseLike<void>;
}

const STABLE_SEMVER_PATTERN = /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)$/;

type ParsedStableVersion = {
  major: number;
  minor: number;
  patch: number;
};

function parseStableVersion(rawVersion: unknown): ParsedStableVersion | undefined {
  if (typeof rawVersion !== "string") return undefined;
  const match = STABLE_SEMVER_PATTERN.exec(rawVersion);
  if (!match) return undefined;
  const [major, minor, patch] = match.slice(1).map(Number);
  if (![major, minor, patch].every(Number.isSafeInteger)) return undefined;
  return { major: major!, minor: minor!, patch: patch! };
}

function compareStableVersions(left: ParsedStableVersion, right: ParsedStableVersion): number {
  return left.major - right.major || left.minor - right.minor || left.patch - right.patch;
}

/** Records before notification UI; no cross-window atomic claim is attempted. */
export async function recordWhatsNewVersion(
  state: WhatsNewVersionState,
  currentVersion: string,
  notifyEnabled: boolean,
  existingIntegration = false,
): Promise<boolean> {
  const current = parseStableVersion(currentVersion);
  if (!current) {
    throw new Error("Invalid stable extension version for What's New notification: " + String(currentVersion));
  }

  const rawPrevious = state.get(WHATS_NEW_HIGHEST_OBSERVED_VERSION_KEY);
  const previous = rawPrevious === undefined ? undefined : parseStableVersion(rawPrevious);
  if (rawPrevious !== undefined && !previous) {
    throw new Error("Invalid stored What's New extension version.");
  }
  if (previous && compareStableVersions(current, previous) <= 0) return false;

  await state.update(WHATS_NEW_HIGHEST_OBSERVED_VERSION_KEY, currentVersion);
  return notifyEnabled && (previous !== undefined || existingIntegration);
}
