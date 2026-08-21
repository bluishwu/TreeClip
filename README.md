# TreeClip 文本批量选择器

<p align="center">
  <a href="https://treeclip.dev"><img src="https://img.shields.io/badge/官网-treeclip.dev-2DA44E?style=flat-square&amp;labelColor=1F7A38&amp;logo=googlechrome&amp;logoColor=white" alt="TreeClip 官网"></a>
  <a href="https://chrome.google.com/webstore/detail/bipfdahpmodcpkfpmcjnpkmdjhffbnad"><img src="https://img.shields.io/badge/Chrome-插件-4285F4?style=flat-square&amp;labelColor=1E5FBA&amp;logo=googlechrome&amp;logoColor=white" alt="Chrome 插件"></a>
  <a href="https://treeclip.dev/docs"><img src="https://img.shields.io/badge/说明文档-D97706?style=flat-square&amp;logo=readthedocs&amp;logoColor=white" alt="TreeClip 说明文档"></a>
  <a href="LICENSE"><img src="https://img.shields.io/badge/MIT-6B7280?style=flat-square&amp;logo=readthedocs&amp;logoColor=white" alt="MIT License"></a>
  <a href="#english"><img src="https://img.shields.io/badge/English-0969DA?style=flat-square&amp;logo=googletranslate&amp;logoColor=white" alt="Switch to English"></a>
</p>

https://github.com/user-attachments/assets/c098f113-2f90-4d44-a4c6-f4ec5005239e

<a id="中文"></a>

**TreeClip 是一款网页文本批量选择工具。点选、框选文字，一键扩展同类文本，批量复制到剪贴板。**

难以选中结构相似却排版混乱的网页文本？厌倦了逐条复制？想一次提取网页中分散或同类的文字？

TreeClip 提供了多种灵活的文本选择方式（同类选择、点选、框选），并结合层级切换、层级绑定、块内字段、自定义输出格式等功能，大幅提升您从网页复制信息的效率。网页表格、下拉菜单、商品列表、文章目录、排行榜……更多场景待您探索。

## 快速开始

1. 按住 <kbd>Shift</kbd>，点击目标文字，或者按住鼠标左键拖出选框。
2. 选中一个文本块后按 <kbd>F</kbd>，批量加入网页中结构相同的文字。
3. 按 <kbd>Ctrl</kbd> + <kbd>C</kbd>，按照当前输出设置复制所有已选文本。
4. 按 <kbd>Esc</kbd>，清除全部选择并退出选择模式。

## 基础选择

### 同类选择

选择一处文本，再按 <kbd>F</kbd> 快速选择页面中结构相同的内容。

**适用场景：** 复制结构相同、类型一致的内容，例如搜索结果、商品标价、贴文标题等。

#### 使用方法

1. 按住 <kbd>Shift</kbd> 并点击任意一个目标文本。选中两个结构相同的文本时，TreeClip 也会主动提示。
2. 按下键盘上的 <kbd>F</kbd>，或点击面板中的 **选择同类**。
3. 工具会识别页面上结构相同的文本，并将它们添加到当前选择中。

### 多点选择

按住 <kbd>Shift</kbd> 连续点击，选择页面上不同位置的多段文字；再次点击可以取消选择。

**适用场景：** 同时复制分散在页面不同位置、结构可能不同的多个文本块，类似在 Excel 中选择不相邻单元格。

#### 使用方法

1. 按住 <kbd>Shift</kbd>。
2. 依次点击需要的每一个文本块，也可以结合 <kbd>F</kbd> 批量选择。
3. 所有被点击的文本都会加入当前选择。

### 区域框选

按住 <kbd>Shift</kbd> 并拖动鼠标，一次选择矩形区域内的文字。

**适用场景：** 快速选中一个可视化矩形区域内所有可见、有意义的文本。

#### 使用方法

1. 按住 <kbd>Shift</kbd>。
2. 按住鼠标左键并拖动，绘制一个覆盖目标文字的矩形选框。
3. 松开鼠标，选框内的有效文本会自动加入当前选择。

## 进阶选择

### 层级切换

切换当前层级，扩大或缩小选取范围，精确控制最终复制的内容。

**适用场景：** 选择结果包含多余文字，或没有包含完整内容。例如只选中了商品名称，但希望同时复制名称、价格和描述。

#### 使用方法

1. 点击操作面板中的 **更多**，展开 **文本所在层级**。
2. 点击相应的层级标签（如 `div#main`），切换到该层级。

### 层级绑定

让同类识别同时参考文本自身层级和外层层级。

**适用场景：** 只选择特定父层级下的同类文本，忽略页面上类型相同但父层级不同的内容。

#### 使用方法

1. 在操作面板中展开 **文本所在层级**。
2. 按住 <kbd>Shift</kbd>，点击需要绑定的层级；绑定后会以橙色标记。
3. 再次执行同类扩展，工具只会选择位于相同父层级下的匹配文本。
4. 再次按住 <kbd>Shift</kbd> 点击该层级，即可取消绑定。

### 块内字段

从复合文本块中，进一步提取标题、价格、链接文字等特定字段。

**适用场景：** 当前选中的内容包含多个字段，但只需要其中一部分。

#### 使用方法

1. 检测到可提取字段时，**块内字段**按钮会变为绿色高亮。
2. 点击 **块内字段**，面板会展示可单独提取的字段和文本预览。
3. 点击需要的字段，将当前选择切换到对应文本。

## 输出设置

设置文本的分隔方式和清理规则，也可以去除重复内容或开启实时复制。

### 分隔方式

- 换行
- 空格
- 逗号

### 文本清理

- **文本空格：** 移除每个文本片段内部的所有空白字符。
- **代码：** 移除常见代码块模式，如 `{...}`、`(...)`、`<...>`、`[...]`。
- **符号：** 移除常见的标点和数学符号。
- **英文：** 移除英文字符。
- **中文：** 移除中文字符。
- **数字：** 移除数字字符。

### 复制行为

- **去除重复项：** 自动删除复制内容完全重复的条目。
- **实时复制：** 选择内容发生变化时自动更新剪贴板，无需每次手动点击“复制”。

## 快捷键配置

文本选择、同类选择和复制的快捷键可以自定义。以下为默认设置。

| 操作 | 快捷键 | 说明 |
| --- | --- | --- |
| 单点选择 | <kbd>Shift + 点击</kbd> | 选择或取消单个文本块，可连续选择 |
| 区域框选 | <kbd>Shift + 拖拽</kbd> | 拖出矩形，一次选择区域内的多个文本块 |
| 同类选择 | <kbd>F</kbd> | 按网页结构扩展当前选择 |
| 复制 | <kbd>Ctrl + C</kbd> | 按照当前输出设置复制所有已选文本 |
| 清除选择 | <kbd>Esc</kbd> | 清除所有选择并退出选择模式 |
| 父层级 | <kbd>Shift + ↑</kbd> | 向上移动，选择父层级 |
| 子层级 | <kbd>Shift + ↓</kbd> | 向下移动，选择子层级 |
| 进入块内字段 | <kbd>Shift + →</kbd> | 进入块内字段并提取子文本 |
| 退出块内字段 | <kbd>Shift + ←</kbd> | 退出块内字段 |
| 层级绑定 | <kbd>Shift + 点击层级</kbd> | 开启或关闭父层级绑定 |

## 文本分组

1. **点击分组：** 切换当前正在操作的文本分组。
2. **Shift + 点击分组：** 移除该分组中的全部文本。

## 多形态面板

面板支持详情、标准和极简三种形态。它可以自由拖动，也能吸附在页面边缘，避免遮挡正在查看的内容。

### 切换面板形态

- 轻点顶部短横线，在详情和当前 **收起态**（标准或极简）之间切换。
- 上下拖动顶部短横，依次切换详情、标准和极简模式。
- 轻点 **已选文本块**，切换 **收起态** 为标准或极简模式。

### 移动面板

- 拖动顶部短横两侧的空白区域，移动整个选择面板。
- 靠近页面左侧、右侧或底部释放时，面板会自动吸附。

## 安装

### Chrome 应用商店

从 [Chrome Web Store](https://chrome.google.com/webstore/detail/bipfdahpmodcpkfpmcjnpkmdjhffbnad) 安装 TreeClip。

### 从源码加载

1. 下载或克隆本仓库。
2. 在 Chrome 中打开 `chrome://extensions/`。
3. 开启页面右上角的“开发者模式”。
4. 点击“加载已解压的扩展程序”，选择仓库根目录。

完整说明请访问 [TreeClip 中文文档](https://treeclip.dev/docs)。如有问题，请联系 [contact@treeclip.dev](mailto:contact@treeclip.dev)。

---

<a id="english"></a>

## English

### TreeClip Batch Text Selector

**TreeClip is a batch text selection tool for the web. Click or box-select text, expand the selection to matching text in one action, and copy everything to the clipboard.**

Struggling to select similarly structured text in irregular page layouts? Tired of copying items one by one? Want to extract scattered or matching text from a page all at once?

TreeClip combines flexible selection methods—similar selection, click selection, and area selection—with hierarchy switching, hierarchy binding, fields within a block, and customizable output formats. It makes copying information from webpages dramatically more efficient. Explore web tables, dropdown menus, product lists, article outlines, rankings, and many more scenarios.

## Quick start

1. Hold <kbd>Shift</kbd>, then click target text or drag a rectangle over an area.
2. After selecting one text block, press <kbd>F</kbd> to add text with the same page structure.
3. Press <kbd>Ctrl</kbd> + <kbd>C</kbd> to copy all selected text with the current output settings.
4. Press <kbd>Esc</kbd> to clear the selection and leave selection mode.

## Basic selection

### Select similar

Select one text block, then press <kbd>F</kbd> to find content with the same page structure.

**Use case：** Copy repeated content of the same type, such as search results, product prices, or post titles.

#### How to use

1. Hold <kbd>Shift</kbd> and click any target text. TreeClip also prompts you when two structurally similar blocks are selected.
2. Press <kbd>F</kbd>, or click **Select similar** in the panel.
3. TreeClip finds text with the same structure and adds it to the current selection.

### Multi-select

Hold <kbd>Shift</kbd> and click repeatedly to select text in different places; click again to deselect.

**Use case：** Copy several scattered blocks that may have different structures, similar to selecting non-adjacent cells in Excel.

#### How to use

1. Hold <kbd>Shift</kbd>.
2. Click each text block you need. You can also combine this with <kbd>F</kbd> for batch selection.
3. Every clicked block is added to the current selection.

### Area selection

Hold <kbd>Shift</kbd> and drag to select text inside a rectangular area.

**Use case：** Quickly select all visible, meaningful text within a visual region of the page.

#### How to use

1. Hold <kbd>Shift</kbd>.
2. Hold the left mouse button and drag a rectangle over the target text.
3. Release the mouse button to add valid text inside the rectangle to the current selection.

## Advanced selection

### Change hierarchy

Switch the current hierarchy to expand or narrow the selection and precisely control what gets copied.

**Use case：** The result includes extra text or misses required details—for example, you selected a product name but also need its price and description.

#### How to use

1. Open **More** in the action panel, then expand **Text hierarchy**.
2. Click a hierarchy tag such as `div#main` to switch to that level.

### Bind hierarchy

Make matching consider both the selected text level and an outer parent level.

**Use case：** Select similar text only under a specific parent, while ignoring matching text elsewhere on the page.

#### How to use

1. Expand **Text hierarchy** in the action panel.
2. Hold <kbd>Shift</kbd> and click the level to bind; the bound level turns orange.
3. Run similar selection again. TreeClip now selects matches under the same parent level only.
4. Hold <kbd>Shift</kbd> and click the level again to remove the binding.

### Fields within a block

Extract a specific field—such as a title, price, or link—from a compound text block.

**Use case：** The current selection contains several fields, but you only need one of them.

#### How to use

1. When fields are available, the **Fields within block** button turns green.
2. Click **Fields within block** to view extractable fields and text previews.
3. Click the field you need to switch the current selection to that text.

## Output settings

Choose separators and cleanup rules, remove duplicates, or copy updates in real time.

### Separator

- Line break
- Space
- Comma

### Text cleanup

- **Whitespace:** Remove all whitespace characters inside each text fragment.
- **Code:** Remove common code patterns such as `{...}`, `(...)`, `<...>`, and `[...]`.
- **Symbols:** Remove common punctuation and mathematical symbols.
- **English:** Remove English characters.
- **Chinese:** Remove Chinese characters.
- **Numbers:** Remove numeric characters.

### Copy behavior

- **Remove duplicates:** Automatically delete entries whose copied content is identical.
- **Live copy:** Update the clipboard whenever the selection changes, without clicking Copy each time.

## Keyboard shortcuts

Selection, matching, and copy shortcuts can be customized. These are the defaults.

| Action | Shortcut | Description |
| --- | --- | --- |
| Single select | <kbd>Shift + Click</kbd> | Select or deselect one text block; repeat to select more |
| Area select | <kbd>Shift + Drag</kbd> | Draw a rectangle and select multiple blocks inside it |
| Select similar | <kbd>F</kbd> | Expand the selection by page structure |
| Copy | <kbd>Ctrl + C</kbd> | Copy all selected text using the current output settings |
| Clear | <kbd>Esc</kbd> | Clear the selection and leave selection mode |
| Parent level | <kbd>Shift + ↑</kbd> | Move up to the parent level |
| Child level | <kbd>Shift + ↓</kbd> | Move down to the child level |
| Enter fields | <kbd>Shift + →</kbd> | Enter fields within a block and extract child text |
| Exit fields | <kbd>Shift + ←</kbd> | Exit fields within block |
| Bind level | <kbd>Shift + Click level</kbd> | Turn parent-level binding on or off |

## Text groups

1. **Click a group:** Switch the text group you are currently working with.
2. **Shift + click a group:** Remove every text block in that group.

## Panel modes

The panel supports detail, standard, and minimal modes. Move it freely or snap it to a page edge so it stays out of the way.

### Switch panel mode

- Tap the top handle to switch between detail and the current **collapsed mode** (standard or minimal).
- Drag the top handle up or down to move through detail, standard, and minimal modes.
- Tap **Selected text blocks** to switch the **collapsed state** between standard and minimal.

### Move the panel

- Drag the empty area beside the top handle to move the entire panel.
- Release near the left, right, or bottom edge to snap the panel into place.

## Installation

### Chrome Web Store

Install TreeClip from the [Chrome Web Store](https://chrome.google.com/webstore/detail/bipfdahpmodcpkfpmcjnpkmdjhffbnad).

### Load from source

1. Download or clone this repository.
2. Open `chrome://extensions/` in Chrome.
3. Turn on **Developer mode** in the upper-right corner.
4. Click **Load unpacked** and select the repository root.

Read the complete [TreeClip English documentation](https://treeclip.dev/en/docs?lang=en). For help, contact [contact@treeclip.dev](mailto:contact@treeclip.dev).

## License

TreeClip is released under the [MIT License](LICENSE).
