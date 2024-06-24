#!/bin/bash

# Default to 'patch' if no argument given
VERSION_TYPE=${1:-patch}

# Validate version type
if [[ "$VERSION_TYPE" =~ ^(patch|minor|major|[0-9]+\.[0-9]+\.[0-9]+)$ ]]; then
  echo "Bumping version: $VERSION_TYPE"
  npm version $VERSION_TYPE
  git push && git push --tags
else
  echo "Invalid version type or format: $VERSION_TYPE"
  echo "Use 'patch', 'minor', 'major', or specify a version like '1.2.3'"
  exit 1
fi
