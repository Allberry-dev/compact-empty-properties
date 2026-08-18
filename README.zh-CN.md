[English](README.md) | 简体中文

# Compact Empty Properties

在 Obsidian 的 Properties / 笔记属性界面中自动折叠空属性，但不会删除或修改 YAML / frontmatter。

Compact Empty Properties 是一个轻量级 Obsidian 插件。

它会在笔记属性（Properties）界面中自动隐藏没有内容的属性，让使用模板、结构化笔记或大量可选字段的笔记保持简洁。

**它只改变显示，不修改你的 Markdown 或 YAML 数据。**

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
- 提供轻量的 `显示空属性 (N)` / `隐藏空属性` 控件
- 正在 focus、编辑或刚刚新建的属性不会在输入过程中消失
- 切换 Note 时重新计算当前 Note 的空属性
- 兼容 Light / Dark theme
- 适用于普通 Markdown 笔记，不依赖特定 schema

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
显示空属性 (N)
```

即可临时显示当前 Note 的全部空属性。再次点击 `隐藏空属性`，即可恢复折叠状态。

这个控件只改变当前 UI，不会创建、删除或修改任何 property。

## 编辑安全

以下情况会暂时保持属性行显示：

- 当前 row 获得 focus
- 用户正在编辑 value
- 用户刚刚通过 Obsidian 原生按钮新建 property
- 用户正在删除已有 value

如果用户 blur 后该属性仍为空，它才会重新隐藏。

## 它不会做什么？

- 不删除 frontmatter 字段
- 不删除空数组或空对象
- 不重写 YAML
- 不修改字段顺序
- 不修改字段名称
- 不替换 Obsidian 原生 Properties editor
- 不扫描整个 Vault
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

插件提供一个简单设置：

```text
Hide empty properties
```

关闭后，Properties 会按 Obsidian 原生方式显示。设置只保存为插件自己的 settings data，不会写入 Markdown。

## 隐私与数据安全

- 不发起网络请求
- 不写入 Markdown 或 YAML
- 不修改 Vault 笔记内容
- 不扫描整个 Vault
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

当前版本：`0.1.1`

插件 ID：`compact-empty-properties`

## License

MIT
