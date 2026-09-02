# Changelog

## 0.2.2

### Maintenance

- Restored the vertical layout of the Compact Empty Properties Settings page in Obsidian 1.13+ Settings Search.

## 0.2.1

### Maintenance

- Improved compatibility with Obsidian 1.13+ Settings Search and cross-window Properties DOMs.
- Use Obsidian DOM helpers for plugin-created settings and controls.
- Removed unnecessary type assertions and an avoidable CSS priority override.

## 0.2.0

### Added

- Vault-wide Property visibility with Auto, Show, and Hide modes.
- Note-, folder-, and vault-scoped Property visibility rules.
- Note > most-specific Folder > Vault > Auto precedence.
- Alt/Option-click on a Property name to open the visibility menu.
- Temporary reveal for hidden Properties.
- Scoped rules manager in Settings.
- Note and folder rename/move rule migration.
- Explicit `Delete from this note` action in the Property visibility menu.
- Compact Reorder properties scope menu from the Command Palette or the Option/Alt-click menu, with folder/vault UI ordering and Done persistence.
- Vault-wide decorative Property icons with a searchable picker based on Obsidian's runtime icon list.

### Behavior

- Hide, Show, and Reveal change only the Obsidian Properties UI and do not modify Markdown, YAML, or frontmatter.
- `Delete from this note` explicitly removes the selected top-level frontmatter key through Obsidian's public API.
- Show overrides empty-property hiding.
- Scoped Reset restores inheritance.
- Folder rules apply to descendants, with the most-specific folder taking precedence.

## 0.1.1

- Improved property folding stability when switching between notes.
- Added per-view generation guards against stale deferred callbacks.
- Added bounded metadata-container resolution and replacement rebinding.
- Reduced temporary display of empty properties during metadata rendering.

## 0.1.0

- Initial release.
- Hide empty properties in Obsidian's Properties UI.
- Preserve `false` and `0` values.
- Add Show/Hide Empty Properties control.
- Preserve editing and focus state.
- Zero Markdown writes.
