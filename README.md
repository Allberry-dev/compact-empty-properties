English | [简体中文](README.zh-CN.md)

# Compact Empty Properties

A lightweight Obsidian plugin that hides empty properties in the Properties UI while preserving Markdown and YAML frontmatter unless you explicitly delete a property.

## Why

Templates and structured note systems often contain many optional properties. Compact Empty Properties keeps those empty rows visually collapsed while preserving the underlying frontmatter.

## Features

- Hides empty strings, `null`, empty arrays (`[]`), and empty objects (`{}`)
- Keeps `false`, `0`, and non-empty values visible
- Keeps the default empty-Property hiding behavior while allowing Vault-wide Auto, Show, or Hide rules in Settings
- Supports Note, folder, and Vault visibility rules with Note > most-specific Folder > Vault > Auto precedence
- On macOS, Option-click a Property name; on Windows/Linux, Alt-click it to open the visibility menu
- The menu can Hide or Show a Property in this note, folder, or vault
- The menu also opens a compact Reorder properties scope chooser for This folder or This vault; drag handles and Done change UI order only
- Provides Vault-wide decorative Property icons with a searchable runtime icon picker
- Provides a lightweight `Show hidden properties (N)` reveal toggle
- Provides a Scoped rules manager in Settings for searching and resetting note/folder rules
- Exposes the plugin settings through Obsidian 1.13+ Settings Search
- Protects focused, edited, and newly created rows while typing
- Recalculates safely when switching notes or when Properties DOM is replaced
- Works with regular Markdown notes
- Uses Obsidian theme variables for Light and Dark themes
- Hide, Show, Reveal, and ordering changes do not write Markdown; an explicit `Delete from this note` action uses Obsidian's public frontmatter API

## What it does not do

- Does not delete properties automatically; the Property menu provides an explicit `Delete from this note` action
- Does not rewrite or reorder YAML
- Does not rename properties
- Does not replace Obsidian's native Properties editor
- Does not build a separate content index; Settings reads Property names from Obsidian metadata
- Does not process Reading View

## Screenshots

Screenshots will be added after a public, non-personal UI capture is approved. No private Vault screenshots are included.

## Installation

For manual installation, copy these files into your Vault's plugin directory:

```text
main.js
manifest.json
styles.css
```

Destination:

```text
<vault>/.obsidian/plugins/compact-empty-properties/
```

Then open **Settings → Community plugins**, enable Community plugins if needed, and enable **Compact Empty Properties** manually.

## Usage

With the default setting enabled, empty Properties rows are hidden. Click **Show hidden properties (N)** to temporarily reveal Properties hidden by Auto, Note, folder, or Vault rules; click **Hide properties** to apply the rules again. The reveal is UI-only and never writes to the note.

Use **Settings → Compact Empty Properties → Property visibility** for Vault-wide Auto, Show, and Hide rules. For quick note-level changes, Option-click a Property name on macOS or Alt-click it on Windows/Linux, then choose Hide, Show, or `Delete from this note`. Reset scoped rules in the **Scoped rules** section of Settings to restore inheritance.

To reorder Properties, use the **Reorder properties** Command Palette command or choose **Reorder properties…** from the Option/Alt-click menu. Choose **This folder** or **This vault**, drag the handles, then select **Done**. The order is stored in the plugin settings and never written to YAML/frontmatter. Configure decorative icons in **Settings → Compact Empty Properties → Property icons**; icons are selected from Obsidian's runtime icon list and can be reset to the native/default presentation.

## Empty value rules

| Value | Hidden? |
| --- | --- |
| Empty string | Yes |
| `null` | Yes |
| `[]` | Yes |
| `{}` | Yes |
| `false` | No |
| `0` | No |
| Non-empty string | No |
| Non-empty array/object | No |

## Privacy and data safety

- No network requests
- Hide/Show/Reveal do not write Markdown or YAML; `Delete from this note` deliberately removes the selected top-level frontmatter key through Obsidian's public API
- No separate Vault-wide content index
- Operates only on the currently displayed Properties UI
- Plugin settings, if changed, are stored as the plugin's own settings data

## Development

```sh
npm install
npm test
npm run check
npm run build
node --check main.js
```

See [`docs/dom-audit.md`](docs/dom-audit.md) for the DOM and lifecycle notes.

## License

MIT
