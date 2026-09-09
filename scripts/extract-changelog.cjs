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

function getPreviousReleaseTag() {
  // Allow manual override via env (useful for testing or workflow_dispatch inputs)
  if (process.env.PREVIOUS_RELEASE_TAG) {
    const override = process.env.PREVIOUS_RELEASE_TAG.trim();
    console.log(`[extract-changelog] Using PREVIOUS_RELEASE_TAG override: ${override}`);
    return override;
  }

  // 1. Try GitHub CLI (fetches the latest release published on GitHub)
  try {
    const ghOutput = execSync('gh release list --exclude-drafts --limit 1 --json tagName -q ".[0].tagName"', {
      encoding: 'utf8',
      stdio: ['pipe', 'pipe', 'ignore'],
    }).trim();
    if (ghOutput && ghOutput !== 'null') {
      console.log(`[extract-changelog] Found previous GitHub release: ${ghOutput}`);
      return ghOutput;
    }
  } catch {
    // Ignore gh command failures (e.g. offline, unauthenticated, or no releases yet)
  }

  // 2. Try git tags (from git history)
  const currentTag = process.env.GITHUB_REF_NAME || '';
  if (currentTag) {
    try {
      const gitOutput = execSync(`git describe --tags --abbrev=0 "${currentTag}^"`, {
        encoding: 'utf8',
        stdio: ['pipe', 'pipe', 'ignore'],
      }).trim();
      if (gitOutput && gitOutput !== 'null') {
        console.log(`[extract-changelog] Found previous git tag: ${gitOutput}`);
        return gitOutput;
      }
    } catch {
      // Ignore git describe failures (e.g. no prior tags)
    }
  }

  console.log('[extract-changelog] No previous release or tag found. Extracting target version section.');
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
  const changelogPath = path.resolve(__dirname, '../CHANGE_LOGS.md');
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
    console.warn(`[extract-changelog] Could not find section for version [${version}] in CHANGE_LOGS.md`);
    fs.writeFileSync(outputPath, `Release ${process.env.GITHUB_REF_NAME || version}\n`, 'utf8');
    return;
  }

  const previousTag = getPreviousReleaseTag();
  let endIndex = -1;

  if (previousTag) {
    const previousVersion = previousTag.replace(/^v/, '');
    if (previousVersion !== version) {
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
      }
    }
  }

  // Fallback: If no previous tag, or previous tag was not found in changelog, or previousVersion === version:
  // Cut before the next version header (## [...) or divider (---)
  if (endIndex === -1) {
    const afterStart = content.slice(startIndex + 1);
    const nextHeaderMatch = afterStart.search(/\n##\s+\[/);
    if (nextHeaderMatch !== -1) {
      const nextHeaderIndex = startIndex + 1 + nextHeaderMatch;
      const beforeNext = content.slice(startIndex, nextHeaderIndex);
      const lastDivider = beforeNext.lastIndexOf('\n---');
      if (lastDivider !== -1 && lastDivider > 0) {
        endIndex = startIndex + lastDivider;
      } else {
        endIndex = nextHeaderIndex;
      }
    } else {
      endIndex = content.length;
    }
  }

  let notes = content.slice(startIndex, endIndex).trim();

  // Strip trailing divider if exists
  notes = notes.replace(/\n---\s*$/, '').trim();

  fs.writeFileSync(outputPath, notes + '\n', 'utf8');

  console.log(`[extract-changelog] Successfully extracted release notes for ${version} (since previous: ${previousTag || 'initial version'}):`);
  console.log('--------------------------------------------------');
  console.log(notes.slice(0, 400) + (notes.length > 400 ? '\n... [truncated in log] ...' : ''));
  console.log('--------------------------------------------------');
  console.log(`Total length: ${notes.length} characters.`);
}

extractChangelog();
