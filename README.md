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

After both trust relationships exist, run **Publish npm release**. The
`trusted_publishing` input now defaults to `true`: the workflow uses the OIDC
identity and removes `NPM_TOKEN` from the publish environment. Set it to `false`
only as a fallback while diagnosing a trust configuration.

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
3. After merge, run **Publish npm release** with the release ID.
4. The workflow validates package boundaries, hashes, repository metadata, and
   npm version availability, then publishes each tarball.

Published package code is necessarily public through npm. This repository
protects the private source history and unshipped development materials; it is
not a secrecy boundary for executable package contents.


## Credential recovery

The publish workflow accepts two credential paths:

- `trusted_publishing=true` (default): npm exchanges the GitHub OIDC token. The package must have a
  trusted publisher for owner `mineclover`, repository `oa-sdk-releases`, workflow `publish.yml`,
  environment `npm-publish`.
- `trusted_publishing=false` (fallback): uses `NPM_TOKEN`, a granular `@oa-sdk` write token with
  2FA bypass. Use only while diagnosing a trust configuration.

If a run fails before publishing any package version (401/404 authentication errors), the release
ID is still unused; refresh the credential and re-run the same release ID. If some packages were
published, create a new release with new versions instead.

## Security rules

- Never add a package source directory or a `.tgz` that fails the workflow
  boundary validation.
- Never use a release ID twice.
- Do not rerun a release after any package version has been published. Create a
  new release with new versions instead.
- `NPM_TOKEN` is used only by the GitHub Actions publish job and is never
  committed or used by an export script.
