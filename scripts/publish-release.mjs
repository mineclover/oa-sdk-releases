import { execFileSync } from 'node:child_process'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'

const root = resolve(import.meta.dirname, '..')
const releaseId = readReleaseId(process.argv.slice(2))
const manifestPath = resolve(root, 'releases', releaseId, 'manifest.json')

if (!process.env.NPM_TOKEN && !process.env.NODE_AUTH_TOKEN) {
  throw new Error('NPM_TOKEN or NODE_AUTH_TOKEN must be configured as a repository or environment secret')
}
execFileSync(process.execPath, [resolve(root, 'scripts', 'validate-release.mjs'), '--release', releaseId], { stdio: 'inherit' })
const publisher = npmWhoami()
if (publisher) console.log(`npm publish identity: ${publisher}`)
else console.log('npm whoami is unavailable for this token; continuing with the publish attempt')

const manifest = JSON.parse(readFileSync(manifestPath, 'utf8'))
for (const entry of manifest.packages) {
  const existing = npmView(entry.name, entry.version)
  if (existing) {
    console.log(`${entry.name}@${entry.version} already exists on npm; skipping re-publish.`)
  } else {
    const archive = resolve(root, 'releases', releaseId, entry.tarball)
    try {
      execFileSync('npm', ['publish', archive, '--access', 'public', '--provenance'], {
        cwd: root,
        stdio: 'inherit',
        env: process.env,
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

  // npm can answer from a stale cache or CDN edge right after publish. Verify the exact version is
  // resolvable from the public registry, retrying long enough for propagation.
  await verifyPublished(entry.name, entry.version)
  console.log(`Verified ${entry.name}@${entry.version} on the public registry.`)
}

async function verifyPublished(name, version) {
  const deadline = Date.now() + 5 * 60_000
  let last
  while (Date.now() < deadline) {
    last = npmView(name, version)
    if (last === version) return
    await new Promise(resolve => setTimeout(resolve, 5_000))
  }
  throw new Error(`${name}@${version} is not resolvable from the public npm registry after 5 minutes`)
}

function npmView(name, version) {
  try {
    const output = execFileSync(
      'npm',
      ['view', `${name}@${version}`, 'version', '--json', '--prefer-online', '--registry', 'https://registry.npmjs.org'],
      { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] },
    ).trim()
    return output ? JSON.parse(output) : undefined
  } catch {
    return undefined
  }
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
