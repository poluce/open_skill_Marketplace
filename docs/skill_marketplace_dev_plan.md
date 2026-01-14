# VS Code Skill Marketplace 插件开发方案

## 1. 项目背景

随着 Claude Agent Skills、Antigravity Skills 等 Agent 能力体系逐渐成熟，Skill 正在成为一种事实上的“能力分发单元”。  
目前 Skill 的获取、浏览和管理方式分散且原始，缺乏 IDE 原生、工程师友好的入口。

本项目旨在开发一个 **Antigravity 插件**，以“插件市场”的交互方式，集中浏览、安装和管理基于 `SKILL.md` 的 Agent Skills。

---

## 2. 项目目标

### 2.1 核心目标

- 提供一个 Antigravity 内置的 **Skill Marketplace 浏览界面**
- 支持 Agent Skills 以及语义兼容的通用 Skill
- 降低 Skill 的发现、安装与维护成本

### 2.2 非目标（明确不做）

- 不执行 Skill
- 不作为 Agent 运行时
- 不参与模型决策或 Tool 调用
- 不解析 Skill 内部逻辑

---

## 3. 设计原则

1. **平台无关性**

   - Skill 核心以 `SKILL.md` 为最低通用单元
   - 插件不绑定 Claude 或 Antigravity 私有协议

2. **职责单一**

   - 插件 = Skill 管理工具
   - Agent = Skill 使用者

3. **IDE 原生体验**

   - 使用 VS Code WebView
   - 类似插件市场的交互方式

4. **可扩展性**

   - 支持多 Skill 源（GitHub / 私有仓库 / VSIX）
   - **可配置路径**：支持自定义本地 Skill 存储目录，适配不同 Agent 环境
   - 未来可扩展到 Copilot / 其他 Agent

5. **安全性与可靠性**
   - 严格校验 Skill 名称，防止路径遍历攻击
   - 支持 Git 和 Zip/VSIX 双重下载机制，保证环境兼容性

---

## 4. 技术选型

### 4.1 插件技术栈

- VS Code Extension API
- TypeScript (ESNext)
- Node.js (LTS)
- WebView（HTML / CSS / JS, 使用 VS Code 原生设计语言）
- **构建工具**：esbuild（开发模式开启 `sourcemap` 以优化 WebView 调试体验）

### 4.2 工程配置

- 脚手架：`yo code`
- `.gitignore`：Node
- License：MIT License
- 构建工具：esbuild

---

## 5. 总体架构

```
VS Code Extension
│
├─ Command Layer
│   └─ Open Skill Marketplace
│
├─ WebView UI
│   ├─ Skill 列表
│   ├─ 搜索 / 过滤
│   └─ 安装 / 已安装状态
│
├─ Skill Provider
│   ├─ 本地 Skill 扫描 (支持自定义路径配置 `antigravity.skillsPath`)
│   └─ 远程 Skill Index
│
└─ Skill Installer
    ├─ Git Clone / Download (优先 Git，支持 Zip 回退)
    └─ 本地目录写入 (带安全性检查)
```

---

## 6. Skill 规范假设

### 6.1 最低通用 Skill 结构

```
skill-name/
└── SKILL.md
```

### 6.2 SKILL.md 语义约定（平台无关）

- Purpose / Scope
- When to use
- How to think
- How to act
- Constraints
- Examples（可选）

---

## 7. 插件功能规划

### 7.1 MVP 功能

- 打开 Skill Marketplace 页面
- 展示 Skill 列表（name / description）
- 判断是否已安装
- 一键安装 Skill
- 打开并编辑本地 `SKILL.md`

### 7.2 后续可扩展功能

- Skill 更新检测
- Skill 版本管理
- 多仓库源切换
- 本地 Skill 分类 / 标签
- Skill 模板生成向导

---

### 8.1 远程来源方案

1.  **Index JSON (推荐)**: 插件获取 `index.json` 渲染市场列表。
2.  **VSIX Package**: 允许将 Skill 及其元数据打包为 `.vsix` 文件（实质为 ZIP 结构），支持离线安装分发。

`index.json` 示例：

```json
[
  {
    "name": "qt-cpp-helper",
    "version": "1.0.0",
    "description": "Debug Qt/C++ projects",
    "category": ["Utility", "Coding"],
    "repo": "https://github.com/xxx/qt-cpp-helper",
    "downloadUrl": "https://xxx.com/skills/qt-cpp-helper.vsix",
    "minAgentVersion": "1.2.0"
  }
]
```

插件通过 HTTP 获取 index.json 并渲染市场列表。

---

## 9. 安装流程设计

1. WebView 点击 Install（或通过本地命令“Install from VSIX...”）
2. Extension 接收消息/路径
3. 若为远程 URL，则下载；若为本地 VSIX，则直接处理
4. **解压解析**：若是 VSIX 格式，解压并校验内部 `SKILL.md`
5. 写入本地 Skill 目录
6. 刷新 UI 状态

本地目录示例：

```
~/.claude/skills/
└── qt-cpp-helper/
    └── SKILL.md
```

---

## 10. 风险与约束

- 无官方统一 Skill Marketplace API
- Skill 质量依赖社区
- WebView 安全限制（CSP）
- 不同平台 Skill 行为语义差异

---

## 11. 项目阶段划分

### Phase 1

- 插件骨架
- WebView 打开
- 本地 Skill 扫描

### Phase 2

- 远程 Skill Index
- 安装流程
- UI 优化

### Phase 3

- 扩展源支持
- Skill 编辑增强
- 发布 VS Code Marketplace

---

## 12. 总结

本项目定位为 **Agent Skill 生态的 IDE 入口工具**。  
它不试图定义 Agent 的未来，而是为 Skill 的生产、分发和使用提供一个工程化、可持续的基础设施。
