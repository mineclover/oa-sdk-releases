# Release manifests

Release exports are committed here by pull request. A release directory is
immutable once any listed package has been published.

The expected layout is:

```text
releases/<release-id>/
  manifest.json
  packages/
    oa-sdk-core-<version>.tgz
    oa-sdk-openapi-projection-contract-<version>.tgz
    oa-sdk-typespec-decorators-<version>.tgz
    oa-sdk-parser-<version>.tgz
    oa-sdk-codegen-<version>.tgz
```
