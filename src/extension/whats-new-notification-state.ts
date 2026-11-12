import { promises as fs } from "node:fs";
import path from "node:path";
import { OWNER_ONLY_DIRECTORY_MODE, OWNER_ONLY_FILE_MODE } from "../shared/artifact-files";

const NOTIFICATION_STATE_SCHEMA_VERSION = 1;
const BASELINE_FILE = "baseline.json";
const VERSIONS_DIRECTORY = "versions";
const VERSION_RECEIPT_SUFFIX = ".json";
const STABLE_SEMVER_PATTERN = /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)$/;

type ParsedStableVersion = {
  version: string;
  major: number;
  minor: number;
  patch: number;
};

function errorCode(error: unknown): string | undefined {
  return error instanceof Error && "code" in error && typeof error.code === "string"
    ? error.code
    : undefined;
}

function parseStableVersion(rawVersion: unknown): ParsedStableVersion | undefined {
  if (typeof rawVersion !== "string") {
    return undefined;
  }

  const match = STABLE_SEMVER_PATTERN.exec(rawVersion);
  if (!match) {
    return undefined;
  }

  const major = Number(match[1]);
  const minor = Number(match[2]);
  const patch = Number(match[3]);
  if (
    !Number.isSafeInteger(major)
    || !Number.isSafeInteger(minor)
    || !Number.isSafeInteger(patch)
  ) {
    return undefined;
  }

  return {
    version: rawVersion,
    major,
    minor,
    patch,
  };
}

function compareStableVersions(left: ParsedStableVersion, right: ParsedStableVersion): number {
  if (left.major !== right.major) {
    return left.major > right.major ? 1 : -1;
  }
  if (left.minor !== right.minor) {
    return left.minor > right.minor ? 1 : -1;
  }
  if (left.patch !== right.patch) {
    return left.patch > right.patch ? 1 : -1;
  }
  return 0;
}

async function assertRealDirectory(dirPath: string): Promise<void> {
  const stat = await fs.lstat(dirPath);
  if (stat.isSymbolicLink() || !stat.isDirectory()) {
    throw new Error(`Expected real directory for notification state at ${dirPath}.`);
  }
}

async function writeExclusiveJsonFile(filePath: string, payload: unknown): Promise<boolean> {
  let handle: fs.FileHandle;
  try {
    handle = await fs.open(filePath, "wx", OWNER_ONLY_FILE_MODE);
  } catch (error) {
    if (errorCode(error) === "EEXIST") {
      return false;
    }
    throw error;
  }

  let writeSucceeded = false;
  try {
    await handle.writeFile(`${JSON.stringify(payload, null, 2)}\n`, "utf8");
    writeSucceeded = true;
  } finally {
    if (writeSucceeded) {
      await handle.close();
    } else {
      await handle.close().catch(() => undefined);
    }
  }

  return true;
}

async function readAndValidateBaseline(baselinePath: string): Promise<ParsedStableVersion> {
  const stat = await fs.lstat(baselinePath);
  if (stat.isSymbolicLink() || !stat.isFile()) {
    throw new Error(`Notification baseline must be a regular file at ${baselinePath}.`);
  }

  const raw = await fs.readFile(baselinePath, "utf8");
  const parsed: unknown = JSON.parse(raw);
  if (
    typeof parsed !== "object"
    || parsed === null
    || Array.isArray(parsed)
    || !("schemaVersion" in parsed)
    || parsed.schemaVersion !== NOTIFICATION_STATE_SCHEMA_VERSION
    || !("version" in parsed)
  ) {
    throw new Error("Invalid What's New notification baseline schema.");
  }

  const parsedVersion = parseStableVersion(parsed.version);
  if (!parsedVersion) {
    throw new Error("Invalid What's New notification baseline version.");
  }

  return parsedVersion;
}

async function ensureOrReadBaseline(
  baselinePath: string,
  currentVersion: ParsedStableVersion,
): Promise<ParsedStableVersion> {
  const created = await writeExclusiveJsonFile(baselinePath, {
    schemaVersion: NOTIFICATION_STATE_SCHEMA_VERSION,
    version: currentVersion.version,
  });
  if (created) {
    return currentVersion;
  }
  return readAndValidateBaseline(baselinePath);
}

async function listObservedReceiptVersions(versionsDir: string): Promise<ParsedStableVersion[]> {
  const entries = await fs.readdir(versionsDir, { withFileTypes: true });
  const observed: ParsedStableVersion[] = [];

  for (const entry of entries) {
    if (!entry.isFile() || !entry.name.endsWith(VERSION_RECEIPT_SUFFIX)) {
      continue;
    }
    const candidateVersion = entry.name.slice(0, -VERSION_RECEIPT_SUFFIX.length);
    const parsed = parseStableVersion(candidateVersion);
    if (parsed) {
      observed.push(parsed);
    }
  }

  return observed;
}

export async function claimWhatsNewUpgradeNotification(
  storageDirectory: string,
  currentVersion: string,
  notifyEnabled: boolean,
): Promise<boolean> {
  if (typeof storageDirectory !== "string" || storageDirectory.trim().length === 0) {
    throw new Error("Notification state storage directory must be a non-empty string.");
  }

  const parsedCurrent = parseStableVersion(currentVersion);
  if (!parsedCurrent) {
    throw new Error(`Invalid stable extension version for What's New notification: ${String(currentVersion)}`);
  }

  const resolvedStorageDir = path.resolve(storageDirectory);
  const versionsDir = path.join(resolvedStorageDir, VERSIONS_DIRECTORY);
  await fs.mkdir(versionsDir, { recursive: true, mode: OWNER_ONLY_DIRECTORY_MODE });
  await assertRealDirectory(resolvedStorageDir);
  await assertRealDirectory(versionsDir);

  const baselinePath = path.join(resolvedStorageDir, BASELINE_FILE);
  const baselineVersion = await ensureOrReadBaseline(baselinePath, parsedCurrent);
  const existingReceiptVersions = await listObservedReceiptVersions(versionsDir);

  let highestObserved = baselineVersion;
  for (const candidate of existingReceiptVersions) {
    if (compareStableVersions(candidate, highestObserved) > 0) {
      highestObserved = candidate;
    }
  }

  const isUpgrade = compareStableVersions(parsedCurrent, highestObserved) > 0;
  const shouldClaim = isUpgrade && notifyEnabled;

  const receiptPath = path.join(versionsDir, `${parsedCurrent.version}${VERSION_RECEIPT_SUFFIX}`);
  const createdReceipt = await writeExclusiveJsonFile(receiptPath, {
    schemaVersion: NOTIFICATION_STATE_SCHEMA_VERSION,
    version: parsedCurrent.version,
    notificationClaimed: shouldClaim,
  });
  if (!createdReceipt) {
    return false;
  }

  return shouldClaim;
}

