# SAKURA收集组件

一个强大的 Figma 插件,用于收集和组织文件中的所有主组件。

## 📋 功能特性

- ✅ 自动扫描文件中所有组件实例
- ✅ 统计主组件数量和实例数量
- ✅ 显示详细的组件列表
- ✅ 将主组件收集到指定页面
- ✅ 自动网格布局排列组件
- ✅ 自动重新绑定所有实例到新页面的主组件
- ✅ 美观的用户界面

## 📦 文件结构

```
component-collector/
├── manifest.json       # 插件配置文件
├── code.ts            # 主逻辑代码 (TypeScript)
├── ui.html            # 用户界面
└── README.md          # 说明文档
```

## 🚀 安装步骤

### 方法一: 直接在 Figma 中开发

1. 打开 Figma 桌面应用
2. 进入 `Plugins → Development → New Plugin...`
3. 选择 "Figma Plugin" 类型
4. 创建插件文件夹

### 方法二: 导入现有插件

1. 创建一个新文件夹,例如 `component-collector`
2. 将以下文件保存到该文件夹:
   - `manifest.json`
   - `code.ts`
   - `ui.html`

3. 在 Figma 中:
   - 进入 `Plugins → Development → Import plugin from manifest...`
   - 选择你创建的 `manifest.json` 文件

## 🔧 编译 TypeScript (如需要)

如果你需要编译 TypeScript 代码:

```bash
# 安装 TypeScript
npm install -g typescript

# 编译代码
tsc code.ts --target es6
```

或者使用 Figma 的构建工具:

```bash
# 初始化项目
npm init -y
npm install --save-dev @figma/plugin-typings typescript

# 创建 tsconfig.json
{
  "compilerOptions": {
    "target": "ES6",
    "lib": ["ES2015"],
    "strict": true,
    "typeRoots": ["./node_modules/@types", "./node_modules/@figma"]
  },
  "include": ["code.ts"]
}

# 编译
npx tsc
```

## 📖 使用方法

1. **打开插件**
   - 在 Figma 文件中,选择 `Plugins → Development → SAKURA收集组件`

2. **查看统计**
   - 插件会自动扫描文件,显示:
     - 主组件数量
     - 实例总数
     - 详细的组件列表(包含实例数量)

3. **设置目标页面**
   - 在输入框中输入目标页面名称
   - 默认名称: `📦 Components Library`
   - 如果页面不存在,会自动创建

4. **收集组件**
   - 点击 "收集组件" 按钮
   - 插件会:
     - 将所有主组件复制到目标页面
     - 自动排列组件(网格布局)
     - 重新绑定所有实例到新页面的主组件

5. **查看结果**
   - 完成后,Figma 会自动切换到目标页面
   - 所有收集的组件会被选中

## 🎨 工作原理

1. **扫描阶段**
   - 递归遍历所有页面和节点
   - 识别所有 `INSTANCE` 类型的节点
   - 收集对应的 `mainComponent`(主组件)

2. **收集阶段**
   - 查找或创建目标页面
   - 将主组件复制到目标页面
   - 使用网格布局自动排列

3. **绑定阶段**
   - 使用 `swapComponent()` 方法
   - 将所有实例重新绑定到新页面的主组件

## ⚙️ 配置选项

### 布局参数 (在 code.ts 中)

```typescript
const spacing = 100;        // 组件之间的间距
const maxWidth = 2000;      // 单行最大宽度
```

你可以根据需要调整这些值来改变布局效果。

## 🐛 故障排除

### 问题: 插件无法启动
- 确保所有文件都在同一文件夹中
- 检查 `manifest.json` 中的文件名是否正确

### 问题: 编译错误
- 确保安装了 `@figma/plugin-typings`
- 检查 TypeScript 版本是否兼容

### 问题: 组件无法重新绑定
- 某些组件可能有特殊属性
- 检查控制台日志获取详细错误信息

### 问题: 未找到组件
- 确保文件中存在组件实例
- 检查组件是否已被删除或断开连接

## 📝 注意事项

- 插件会保留原始主组件不变
- 如果目标页面已存在,不会清空其内容
- 如果主组件已在目标页面,不会重复复制
- 所有操作都可以通过 Ctrl+Z (Cmd+Z) 撤销

## 🔄 更新日志

### v1.0.0
- 初始版本发布
- 基础组件收集功能
- 自动布局和绑定

## 📄 许可证

MIT License

## 🤝 贡献

欢迎提交 Issue 和 Pull Request!

## 📧 联系方式

如有问题或建议,请通过以下方式联系:
- 在 Figma 社区留言
- 提交 GitHub Issue

---

**享受使用 SAKURA收集组件!** 🎉