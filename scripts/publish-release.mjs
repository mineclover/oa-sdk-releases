import { execFileSync } from 'node:child_process'
import { existsSync, readFileSync } from 'node:fs'
import { resolve } from 'node:path'

const root = resolve(import.meta.dirname, '..')
const releaseId = readReleaseId(process.argv.slice(2))
const manifestPath = resolve(root, 'releases', releaseId, 'manifest.json')

if (!process.env.NPM_TOKEN && !process.env.NODE_AUTH_TOKEN) {
  throw new Error('NPM_TOKEN or NODE_AUTH_TOKEN must be configured as a repository or environment secret')
}
execFileSync(process.execPath, [resolve(root, 'scripts/validate-release.mjs'), '--release', releaseId], { stdio: 'inherit' })
const publisher = npmWhoami()
console.log(`npm publish identity: ${publisher}`)

const manifest = JSON.parse(readFileSync(manifestPath, 'utf8'))
for (const entry of manifest.packages) {
  const existing = npmView(entry.name, entry.version)
  if (existing) throw new Error(`${entry.name}@${entry.version} already exists on npm; publish a new immutable version`)
  const archive = resolve(root, 'releases', releaseId, entry.tarball)
  execFileSync('npm', ['publish', archive, '--access', 'public', '--provenance'], {
    cwd: root,
    stdio: 'inherit',
    env: process.env,
  })
}

function npmView(name, version) {
  try {
    const output = execFileSync('npm', ['view', `${name}@${version}`, 'version', '--json'], {
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'pipe'],
    }).trim()
    return output ? JSON.parse(output) : undefined
  } catch {
    return undefined
  }
}

function npmWhoami() {
  try {
    return execFileSync('npm', ['whoami'], {
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'pipe'],
    }).trim()
  } catch {
    throw new Error('npm authentication preflight failed; configure a valid @oa-sdk publish token as NPM_TOKEN')
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
