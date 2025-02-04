# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [2.0.0] - 2025-02-04

### Added
- TypeScript strict type checking
- Configuration validation using Zod
- HTTP connection pooling for better performance
- Automatic retry mechanism for failed requests
- Detailed performance logging
- Docker development environment
- Health check endpoint

### Changed
- Improved cache purging with parallel processing
- Better error handling with detailed error messages
- Modular code structure with separate concerns
- Optimized Bunny CDN API calls with concurrency limits
- Docker configuration simplified for better testing

### Removed
- Spam protection (not needed anymore)
- Body size limits
- Legacy callback-style code
- Direct environment variable usage without validation

[2.0.0]: https://github.com/magicpages/ghost-bunnycdn-perma-cache-purger/releases/tag/v2.0.0