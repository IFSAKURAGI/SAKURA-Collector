# SAKURA 收集组件 - 优化说明

## 已修复的问题（本次修改）

### 1. UI 与后端数据字段不一致（Bug）
- **问题**：后端返回 `isExternal: boolean`，UI 用 `component.source === 'external'` 和 `c.source === 'internal'` 筛选/展示，导致「当前文件 / 外部文件」筛选和展示错误。
- **修复**：UI 改为使用 `component.isExternal === true/false` 进行筛选和显示。

### 2. 收集完成后 UI 无反馈（Bug）
- **问题**：点击「收集」后，后端未向 UI 发送 `success` 或 `error`，按钮一直处于「收集中...」，出错时用户也无提示。
- **修复**：在 `collect-components` 分支外包一层 `try/catch`，成功时发送 `type: 'success'`，失败时发送 `type: 'error'` 并带上错误信息。

### 3. 变体组件实例无法重新绑定（Bug）
- **问题**：`buildInstanceMapFromNode` 用 `mainComponent.id`（子组件 id）作为 key，而 `processComponentSet` 用 `componentSet.id` 查找，变体实例在收集时找不到，无法执行 `swapComponent`。
- **修复**：当 `mainComponent.parent` 为 `COMPONENT_SET` 时，用 `mainComponent.parent.id` 作为 instanceMap 的 key，与收集逻辑一致。

### 4. scopeBadge 元素缺失
- **问题**：JS 中有 `getElementById('scopeBadge')`，HTML 中无对应元素，扫描范围徽章不显示。
- **修复**：在「扫描后 UI」的 results-header 中增加 `<span class="scope-badge" id="scopeBadge">`，并补充 `.results-header` 布局样式。

### 5. 无用代码清理
- **问题**：`originalBuildDocumentInstanceMap` 声明后未使用。
- **修复**：删除该变量及注释。

---

## 可进一步优化的方向

### 性能

| 项目 | 说明 |
|------|------|
| **避免二次全文档遍历** | 点击「收集」时先 `performComponentScanning` 再 `buildDocumentInstanceMap`，文档被完整遍历两遍。可在单次遍历中同时构建「组件表」和「实例映射」，或让扫描阶段就产出 instanceMap（按当前 scope 只收集需要的 key），减少大文件下的耗时。 |
| **复用扫描结果** | 用户先「扫描」再「收集」时，可把扫描结果传给收集流程，只做一次扫描；当前实现是收集时重新扫一遍。需要把部分结果通过 postMessage 传到 backend 或由 backend 缓存（注意 Figma 插件无持久化，只能当次会话内复用）。 |
| **真正使用 CacheManager** | `CacheManager` 已实例化但未使用。可对「某 scope 的扫描结果」做短期缓存（例如 key = scope + pageId/selectionId），同一操作重复触发时直接读缓存。 |
| **PerformanceTuner** | `tuner.adjustForSystem(load)` 从未被调用，`load` 也未定义。若要做负载自适应，可结合 `perfMonitor` 的耗时或队列长度计算 load 并调用；否则可删除相关代码避免误导。 |

### 架构与可维护性

| 项目 | 说明 |
|------|------|
| **扫描逻辑去重** | `scanFileForComponents` 与 `performComponentScanning` 中按 scope 分支的扫描逻辑高度相似，可抽成共用函数（如 `scanWithScope(scope, componentsMap, progressCallback)`），减少重复与后续修改成本。 |
| **类型与接口集中** | `ComponentInfo`、`ComponentSetInfo` 以及扫描结果里返回的 list item 形状可集中到类型定义文件或同一处，便于前后端约定和后续扩展（如增加字段）。 |

### 体验与健壮性

| 项目 | 说明 |
|------|------|
| **长列表虚拟滚动** | 组件列表最多展示 300 条，DOM 过多时仍可能卡顿。可只渲染可视区域（虚拟列表），滚动时按需创建/复用节点，提升大列表流畅度。 |
| **进度与取消** | 扫描/收集耗时长时，可考虑「取消」按钮（通过 AbortController 或标志位在批量间隙检查并中止），避免用户误以为卡死。 |
| **错误信息更具体** | 收集失败时除 `err.message` 外，可区分「未找到组件」「目标页创建失败」「swapComponent 失败」等，在 UI 上给出更明确的提示或重试建议。 |
| **二次确认** | 收集会移动/重组组件并改写实例引用，可在弹窗中增加「将收集 N 个组件到页面 X」的二次确认，减少误操作。 |

### 功能扩展（可选）

- **按名称/类型筛选**：在列表中支持按组件名、类型（主组件/变体）搜索或过滤。
- **导出扫描结果**：将当前扫描结果导出为 JSON/CSV，便于统计或与外部工具联动。
- **布局配置**：间距、每行最大宽度等从 UI 或设置弹窗中配置，而不是写死在代码里。

---

## 修改文件清单

- `code.ts`：收集 try/catch 与 success/error 通知、变体 instanceMap key、删除无用变量。
- `ui.html`：isExternal 字段使用、scopeBadge 元素、results-header 与 scope-badge 样式。
- 新增 `OPTIMIZATION.md`（本文件）。

以上修复已保证：内外部筛选正确、收集有成功/失败反馈、变体实例能正确重新绑定、扫描范围徽章正常显示。
