English | [简体中文](README.zh-CN.md)

# Compact Empty Properties

A lightweight Obsidian plugin that hides empty properties in the Properties UI without modifying Markdown or YAML frontmatter.

## Why

Templates and structured note systems often contain many optional properties. Compact Empty Properties keeps those empty rows visually collapsed while preserving the underlying frontmatter.

## Features

- Hides empty strings, `null`, empty arrays (`[]`), and empty objects (`{}`)
- Keeps `false`, `0`, and non-empty values visible
- Provides a lightweight `Show empty properties (N)` toggle
- Protects focused, edited, and newly created rows while typing
- Recalculates safely when switching notes or when Properties DOM is replaced
- Works with regular Markdown notes
- Uses Obsidian theme variables for Light and Dark themes
- Makes no Markdown writes and does not index the Vault

## What it does not do

- Does not delete properties
- Does not rewrite or reorder YAML
- Does not rename properties
- Does not replace Obsidian's native Properties editor
- Does not scan the whole Vault
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

With the default setting enabled, empty Properties rows are hidden. Click **Show empty properties (N)** to temporarily show all empty rows; click **Hide empty properties** to compact them again. The toggle is UI state only and never writes to the note.

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
- No Markdown or YAML writes
- No Vault-wide indexing
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
