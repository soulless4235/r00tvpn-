#!/usr/bin/env bash
# Picks the build version, writes it into package.json and exports VERSION.
#   tag push           -> the tag (a leading "v" is dropped)
#   manual run         -> the "version" input
#   anything else      -> <package.json version>-dev.<run number>
set -euo pipefail

if [[ "${GITHUB_REF:-}" == refs/tags/* ]]; then
  version="${GITHUB_REF_NAME#v}"
elif [[ -n "${INPUT_VERSION:-}" ]]; then
  version="${INPUT_VERSION#v}"
else
  version="$(node -p "require('./package.json').version")-dev.${GITHUB_RUN_NUMBER:-0}"
fi

if [[ ! "$version" =~ ^[0-9]+\.[0-9]+\.[0-9]+(-[0-9A-Za-z.-]+)?$ ]]; then
  echo "::error::invalid version '$version'"
  exit 1
fi

npm pkg set version="$version"
echo "VERSION=$version" >> "$GITHUB_ENV"
echo "version: $version"
