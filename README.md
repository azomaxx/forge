# forge

Forked from [azomaxx/mister](https://github.com/azomaxx/mister)

`forge` builds .NET tooling repositories with GitHub Actions and stores completed outputs in GitHub Releases.

## What It Does

There are two entry points:

- `Build One`: build a single repository from a `repo_url`
- `Build All Latest`: build every enabled tool listed in `tools/catalog.yml` (for bulk tests only)

For each target, the workflow:

1. resolves the repository and effective build settings
2. determines the source revision to build
3. checks whether that exact revision already exists in Releases
4. skips the Windows build if the release already exists, unless cache skipping is forced
5. restores dependencies and builds on Windows
6. collects output files into a zip bundle
7. publishes the bundle and metadata as GitHub Release assets
8. updates the tool profile after successful builds

## Layout

- [`tools/catalog.yml`](tools/catalog.yml)
  - curated tool inventory used by `Build All Latest`
  - default settings for repositories you intentionally track

- [`tools/profiles/`](tools/profiles/)
  - per-tool build settings
  - stable build recipe data for repositories that need overrides

- [`.github/workflows/forge-build.yml`](.github/workflows/forge-build.yml)
  - reusable build workflow for one target

- [`.github/workflows/forge-test-all.yml`](.github/workflows/forge-test-all.yml)
  - batch workflow for all enabled catalog entries

- [`scripts/catalog_tool.py`](scripts/catalog_tool.py)
  - catalog and profile resolver for the workflows

## Build Flow

`forge-build.yml` runs in two phases:

- Linux preflight
  - resolves catalog defaults and profile overrides
  - resolves the target ref, tag, and commit
  - computes the release identity
  - checks whether the release already exists

- Windows build
  - runs only when the target release is missing or cache skipping is enabled
  - restores dependencies
  - builds the resolved project or solution
  - bundles outputs and publishes the release

This keeps repeated runs cheap when a tool has already been built for the same commit.

## Release Model

Successful builds are published as GitHub Releases.

Each release contains:

- one zip bundle with the collected outputs
- one metadata JSON file

Release tags are commit-based:

- `tool/<tool-id>/<shortsha>`

Release names use the source tag when one exists.

The metadata file records:

- source repository
- resolved ref
- resolved commit
- resolved tag or version label
- selected project path
- configuration
- target framework
- build timestamp
- collected files and hashes

## Profiles

Profiles are used to keep builds repeatable.

They hold settings that are too tool-specific to infer safely every time, for example:

- `project_path`
- restore mode
- build mode
- framework overrides
- artifact include or exclude rules

This matters most for older .NET Framework repositories that still rely on legacy NuGet restore behavior.

Profiles are not meant to track run history or one-off version tests. A successful historical build should not change the default source ref for that tool.

## Usage

### Build One

Use [`.github/workflows/forge-build.yml`](.github/workflows/forge-build.yml).

Main inputs:

- `repo_url`
- `mode`
- `git_ref`
- `project_path`
- `configuration`
- `target_framework`
- `version_override`
- `asset_include`
- `asset_exclude`
- `force_rebuild`

`simple` mode uses known defaults and profile data when available.

`advanced` mode allows manual overrides for a single run.

Important:

- `git_ref` selects what gets checked out and built and must match the exact tag, branch, or commit name
- `version_override` only changes the release label and does not change the source revision

### Build All Latest

Use [`.github/workflows/forge-test-all.yml`](.github/workflows/forge-test-all.yml).

This workflow reads all enabled entries from [`tools/catalog.yml`](tools/catalog.yml) and runs the reusable build workflow for each one.

It is mainly useful for maintenance, validation, and bulk sanity checks. Day-to-day use should go through `Build One`.

It also exposes:

- `Skip cache (slow)`

When enabled, it rebuilds everything instead of stopping at the release cache check.

## Current Scope

This repository currently targets .NET and C# repositories on Windows runners.

The workflow supports both:

- newer SDK-style .NET projects
- older .NET Framework projects that need legacy restore handling

It is not yet intended to be a general multi-language build system.

## UI Runtime Variables

The Astro UI expects these Cloudflare server-side bindings:

- `FORGE_GITHUB_TOKEN`
  - GitHub token (PAT) used for dispatching workflows, querying runs, and proxying release downloads
  - Needs: `repo` scope for releases, `workflow` scope for dispatch
- `FORGE_GITHUB_REPO`
  - repository in `owner/name` form for the Forge backend, for example `Shadow21AR/forge`
- `FORGE_GITHUB_REF`
  - git ref used when dispatching the workflow, typically `main`
