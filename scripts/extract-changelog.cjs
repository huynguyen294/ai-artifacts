const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');

function getTargetVersion() {
  const inputTag = (process.env.INPUT_TAG || process.env.TARGET_TAG || '').trim();
  if (inputTag) {
    return inputTag.replace(/^v/, '');
  }
  const refName = (process.env.GITHUB_REF_NAME || '').trim();
  if (refName.startsWith('v')) {
    return refName.slice(1);
  }
  if (refName && /^\d+\.\d+\.\d+/.test(refName)) {
    return refName;
  }
  // Fallback to package.json version
  try {
    const pkg = JSON.parse(fs.readFileSync(path.resolve(__dirname, '../package.json'), 'utf8'));
    return (pkg.version || '').trim();
  } catch (err) {
    return '';
  }
}

function getPreviousReleaseTag(targetVersion) {
  // Allow manual override via env (useful for testing or workflow_dispatch inputs)
  if (process.env.PREVIOUS_RELEASE_TAG) {
    const override = process.env.PREVIOUS_RELEASE_TAG.trim();
    console.log(`[extract-changelog] Using PREVIOUS_RELEASE_TAG override: ${override}`);
    return override;
  }

  const cleanTarget = (targetVersion || '').replace(/^v/, '');

  // 1. Try GitHub CLI (fetches releases and finds the latest release prior to current target version)
  try {
    const ghJson = execSync('gh release list --exclude-drafts --limit 30 --json tagName', {
      encoding: 'utf8',
      stdio: ['pipe', 'pipe', 'ignore'],
    }).trim();
    if (ghJson) {
      const releases = JSON.parse(ghJson);
      if (Array.isArray(releases)) {
        const prev = releases.find((r) => (r.tagName || '').replace(/^v/, '') !== cleanTarget);
        if (prev?.tagName) {
          console.log(`[extract-changelog] Found previous GitHub release: ${prev.tagName}`);
          return prev.tagName;
        }
      }
    }
  } catch {
    // Ignore gh command failures (e.g. offline, unauthenticated, or no releases yet)
  }

  // 2. Try git tags (from git history, ignoring current target version)
  try {
    const tagList = execSync('git tag --sort=-creatordate', {
      encoding: 'utf8',
      stdio: ['pipe', 'pipe', 'ignore'],
    }).trim();
    if (tagList) {
      const tags = tagList.split(/\r?\n/).map((t) => t.trim()).filter(Boolean);
      const prev = tags.find((t) => t.replace(/^v/, '') !== cleanTarget);
      if (prev) {
        console.log(`[extract-changelog] Found previous git tag: ${prev}`);
        return prev;
      }
    }
  } catch {
    // Ignore git tag failures
  }

  console.log(`[extract-changelog] No previous release or tag found (prior to ${targetVersion}). Initial release: extracting all versions up to target version.`);
  return null;
}

function findHeaderIndex(content, version, fromIndex = 0) {
  if (!version) return -1;
  const cleanVersion = version.replace(/^v/, '');
  const targetHeader = `## [${cleanVersion}]`;
  const targetHeaderWithV = `## [v${cleanVersion}]`;

  let idx = content.indexOf(targetHeader, fromIndex);
  if (idx === -1) {
    idx = content.indexOf(targetHeaderWithV, fromIndex);
  }
  return idx;
}

function extractChangelog() {
  const version = getTargetVersion();
  const changelogPath = path.resolve(__dirname, '../CHANGELOG.md');
  const outputPath = path.resolve(__dirname, '../RELEASE_NOTES.md');

  // Export RELEASE_TAG to GITHUB_ENV so subsequent workflow steps can use it
  if (process.env.GITHUB_ENV && version) {
    const targetTag = version.startsWith('v') ? version : `v${version}`;
    try {
      fs.appendFileSync(process.env.GITHUB_ENV, `RELEASE_TAG=${targetTag}\n`, 'utf8');
      console.log(`[extract-changelog] Exported RELEASE_TAG=${targetTag} to GITHUB_ENV`);
    } catch (envErr) {
      console.warn('[extract-changelog] Failed to export RELEASE_TAG to GITHUB_ENV:', envErr);
    }
  }

  if (!fs.existsSync(changelogPath)) {
    console.warn(`[extract-changelog] File not found: ${changelogPath}`);
    fs.writeFileSync(outputPath, `Release ${process.env.GITHUB_REF_NAME || version}\n`, 'utf8');
    return;
  }

  const content = fs.readFileSync(changelogPath, 'utf8');

  // Start index at target version header
  const startIndex = findHeaderIndex(content, version);
  if (startIndex === -1) {
    console.warn(`[extract-changelog] Could not find section for version [${version}] in CHANGELOG.md`);
    fs.writeFileSync(outputPath, `Release ${process.env.GITHUB_REF_NAME || version}\n`, 'utf8');
    return;
  }

  const previousTag = getPreviousReleaseTag(version);
  let endIndex = -1;

  if (previousTag) {
    const previousVersion = previousTag.replace(/^v/, '');
    const prevHeaderIndex = findHeaderIndex(content, previousVersion, startIndex + 1);
    if (prevHeaderIndex !== -1) {
      // Cut before the previous header, or before any preceding "---" divider
      const beforePrev = content.slice(startIndex, prevHeaderIndex);
      const lastDivider = beforePrev.lastIndexOf('\n---');
      if (lastDivider !== -1 && lastDivider > 0) {
        endIndex = startIndex + lastDivider;
      } else {
        endIndex = prevHeaderIndex;
      }
    } else {
      endIndex = content.length;
    }
  } else {
    // Initial release scenario: no previous release/tag exists yet on GitHub
    // Extract all versions from target version down to the end of the changelog
    endIndex = content.length;
  }

  let notes = content.slice(startIndex, endIndex).trim();

  // Strip trailing divider if exists
  notes = notes.replace(/\n---\s*$/, '').trim();

  fs.writeFileSync(outputPath, notes + '\n', 'utf8');

  console.log(`[extract-changelog] Successfully extracted release notes for ${version} (since previous: ${previousTag || 'initial release'}):`);
  console.log('--------------------------------------------------');
  console.log(notes.slice(0, 400) + (notes.length > 400 ? '\n... [truncated in log] ...' : ''));
  console.log('--------------------------------------------------');
  console.log(`Total length: ${notes.length} characters.`);
}

extractChangelog();
