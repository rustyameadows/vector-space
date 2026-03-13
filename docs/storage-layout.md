# Storage Layout Contract

Vector Space uses a local-first library layout rooted on macOS at:

`~/Pictures/Vector Space Library`

## Deterministic Directory Layout

At startup, the app creates and verifies the following folders:

- `originals/` — source assets for ingest.
- `thumbnails/` — generated preview images.
- `db/` — app-local database and metadata state.
- `temp/` — temporary files used for ingest and processing.

## Asset Naming Strategy

Asset files are deterministic and ID-based.

- Root folder: `originals/` for source files, `thumbnails/` for derivatives.
- Sharding: two levels based on normalized asset ID.
  - `shardA = assetId[0..1]` (fallback `00`)
  - `shardB = assetId[2..3]` (fallback `00`)
- Final filename: `<normalizedAssetId><extension>`.
- Extension preservation:
  - If original filename has an extension, it is preserved in lowercase.
  - If there is no extension, the asset is stored extensionless.

Example:

- asset ID: `A1B2C3D4`
- original filename: `Photo.JPG`
- stored path: `originals/a1/b2/a1b2c3d4.jpg`

## Startup Guarantees

On app startup:

1. Library root is resolved for macOS.
2. Required directories are created recursively.
3. A write probe is executed in `temp/` to verify disk write access.
4. Permission and disk-write failures are mapped to user-safe error messages.
5. Electron `userData` path is redirected to `db/` for local metadata persistence.

## Error Handling Contract

Errors are normalized as:

- `PERMISSION_DENIED` — permission denied (`EACCES`, `EPERM`).
- `DISK_WRITE_FAILED` — disk full or read-only (`ENOSPC`, `EROFS`).
- `UNSUPPORTED_PLATFORM` — non-macOS platform.
- `UNKNOWN` — fallback for unexpected file-system failures.

The UI should only display user-safe messages from these normalized errors.
