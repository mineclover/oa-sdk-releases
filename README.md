# OA SDK releases

This public repository contains only reviewed, publishable OA SDK package
artifacts. It deliberately does not contain the private `oa-sdk` source tree,
tests, issue history, or development configuration.

## Release boundary

Each `releases/<release-id>/` directory contains:

- a signed-off `manifest.json` with package name, version, tarball SHA-512, and
  the private source revision identifier;
- npm tarballs containing only `dist/`, approved `lib/` TypeSpec files,
  `package.json`, README, and LICENSE; and
- no `src/`, tests, source maps, lockfiles, or workspace configuration.

The publish workflow is manual. It validates the manifest and every tarball
before invoking `npm publish --provenance`. `NPM_TOKEN` must be configured as a
repository or `npm-publish` environment secret. It must be a granular npm
token owned by, or granted publish access from, `astralclover`, authorized for
the `@oa-sdk` scope with write permission and 2FA bypass enabled. The workflow
checks the npm identity before it attempts a publish.

For the long-term tokenless option, configure each package's npm trusted
publisher as GitHub Actions: owner `mineclover`, repository
`oa-sdk-releases`, workflow `publish.yml`, environment `npm-publish`, allowed
action `npm publish`. The workflow already has the OIDC permission required
for that configuration.

## Promotion flow

1. Private `oa-sdk` CI passes its release gates and creates a release export.
2. The export is reviewed as a pull request in this repository.
3. After merge, run **Publish npm release** with the release ID.
4. The workflow validates package boundaries, hashes, repository metadata, and
   npm version availability, then publishes each tarball.

Published package code is necessarily public through npm. This repository
protects the private source history and unshipped development materials; it is
not a secrecy boundary for executable package contents.

## Security rules

- Never add a package source directory or a `.tgz` that fails the workflow
  boundary validation.
- Never use a release ID twice.
- Do not rerun a release after any package version has been published. Create a
  new release with new versions instead.
- `NPM_TOKEN` is used only by the GitHub Actions publish job and is never
  committed or used by an export script.
