[English](README.md) | 简体中文

# Compact Empty Properties

在 Obsidian 的 Properties / 笔记属性界面中自动折叠空属性；除非用户明确选择删除属性，否则不会修改 YAML / frontmatter。

Compact Empty Properties 是一个轻量级 Obsidian 插件。

它会在笔记属性（Properties）界面中自动隐藏没有内容的属性，让使用模板、结构化笔记或大量可选字段的笔记保持简洁。

Hide / Show / Reveal 只改变显示，不修改你的 Markdown 或 YAML 数据；Property 菜单中的“Delete from this note”是明确的删除操作。

## 为什么需要它？

如果一篇笔记包含：

```yaml
---
source:
aliases: []
projects: []
rating:
area:
  - 知识管理
focus: false
---
```

Obsidian 的 Properties 界面可能会把这些字段全部显示出来。插件默认只保留有内容的属性：

- `area: 知识管理`
- `focus: false`

以下空属性会默认隐藏：

- `source:`
- `aliases: []`
- `projects: []`
- `rating:`

## 功能

- 隐藏空字符串
- 隐藏 `null`
- 隐藏空数组 `[]`
- 隐藏空对象 `{}`
- 保留 `false`
- 保留 `0`
- 保留非空字符串、数组和对象
- 默认继续自动隐藏空 Property，并支持在 Settings 中设置 Vault-wide 的 Auto / Show / Hide
- 支持 Note、Folder、Vault 三层 visibility rule，优先级为 Note > 最具体 Folder > Vault > Auto
- macOS 使用 Option + click Property name，Windows/Linux 使用 Alt + click Property name
- 可以选择 Hide / Show in this note、folder、vault
- Option/Alt + click 菜单还提供紧凑的 “Reorder properties…” 入口，可选择 This folder 或 This vault，再通过拖拽和 Done 修改 UI 顺序
- Settings 提供按 Property name 设置 Vault-wide 装饰性 custom icon 的 searchable picker
- 提供 `显示隐藏属性 (N)` 临时 reveal 控件
- Settings 提供 Scoped rules manager，可搜索并 Reset note/folder rule
- 兼容 Obsidian 1.13+ Settings Search
- 正在 focus、编辑或刚刚新建的属性不会在输入过程中消失
- 切换 Note 时重新计算当前 Note 的空属性
- 兼容 Light / Dark theme
- 适用于普通 Markdown 笔记，不依赖特定 schema
- Property 菜单提供“Delete from this note”，通过 Obsidian 公共 API 删除当前 Note 的顶层 frontmatter key

## 空值规则

| 值 | 是否隐藏 |
| --- | --- |
| 空字符串 `""` | 是 |
| `null` | 是 |
| 空数组 `[]` | 是 |
| 空对象 `{}` | 是 |
| `false` | 否 |
| `0` | 否 |
| `"0"` | 否 |
| 非空字符串 | 否 |
| 非空数组 / 对象 | 否 |

## 如何使用？

启用插件后，Properties 中的空属性会默认隐藏。

点击：

```text
显示隐藏属性 (N)
```

即可临时显示当前 Note 中被 Auto empty-property 逻辑或 Note / Folder / Vault rule 隐藏的 Property。再次点击 `隐藏属性`，即可恢复规则。

这个控件只改变当前 UI，不会创建、删除或修改任何 Property 或 visibility rule。对 Property 使用 Option/Alt + click 后，可以选择“Delete from this note”来删除当前 Markdown Note 中对应的顶层 frontmatter key。

在 **设置 → Compact Empty Properties → Property visibility** 中管理 Vault-wide 规则。要快速修改当前 Property，可在 macOS 按住 Option 点击 Property name，或在 Windows/Linux 按住 Alt 点击 Property name，然后选择在当前 Note、Folder 或 Vault 中 Hide / Show。Scoped rule 的 Reset 在 Settings 的 **Scoped rules** 区域完成，用于恢复继承。

要调整 Property 的 UI 顺序，可以使用 Command Palette 的 **Reorder properties**，或从 Option/Alt + click 菜单选择 **Reorder properties…**。选择 This folder 或 This vault，拖动 handle，完成后点击 Done。顺序只保存到插件自己的 settings，不会写入 YAML/frontmatter。custom icon 在 **Settings → Compact Empty Properties → Property icons** 中配置；图标来自 Obsidian 运行时提供的图标列表，也可以 Reset 回 native/default。

## 编辑安全

以下情况会暂时保持属性行显示：

- 当前 row 获得 focus
- 用户正在编辑 value
- 用户刚刚通过 Obsidian 原生按钮新建 property
- 用户正在删除已有 value

如果用户 blur 后该属性仍为空，它才会重新隐藏。

## 它不会做什么？

- 不会自动删除 frontmatter 字段；明确的 “Delete from this note” 操作除外
- 不删除空数组或空对象
- 不重写 YAML
- 不修改字段顺序
- 不修改字段名称
- 不替换 Obsidian 原生 Properties editor
- 不建立独立的内容索引；Settings 中的 Property 列表读取 Obsidian metadata
- 不建立 Vault-wide index
- 不处理 Reading View

## 安装

手动安装时，将以下文件复制到 Vault 的插件目录：

```text
main.js
manifest.json
styles.css
```

目标目录：

```text
<vault>/.obsidian/plugins/compact-empty-properties/
```

然后打开 **设置 → 社区插件**，手动启用 **Compact Empty Properties**。

插件不会自动修改 `community-plugins.json`，也不会替你启用插件。

## 设置

插件提供以下设置：

```text
Hide empty properties
```

关闭后，Auto Property 会按 Obsidian 原生方式显示；Show / Hide 规则仍按规则生效。Property visibility 用于 Vault-wide 规则，Scoped rules 用于查看、搜索和 Reset Note / Folder rule。设置只保存为插件自己的 settings data，不会写入 Markdown。

## 隐私与数据安全

- 不发起网络请求
- Visibility、Reveal、custom icon 和 Property order 只影响 UI，不写入 Markdown 或 YAML
- 只有用户明确选择 “Delete from this note” 时，插件才会通过 Obsidian 公共 API 删除当前 Note 的顶层 frontmatter key
- 不建立独立的内容索引；Settings 中的 Property 列表读取 Obsidian metadata
- 只处理当前打开的 Markdown view 中已显示的 Properties UI
- 不读取或修改其他插件的数据

## 开发

```sh
npm install
npm test
npm run check
npm run build
node --check main.js
```

DOM 与生命周期说明见 [`docs/dom-audit.md`](docs/dom-audit.md)。

## 版本

当前版本：`0.2.2`

插件 ID：`compact-empty-properties`

## License

MIT
