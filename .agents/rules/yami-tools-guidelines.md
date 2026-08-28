---
description: yami-tools (Asset Manager) specific patterns and constraints
---

# Yami-Tools Guidelines

These rules apply when developing the `yami-tools` Asset Manager project. You MUST follow them strictly.

## 1. IndexedDB Directory Prefix Queries
When querying files or assets recursively from a parent directory, NEVER use exact match (`IDBKeyRange.only(prefix)`).
Because the database `dir` field only stores the immediate parent directory, querying a top-level directory must use range queries to recursively match all subdirectories.
**Rule:** ALWAYS use `IDBKeyRange.bound(prefix, prefix + '\uffff')` for prefix scanning.

## 2. Asset Normalization & Variants
Assets in the gallery MUST maintain global uniqueness to avoid cluttering the UI with duplicate cards for different sizes or formats of the exact same animation.
**Rule:**
- During `clusterFiles` or `globalEffectMap` aggregation, strip dimension modifiers (e.g., `_large`, `_small`, `_hd`) and formats to merge them into a single `anim` object.
- Keep the `sequence` (PNG frames) as the primary type over `sheet` (Spritesheet) if both exist.
- Preserve all size variants in an `anim.variants` dictionary (`variants: { large: {...}, small: {...} }`).
- The PreviewPane uses `anim.variants` to render a dynamic Size Switcher UI. Always update both the primary object and the variants dictionary properly during cluster aggregation.

## 3. UI and Modal Styling Standards
**Rule:**
- Any modal or popup added to the React UI MUST have its CSS explicitly defined in `app.css`.
- Standard modal class structure:
  - Background: `.pro-modal-backdrop`
  - Container: `.your-modal-class`
  - Header/Body/Footer inner structure.
- Do NOT use unstyled raw HTML buttons. Always map them to custom classNames (e.g., `.btn.primary`, `.action-btn`, `.folder-done-btn`) and ensure gradients, hover states, and glow shadows are defined.

## 4. State Recovery via localStorage
**Rule:**
- The application should remember the user's last selected pack and directory.
- Use `localStorage.getItem('am_last_pack')` and `localStorage.getItem('am_last_dir')`.
- ALWAYS invoke a centralized recovery helper (like `restoreLastView()`) inside the main `useEffect` initialization and inside `reauthorize()` methods instead of hardcoding fallback selections (like `cachedPacks[0].name`).

## 5. Version Maintenance & Git Releases
**Rule:**
- Every time code is committed and pushed to git, the version number of the project and the Asset Manager MUST be maintained and incremented according to Semantic Versioning (SemVer):
  - **Patch** (`x.y.Z` -> `x.y.Z+1`): Bug fixes, CSS/styling refinements, minor UX tweaks.
  - **Minor** (`x.Y.z` -> `x.Y+1.0`): New features, new controls, new data format support.
  - **Major** (`X.y.z` -> `X+1.0.0`): Architecture overhaul, breaking changes.
- Ensure all version references remain synchronized:
  1. `package.json` (`version`)
  2. `public/tools/version.json` (`asset-manager.version`)
  3. `src/data/tools.js` (`tools.find(t => t.id === 'asset-manager').version` & `HUB_VERSION`)
  4. `src/pages/AssetManagerPage.jsx` (Header badge `<span className="pro-pill">v...</span>`)
