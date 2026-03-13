# Tauri Rust Migration Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** 将当前 VS Code 插件项目原地重构为基于 Tauri 的本地桌面应用，前端负责界面，Rust 负责本地业务与系统能力。

**Architecture:** 仓库根目录直接切换为 Tauri 应用结构：前端使用 TypeScript UI，Rust 作为唯一业务后端，负责技能拉取、缓存、安装、更新、配置与本地文件操作。旧 VS Code 插件代码不继续作为运行主线，而是分阶段移除或迁移为新的领域实现参考。

**Tech Stack:** Tauri v2, Rust, TypeScript, 前端框架待定（优先 React）, npm, Cargo

---

### Task 1: 锁定迁移边界并保存设计文档

**Files:**
- Create: `docs/plans/2026-03-13-tauri-rust-migration-design.md`
- Modify: `docs/plans/2026-03-13-marketplace-p0-fixes.md`

**Step 1: Write the failing test**

这里不写代码测试，先定义迁移边界文档，明确：
- 不再是 VS Code 插件
- 不再保留 Agent 安装分发模型
- 翻译只保留接口占位
- 统一应用本地目录

**Step 2: Run test to verify it fails**

无自动测试；以“需求不明确无法开始实现”为失败条件。

**Step 3: Write minimal implementation**

把迁移目标、模块、目录、阶段计划写清楚，作为后续执行依据。

**Step 4: Run test to verify it passes**

人工验证：文档足以指导零上下文工程师开始实施。

**Step 5: Commit**

```bash
git add docs/plans/2026-03-13-tauri-rust-migration-design.md
git commit -m "docs: define tauri rust migration plan"
```

### Task 2: 建立新的根项目骨架

**Files:**
- Modify: `package.json`
- Create: `src-tauri/Cargo.toml`
- Create: `src-tauri/src/main.rs`
- Create: `src-tauri/src/lib.rs`
- Create: `src-tauri/tauri.conf.json`
- Create: `src/main.tsx`
- Create: `src/App.tsx`
- Create: `index.html`
- Modify: `tsconfig.json`
- Modify: `.gitignore`

**Step 1: Write the failing test**

先定义最小启动目标：
- `npm run tauri dev` 能启动前端壳
- Rust command 能返回一个健康检查字符串

**Step 2: Run test to verify it fails**

Run: `npm run tauri dev`
Expected: FAIL，因为当前仓库还不是 Tauri 项目。

**Step 3: Write minimal implementation**

建立最小 Tauri 工程骨架：
- 前端显示一个基础页面
- Rust 暴露 `health_check` 命令
- 前端调用命令并显示结果

**Step 4: Run test to verify it passes**

Run: `npm run tauri dev`
Expected: 应用窗口启动，页面能展示 Rust 返回值。

**Step 5: Commit**

```bash
git add package.json tsconfig.json .gitignore index.html src src-tauri
git commit -m "feat: scaffold tauri desktop application"
```

### Task 3: 定义 Rust 领域模型与应用目录

**Files:**
- Create: `src-tauri/src/domain/skill.rs`
- Create: `src-tauri/src/domain/source.rs`
- Create: `src-tauri/src/domain/metadata.rs`
- Create: `src-tauri/src/domain/settings.rs`
- Create: `src-tauri/src/app_paths.rs`
- Create: `src-tauri/src/commands/settings.rs`
- Test: `src-tauri/src/domain/mod.rs`

**Step 1: Write the failing test**

为应用目录函数写单测，断言会生成统一目录：
- config
- cache
- skills
- logs

**Step 2: Run test to verify it fails**

Run: `cargo test`
Expected: FAIL，因为目录模型尚未定义。

**Step 3: Write minimal implementation**

用 Rust 建立核心模型和路径函数：
- Skill
- SkillSource
- SkillMetadata
- AppSettings
- AppPaths

**Step 4: Run test to verify it passes**

Run: `cargo test`
Expected: PASS

**Step 5: Commit**

```bash
git add src-tauri/src/domain src-tauri/src/app_paths.rs src-tauri/src/commands/settings.rs
git commit -m "feat: add rust domain models and app paths"
```

### Task 4: 实现技能源配置与本地缓存

**Files:**
- Create: `src-tauri/src/services/source_loader.rs`
- Create: `src-tauri/src/services/cache.rs`
- Create: `src-tauri/src/commands/source.rs`
- Create: `resources/skill-sources.json`
- Test: `src-tauri/src/services/cache.rs`

**Step 1: Write the failing test**

为缓存读写与源配置加载写测试，断言：
- 可以读取 `resources/skill-sources.json`
- 可以写入并读取 marketplace cache

**Step 2: Run test to verify it fails**

Run: `cargo test`
Expected: FAIL

**Step 3: Write minimal implementation**

实现：
- 读取技能源配置
- 保存/加载缓存
- 向前端暴露 `list_sources` 与 `load_cached_skills`

**Step 4: Run test to verify it passes**

Run: `cargo test`
Expected: PASS

**Step 5: Commit**

```bash
git add src-tauri/src/services src-tauri/src/commands/source.rs resources/skill-sources.json
git commit -m "feat: add rust source loading and local cache"
```

### Task 5: 实现技能列表抓取

**Files:**
- Create: `src-tauri/src/services/github_client.rs`
- Create: `src-tauri/src/services/skill_fetch.rs`
- Create: `src-tauri/src/commands/skills.rs`
- Test: `src-tauri/src/services/skill_fetch.rs`

**Step 1: Write the failing test**

为技能列表转换逻辑写测试，断言：
- 多源技能会被合并
- `source:id` 格式正确
- 缺失关键字段的条目会被跳过

**Step 2: Run test to verify it fails**

Run: `cargo test`
Expected: FAIL

**Step 3: Write minimal implementation**

实现 GitHub 拉取与 Skill 映射，先只支持市场列表，不做翻译。

**Step 4: Run test to verify it passes**

Run: `cargo test`
Expected: PASS

**Step 5: Commit**

```bash
git add src-tauri/src/services/github_client.rs src-tauri/src/services/skill_fetch.rs src-tauri/src/commands/skills.rs
git commit -m "feat: fetch marketplace skills in rust"
```

### Task 6: 实现安装、卸载、更新、恢复

**Files:**
- Create: `src-tauri/src/services/install.rs`
- Create: `src-tauri/src/services/git_repo.rs`
- Create: `src-tauri/src/commands/install.rs`
- Test: `src-tauri/src/services/install.rs`

**Step 1: Write the failing test**

写安装路径与元数据测试，断言：
- 安装目录使用统一应用路径
- 技能 ID 生成安全目录名
- metadata 被正确写入

**Step 2: Run test to verify it fails**

Run: `cargo test`
Expected: FAIL

**Step 3: Write minimal implementation**

实现：
- install skill
- uninstall skill
- check local modified
- restore official version
- update skill

**Step 4: Run test to verify it passes**

Run: `cargo test`
Expected: PASS

**Step 5: Commit**

```bash
git add src-tauri/src/services/install.rs src-tauri/src/services/git_repo.rs src-tauri/src/commands/install.rs
git commit -m "feat: add rust skill lifecycle management"
```

### Task 7: 添加翻译接口占位

**Files:**
- Create: `src-tauri/src/services/translation/mod.rs`
- Create: `src-tauri/src/services/translation/noop.rs`
- Create: `src-tauri/src/commands/translation.rs`
- Test: `src-tauri/src/services/translation/noop.rs`

**Step 1: Write the failing test**

为 Noop provider 写测试，断言返回原文且不报错。

**Step 2: Run test to verify it fails**

Run: `cargo test`
Expected: FAIL

**Step 3: Write minimal implementation**

定义翻译接口与 Noop 实现，前端可以调用，但不做真实翻译。

**Step 4: Run test to verify it passes**

Run: `cargo test`
Expected: PASS

**Step 5: Commit**

```bash
git add src-tauri/src/services/translation src-tauri/src/commands/translation.rs
git commit -m "feat: add translation placeholder interface"
```

### Task 8: 建立最小前端界面

**Files:**
- Modify: `src/App.tsx`
- Create: `src/components/SkillList.tsx`
- Create: `src/components/SettingsPanel.tsx`
- Create: `src/hooks/useSkills.ts`
- Create: `src/hooks/useSettings.ts`
- Test: `src/components/SkillList.test.tsx`

**Step 1: Write the failing test**

为前端基础展示逻辑写测试，断言：
- 可以展示技能列表
- 可以显示加载中/错误态
- 设置页可读取当前配置

**Step 2: Run test to verify it fails**

Run: `npm test`
Expected: FAIL

**Step 3: Write minimal implementation**

实现最小 UI：
- 市场列表页
- 设置页
- 安装按钮
- 刷新按钮

**Step 4: Run test to verify it passes**

Run: `npm test`
Expected: PASS

**Step 5: Commit**

```bash
git add src/App.tsx src/components src/hooks
git commit -m "feat: add tauri marketplace frontend shell"
```

### Task 9: 移除 VS Code 插件运行入口

**Files:**
- Delete: `src/extension.ts`
- Delete: `src/providers/MarketplaceProvider.ts`
- Delete: `src/services/AgentManager.ts`
- Delete: `src/services/agents/DefaultAgents.ts`
- Modify: `package.json`
- Modify: `README.md`

**Step 1: Write the failing test**

验证根项目不再依赖 VS Code 扩展入口，构建命令仍可执行。

**Step 2: Run test to verify it fails**

Run: `npm run compile`
Expected: FAIL，因为旧入口仍被构建脚本依赖。

**Step 3: Write minimal implementation**

删除或替换 VS Code 插件特有入口与依赖，更新脚本到 Tauri 模式。

**Step 4: Run test to verify it passes**

Run: `npm run tauri build`
Expected: PASS

**Step 5: Commit**

```bash
git add -u
git commit -m "refactor: remove vscode extension runtime"
```

### Task 10: 最终验证

**Files:**
- Modify: `package.json`
- Modify: `src-tauri/**`
- Modify: `src/**`

**Step 1: Run Rust tests**

Run: `cargo test --manifest-path src-tauri/Cargo.toml`
Expected: PASS

**Step 2: Run frontend checks**

Run: `npm run compile`
Expected: PASS

**Step 3: Run desktop app locally**

Run: `npm run tauri dev`
Expected: 桌面应用正常打开。

**Step 4: Review diff**

确认最终仓库已经完成从 VS Code 插件到 Tauri 本地应用的形态转换。

**Step 5: Commit**

```bash
git add package.json src src-tauri README.md
git commit -m "feat: migrate marketplace to tauri rust desktop app"
```
