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
before invoking `npm publish --provenance`. The workflow uses **GitHub Actions
OIDC trusted publishing only**: it exchanges the workflow's OIDC identity for a
short-lived npm token and does not pass a long-lived `NPM_TOKEN` to the publish
step. Each published package needs a trusted publisher for owner `mineclover`,
repository `oa-sdk-releases`, workflow `publish.yml`, environment `npm-publish`.

### Trusted publishing setup (manual, 2FA required)

For the long-term tokenless option, configure each package's npm trusted
publisher as GitHub Actions: owner `mineclover`, repository
`oa-sdk-releases`, workflow `publish.yml`, environment `npm-publish`, allowed
action `npm publish`.

This setup **cannot be automated with the existing `NPM_TOKEN`**. npm rejects
trusted-publishing management from granular tokens that bypass 2FA:

```text
E403 Granular access tokens that bypass two-factor authentication may not perform this action
```

A person with npm account access must configure it once, using the npm website
or an interactive login that can complete 2FA:

```bash
npm login --auth-type=web
npm trust github @oa-sdk/tools \
  --file publish.yml \
  --repo mineclover/oa-sdk-releases \
  --environment npm-publish \
  --allow-publish -y
npm trust github @oa-sdk/mcp-mesh \
  --file publish.yml \
  --repo mineclover/oa-sdk-releases \
  --environment npm-publish \
  --allow-publish -y
npm trust list @oa-sdk/tools
npm trust list @oa-sdk/mcp-mesh
```

After both trust relationships exist, run **Publish npm release**. The workflow
always uses the OIDC identity; there is no token input or fallback in the
workflow.

Current configuration (2026-10-23): `@oa-sdk/tools` and `@oa-sdk/mcp-mesh` are
configured for this workflow and were validated by the
`2026-10-23-tools-v0.2.2` publish. Complete the first OIDC publish within two
days of creating or recreating a configuration.

Both `npm trust list` and `npm trust github` require an interactive 2FA session.
The CI `NPM_TOKEN` gets `E403` for reads as well as writes, so these commands
cannot run from the publish workflow.

If `npm trust github` returns `E409 ... a trusted publisher configuration that a
token could also match already exists`, the package already has a matching or
overlapping configuration. List it before changing anything:

```bash
npm trust list @oa-sdk/tools
npm trust list @oa-sdk/mcp-mesh
```

If an entry already names `mineclover/oa-sdk-releases`, `publish.yml`, and
`npm-publish`, the setup is complete; no new entry is needed. If the entry is
stale or names the wrong repository/workflow/environment, revoke it by its `id`
and recreate it:

```bash
npm trust revoke @oa-sdk/tools --id=<trust-id>
npm trust github @oa-sdk/tools \
  --file publish.yml \
  --repo mineclover/oa-sdk-releases \
  --environment npm-publish \
  --allow-publish -y
```

Existing trusted-publisher connections cannot be edited in place; deleting and
recreating is the supported path. A newly created configuration expires if it
does not complete its first successful publish within two days.

## Promotion flow

1. Private `oa-sdk` CI passes its release gates and creates a release export.
2. The export is reviewed as a pull request in this repository.
3. After merge, run **Publish npm release** with the release ID. The workflow
   always uses GitHub OIDC and does not pass `NPM_TOKEN` to the publish step.
4. The workflow validates package boundaries, hashes, repository metadata, and
   npm version availability, publishes each missing tarball, then verifies the
   exact versions on the public registry.

```bash
gh workflow run "Publish npm release" \
  --repo mineclover/oa-sdk-releases \
  -f release_id=<release-id>
```

Registry propagation can take several minutes. The workflow waits up to 15
minutes (`PUBLISH_VERIFY_TIMEOUT_MS` overrides it). If verification fails after
all packages were published, rerun the same release ID: already-published
versions are skipped and only verification runs. Do not rebuild or replace the
artifacts.

After the workflow succeeds:

```bash
npm view @oa-sdk/<package> version --prefer-online
npm view @oa-sdk/<package> dist-tags --json --prefer-online
```

Create the GitHub Release/tag for the release ID. After the first successful
OIDC publish, restrict token-based publishing access and retire `NPM_TOKEN`.
If the token is left to expire instead of being revoked, no workflow change is
needed: the workflow never receives it and OIDC releases are unaffected.

Published package code is necessarily public through npm. This repository
protects the private source history and unshipped development materials; it is
not a secrecy boundary for executable package contents.


## Credential recovery

The publish workflow has one credential path: **GitHub OIDC trusted publishing**. It requires the
package's trusted publisher for owner `mineclover`, repository `oa-sdk-releases`, workflow
`publish.yml`, environment `npm-publish`. There is no token input in the workflow.

If a run fails with `ENEEDAUTH` before publishing any package version, check that the workflow
filename, repository, environment, and `id-token: write` permission still match npm. The release ID
is still unused, so fix the trust relationship and re-run the same release ID. If some packages were
published, create a new release with new versions instead.

`scripts/publish-release.mjs` still supports a local `NPM_TOKEN` run when `--trusted` is omitted.
That is an emergency/manual path only; the GitHub Actions workflow always passes `--trusted`.

## Security rules

- Never add a package source directory or a `.tgz` that fails the workflow
  boundary validation.
- Never use a release ID twice for a different artifact set.
- Do not republish or replace a tarball after its version is on npm. A rerun of
  the same release ID is allowed only for registry verification; the publish
  script skips versions that already exist.
- The GitHub Actions publish job uses OIDC only and never receives a long-lived
  `NPM_TOKEN`. Do not add one back to the workflow.
