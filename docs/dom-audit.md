# Obsidian Properties DOM and lifecycle audit

Target runtime: Obsidian 1.13.7, Markdown Edit / Live Preview.

The first-party public API exposes workspace and metadata-cache primitives, but the rendered Properties rows and their empty-state are not represented by a public plugin API. The implementation therefore uses a small, defensive DOM adapter:

```text
.metadata-container
  .metadata-property
    .metadata-property-key
    .metadata-property-value
  .metadata-add-button
```

The adapter recognizes common empty-state hints (`.is-empty`, `.metadata-property-value-empty`, and `data-empty="true"`). It also reads the current value editor: text inputs and contenteditable values use their displayed value; unchecked checkboxes remain real `false` values; list chips use chip presence. The read-only metadata cache supplies exact array/object values when the DOM renderer has no reliable text signal.

## Lifecycle contract

- Only open `MarkdownView` instances in source/edit mode are considered. Reading View is skipped.
- Each Markdown view owns one root observer, scoped to that view's `containerEl`, to detect metadata-container mount or replacement.
- Each metadata container owns exactly one metadata observer, scoped to that container.
- A per-view generation token invalidates all deferred work when the note changes. Stale callbacks cannot evaluate the new note.
- When a container is found, the plugin attaches its observer and evaluates synchronously in the same resolution pass.
- If the container has not mounted yet, resolution uses at most eight `requestAnimationFrame` retries. The root observer resets this bounded retry window when a container appears; there is no permanent polling.
- A replaced container is removed from the view's context map, its observer and plugin-owned DOM are cleaned up, and the new container is bound once.
- Mutation updates are coalesced with a 50 ms timer. Plugin-owned class changes are attributes and are not observed, preventing an observer loop.
- Unload and view cleanup cancel animation frames and timers, disconnect observers, remove event listeners, remove the toggle, and restore plugin-owned row state.

## Data boundary

Visibility, Reveal, custom icons, and UI ordering do not parse, serialize, reorder, or write frontmatter. Settings does read the Vault's Markdown-file list and each file's cached metadata to build the Property-name list; this is read-only and does not create a separate content index. The explicit `Delete from this note` action uses `app.fileManager.processFrontMatter()` after the user selects it. The plugin does not call `Vault.modify` or `Vault.process`, and does not depend on any note schema.
