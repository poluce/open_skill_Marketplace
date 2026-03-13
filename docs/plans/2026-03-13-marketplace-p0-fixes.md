# Marketplace P0 Fixes Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** 修复技能安装遗漏嵌套文件与多源缓存验证漏更新问题，并补上最小测试支撑。

**Architecture:** 维持现有服务边界不变，在 `SkillInstaller` 中补充可测试的递归文件收集与按相对路径落盘能力，在 `GithubSkillSource` 中将单仓库缓存签名改为多源聚合签名。测试只覆盖新增的可预测纯逻辑，避免引入复杂的 VS Code 集成测试。

**Tech Stack:** TypeScript, Node.js, VS Code Extension API, Mocha, assert

---

### Task 1: 为递归安装逻辑建立失败测试

**Files:**
- Modify: `src/test/extension.test.ts`
- Modify: `src/services/SkillInstaller.ts`

**Step 1: Write the failing test**

在 `src/test/extension.test.ts` 中新增一个纯逻辑测试，构造 GitHub contents API 的目录响应：

```ts
const items = [
  { type: 'file', path: 'skill/SKILL.md', name: 'SKILL.md' },
  { type: 'dir', path: 'skill/scripts', name: 'scripts' },
  { type: 'file', path: 'skill/scripts/helper.js', name: 'helper.js' }
];
```

断言文件收集结果至少包含：
- `SKILL.md`
- `scripts/helper.js`

**Step 2: Run test to verify it fails**

Run: `npm test`
Expected: FAIL，因为当前实现没有递归目录，也没有保留子目录相对路径。

**Step 3: Write minimal implementation support**

在 `src/services/SkillInstaller.ts` 中提炼一个可测试纯函数，负责：
- 读取 contents 项数组
- 过滤文件项
- 输出相对技能目录的文件路径列表

**Step 4: Run test to verify it passes**

Run: `npm test`
Expected: PASS

**Step 5: Commit**

```bash
git add src/test/extension.test.ts src/services/SkillInstaller.ts
git commit -m "test: cover nested skill file collection"
```

### Task 2: 修复技能安装的递归下载与子目录写入

**Files:**
- Modify: `src/services/SkillInstaller.ts`
- Test: `src/test/extension.test.ts`

**Step 1: Write the failing test**

增加一个测试，断言下载目标路径保留相对目录，而不是把 `scripts/helper.js` 拍平成 `helper.js`。

示例断言：

```ts
assert.strictEqual(buildInstallTargetPath('C:/target', 'scripts/helper.js'), 'C:/target/scripts/helper.js');
```

**Step 2: Run test to verify it fails**

Run: `npm test`
Expected: FAIL，因为当前安装逻辑使用 `path.join(actualDir, file.name)`。

**Step 3: Write minimal implementation**

在 `src/services/SkillInstaller.ts` 中：
- 递归读取 GitHub 目录
- 文件列表保留相对路径
- 下载时用相对路径生成目标文件
- 写入前创建父目录

**Step 4: Run test to verify it passes**

Run: `npm test`
Expected: PASS

**Step 5: Commit**

```bash
git add src/services/SkillInstaller.ts src/test/extension.test.ts
git commit -m "fix: install nested skill files recursively"
```

### Task 3: 为多源缓存校验建立失败测试

**Files:**
- Modify: `src/test/extension.test.ts`
- Modify: `src/services/GithubSkillSource.ts`

**Step 1: Write the failing test**

新增一个纯逻辑测试，输入两个源的签名：

```ts
const cached = ['anthropic:abc', 'openai:def'];
const current = ['anthropic:abc', 'openai:xyz'];
```

断言缓存判定结果为失效。

**Step 2: Run test to verify it fails**

Run: `npm test`
Expected: FAIL，因为当前实现只看第一个源。

**Step 3: Write minimal implementation support**

在 `src/services/GithubSkillSource.ts` 中提炼可测试纯函数，负责：
- 规范化多源签名
- 比较缓存签名与当前签名是否完全一致

**Step 4: Run test to verify it passes**

Run: `npm test`
Expected: PASS

**Step 5: Commit**

```bash
git add src/services/GithubSkillSource.ts src/test/extension.test.ts
git commit -m "test: cover multi-source cache validation"
```

### Task 4: 修复多源缓存验证逻辑

**Files:**
- Modify: `src/services/GithubSkillSource.ts`
- Test: `src/test/extension.test.ts`

**Step 1: Write the failing test**

增加一个测试，模拟第一个源不变、第二个源变化的场景，断言整体缓存不可复用。

**Step 2: Run test to verify it fails**

Run: `npm test`
Expected: FAIL

**Step 3: Write minimal implementation**

在 `src/services/GithubSkillSource.ts` 中：
- 为每个 source 获取独立版本标识
- 缓存中保存多源签名数组
- 验证时比较完整签名集合
- 网络失败时继续保留本地缓存回退策略

**Step 4: Run test to verify it passes**

Run: `npm test`
Expected: PASS

**Step 5: Commit**

```bash
git add src/services/GithubSkillSource.ts src/test/extension.test.ts
git commit -m "fix: validate cache freshness across all sources"
```

### Task 5: 最小回归验证

**Files:**
- Modify: `src/services/SkillInstaller.ts`
- Modify: `src/services/GithubSkillSource.ts`
- Modify: `src/test/extension.test.ts`

**Step 1: Run type check**

Run: `npm run check-types`
Expected: PASS

**Step 2: Run tests**

Run: `npm test`
Expected: PASS

**Step 3: Run compile**

Run: `npm run compile`
Expected: PASS

**Step 4: Review diff for scope control**

确认只涉及：
- 递归安装
- 多源缓存校验
- 最小测试支撑

**Step 5: Commit**

```bash
git add src/services/SkillInstaller.ts src/services/GithubSkillSource.ts src/test/extension.test.ts
git commit -m "fix: resolve marketplace installation and cache p0 bugs"
```
