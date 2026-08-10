import { createHash } from 'node:crypto'
import { existsSync, readFileSync } from 'node:fs'
import { resolve, relative, sep } from 'node:path'
import { execFileSync } from 'node:child_process'

const root = resolve(import.meta.dirname, '..')
const releaseId = readReleaseId(process.argv.slice(2))
const releaseDirectory = resolve(root, 'releases', releaseId)
const manifestPath = resolve(releaseDirectory, 'manifest.json')
const policy = readJson(resolve(root, 'release-policy.json'))
const manifest = readJson(manifestPath)

assert(manifest.schemaVersion === 1, 'manifest.schemaVersion must be 1')
assert(manifest.releaseId === releaseId, 'manifest.releaseId must match its directory name')
assert(typeof manifest.sourceRevision === 'string' && /^[0-9a-f]{40}$/i.test(manifest.sourceRevision), 'manifest.sourceRevision must be a Git SHA')
assert(Array.isArray(manifest.packages) && manifest.packages.length > 0, 'manifest.packages must be non-empty')

const expectedRepository = policy.repository
const allowedCandidates = new Set(policy.distributionCandidates)
const names = new Set()
const versions = new Set()

for (const entry of manifest.packages) {
  assert(allowedCandidates.has(entry.name), `package is not a distribution candidate: ${entry.name}`)
  assert(typeof entry.version === 'string' && /^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?$/.test(entry.version), `${entry.name}: invalid version`)
  assert(!names.has(entry.name), `duplicate package: ${entry.name}`)
  assert(!versions.has(`${entry.name}@${entry.version}`), `duplicate package version: ${entry.name}@${entry.version}`)
  names.add(entry.name)
  versions.add(`${entry.name}@${entry.version}`)

  const archivePath = resolveInsideRelease(entry.tarball)
  assert(existsSync(archivePath), `${entry.name}: missing tarball ${entry.tarball}`)
  assert(sha512(archivePath) === entry.integrity, `${entry.name}: tarball integrity mismatch`)

  const files = execFileSync('tar', ['-tzf', archivePath], { encoding: 'utf8' })
    .trim()
    .split('\n')
    .filter(Boolean)
  assert(files.length > 0, `${entry.name}: empty tarball`)
  for (const file of files) assertAllowedPath(file, entry.name)

  const packageJson = JSON.parse(execFileSync('tar', ['-xOf', archivePath, 'package/package.json'], { encoding: 'utf8' }))
  assert(packageJson.name === entry.name, `${entry.name}: package.json name mismatch`)
  assert(packageJson.version === entry.version, `${entry.name}: package.json version mismatch`)
  assert(packageJson.private !== true, `${entry.name}: package.json must be publishable`)
  assert(packageJson.repository?.url === `git+${expectedRepository}`, `${entry.name}: repository.url must point at oa-sdk-releases`)
  assert(packageJson.license === 'Apache-2.0', `${entry.name}: license must be Apache-2.0`)
}

console.log(`Release ${releaseId} is structurally valid: ${manifest.packages.length} package artifact(s).`)

function readReleaseId(args) {
  const index = args.indexOf('--release')
  const value = index >= 0 ? args[index + 1] : undefined
  assert(typeof value === 'string' && /^[a-z0-9][a-z0-9._-]*$/i.test(value), 'use --release <immutable-release-id>')
  return value
}

function readJson(path) {
  assert(existsSync(path), `missing ${relative(root, path)}`)
  return JSON.parse(readFileSync(path, 'utf8'))
}

function resolveInsideRelease(path) {
  assert(typeof path === 'string' && path.startsWith('packages/'), 'tarball must be under packages/')
  const resolved = resolve(releaseDirectory, path)
  assert(resolved.startsWith(`${releaseDirectory}${sep}`), 'tarball must stay inside the release directory')
  return resolved
}

function sha512(path) {
  return `sha512-${createHash('sha512').update(readFileSync(path)).digest('base64')}`
}

function assertAllowedPath(path, packageName) {
  const allowed = path === 'package/package.json'
    || path === 'package/README.md'
    || path === 'package/LICENSE'
    || path.startsWith('package/dist/')
    || path.startsWith('package/lib/')
  assert(allowed, `${packageName}: forbidden tarball path ${path}`)
  assert(!path.includes('/src/') && !path.includes('/__tests__/') && !path.includes('.test.') && !path.includes('.spec.'), `${packageName}: source or test file is not allowed: ${path}`)
  assert(!path.endsWith('.map'), `${packageName}: source map is not allowed: ${path}`)
}

function assert(condition, message) {
  if (!condition) throw new Error(message)
}
