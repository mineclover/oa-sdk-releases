import { execFileSync } from 'node:child_process'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'

const root = resolve(import.meta.dirname, '..')
const args = process.argv.slice(2)
const releaseId = readReleaseId(args)
const trustedPublishing = args.includes('--trusted')
const manifestPath = resolve(root, 'releases', releaseId, 'manifest.json')

execFileSync(process.execPath, [resolve(root, 'scripts', 'validate-release.mjs'), '--release', releaseId], { stdio: 'inherit' })

const manifest = JSON.parse(readFileSync(manifestPath, 'utf8'))
const VERIFY_TIMEOUT_MS = readVerifyTimeout()
const pending = []

// Check every package before publishing anything, so a rerun after a propagation timeout can verify
// the already-published versions without requiring an npm token.
for (const entry of manifest.packages) {
  const existing = npmView(entry.name, entry.version)
  if (existing.state === 'found' && existing.version === entry.version) {
    console.log(`${entry.name}@${entry.version} already exists on npm; skipping re-publish.`)
    continue
  }
  if (existing.state === 'error') {
    console.log(`${entry.name}@${entry.version} registry lookup failed; will attempt publish: ${existing.details}`)
  }
  pending.push(entry)
}

if (pending.length > 0) {
  if (!trustedPublishing && !process.env.NPM_TOKEN && !process.env.NODE_AUTH_TOKEN) {
    throw new Error('NPM_TOKEN or NODE_AUTH_TOKEN must be configured as a repository or environment secret')
  }
  if (trustedPublishing) {
    console.log('Publishing with npm trusted publishing (GitHub OIDC)')
  } else {
    const publisher = npmWhoami()
    if (publisher) console.log(`npm publish identity: ${publisher}`)
    else console.log('npm whoami is unavailable for this token; continuing with the publish attempt')
  }

  // Publish everything that is missing first. Registry visibility of one package must not delay the
  // publish (and therefore the propagation clock) of the next package.
  for (const entry of pending) {
    const archive = resolve(root, 'releases', releaseId, entry.tarball)
    try {
      const publishEnv = { ...process.env }
      if (trustedPublishing) {
        delete publishEnv.NPM_TOKEN
        delete publishEnv.NODE_AUTH_TOKEN
      }
      execFileSync('npm', ['publish', archive, '--access', 'public', '--provenance'], {
        cwd: root,
        stdio: 'inherit',
        env: publishEnv,
      })
    } catch (err) {
      // A repeat publish of the exact version is the only safe "already done" case. Permission and
      // validation failures must stop the release; the 0.2.0 run used to hide them as success.
      if (err.message && err.message.includes('previously published versions')) {
        console.log(`${entry.name}@${entry.version} was already published on npm.`)
      } else {
        throw err
      }
    }
  }
} else {
  console.log('All packages are already published; verifying registry visibility only.')
}

// npm can answer from a stale cache or CDN edge right after publish. Verify every exact version is
// resolvable from the public registry, allowing enough time for registry propagation. The observed
// 2026-10-23 run took 3m 24s for tools and 6m 13s for mcp-mesh.
for (const entry of manifest.packages) {
  await verifyPublished(entry.name, entry.version)
  console.log(`Verified ${entry.name}@${entry.version} on the public registry.`)
}

async function verifyPublished(name, version) {
  const started = Date.now()
  const deadline = started + VERIFY_TIMEOUT_MS
  let attempt = 0
  let last

  while (Date.now() < deadline) {
    attempt += 1
    last = npmView(name, version)
    if (last.state === 'found' && last.version === version) {
      console.log(
        `Registry propagation for ${name}@${version} took ${formatDuration(Date.now() - started)} ` +
          `(${attempt} ${attempt === 1 ? 'check' : 'checks'}).`,
      )
      return
    }
    if (attempt === 1 || attempt % 6 === 0) {
      const status = last.state === 'missing' ? '404 (not propagated yet)' : `registry error: ${last.details}`
      console.log(`Waiting for ${name}@${version} (${formatDuration(Date.now() - started)} elapsed; ${status})`)
    }
    await new Promise(resolveDelay => setTimeout(resolveDelay, 5_000))
  }

  const reason = last?.state === 'missing' ? '404 (not propagated)' : last?.details ?? 'no registry response'
  throw new Error(
    `${name}@${version} is not resolvable from the public npm registry after ${formatDuration(Date.now() - started)} ` +
      `(${attempt} checks; last: ${reason}). The package may still be propagating; rerun the workflow to verify ` +
      'without re-publishing.',
  )
}

/** `found` carries the exact version, `missing` is a 404, and `error` is any other registry failure. */
function npmView(name, version) {
  try {
    const output = execFileSync(
      'npm',
      ['view', `${name}@${version}`, 'version', '--json', '--prefer-online', '--registry', 'https://registry.npmjs.org'],
      { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] },
    ).trim()
    return { state: 'found', version: output ? JSON.parse(output) : undefined }
  } catch (err) {
    const details = [err?.stderr, err?.stdout, err?.message]
      .filter(value => typeof value === 'string' && value.trim().length > 0)
      .join('\n')
    const notFound = /\bE404\b|\b404\b|not found|could not be found/i.test(details)
    return { state: notFound ? 'missing' : 'error', details: details || String(err) }
  }
}

function readVerifyTimeout() {
  const raw = process.env.PUBLISH_VERIFY_TIMEOUT_MS
  if (raw === undefined) return 15 * 60_000
  const value = Number(raw)
  if (!Number.isSafeInteger(value) || value < 5_000) {
    throw new Error('PUBLISH_VERIFY_TIMEOUT_MS must be an integer of at least 5000')
  }
  return value
}

function formatDuration(milliseconds) {
  const totalSeconds = Math.round(milliseconds / 1_000)
  const minutes = Math.floor(totalSeconds / 60)
  const seconds = totalSeconds % 60
  return minutes > 0 ? `${minutes}m ${seconds}s` : `${seconds}s`
}

function npmWhoami() {
  try {
    return execFileSync('npm', ['whoami', '--registry', 'https://registry.npmjs.org'], {
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'pipe'],
    }).trim()
  } catch (err) {
    // Granular tokens can be scoped so that whoami is denied while package publish is allowed.
    // Do not turn that into a release failure before the real publish attempt reports its error.
    const details = [err?.stdout, err?.stderr, err?.message]
      .filter(value => typeof value === 'string' && value.trim().length > 0)
      .join('\n')
    console.log(`npm whoami failed: ${details || String(err)}`)
    return undefined
  }
}

function readReleaseId(args) {
  const index = args.indexOf('--release')
  const value = index >= 0 ? args[index + 1] : undefined
  if (typeof value !== 'string' || !/^[a-z0-9][a-z0-9._-]*$/i.test(value)) {
    throw new Error('use --release <immutable-release-id>')
  }
  return value
}
