---
description: 如何向技能市场添加新的 GitHub 技能源
---

本工作流指导开发者如何向 Antigravity 技能市场添加新的官方或第三方 GitHub 技能源（例如 OpenAI, Google 等）。

### 1. 定义技能源类

在 [GithubSkillSource.ts](file:///e:/Document/open_skill_Marketplace/src/services/GithubSkillSource.ts) 中创建一个继承自 `BaseSkillSource` 的新类。

**基础模版：**

```typescript
/**
 * [源名称] 技能源
 */
export class NewSkillSource extends BaseSkillSource {
  protected owner = "组织名/用户名";
  protected repo = "仓库名";
  protected defaultBranch = "main"; // 或 'master'

  async fetchSkills(): Promise<Skill[]> {
    // 实现抓取逻辑
  }
}
```

### 2. 实现 fetchSkills 逻辑

根据仓库结构实现目录遍历逻辑：

- **单目录结构**：参考 `AnthropicSkillSource`。
- **多目录结构**：参考 `OpenAISkillSource`（通过数组遍历多个路径）。
- **根目录结构**：参考 `ComposioSkillSource`（技能直接在根目录下）。

**关键步骤：**

1. 使用 `this.fetchGithubApi` 获取目录列表。
2. 对每个子目录调用 `this.fetchSkillMetadata(路径, 目录名)`。
3. 将结果映射为 `Skill` 对象，确保包含：
   - `icon`: 该源的特征图标（如 "O" 代表 OpenAI）。
   - `colors`: 对应的品牌颜色。
   - `source`: 唯一的源标识符。
   - `skillPath`: 在仓库中的相对路径。
   - `branch`: 仓库分支（`this.defaultBranch`）。

### 3. 注册技能源

在 `GithubSkillSource` 类的 `sources` 数组中实例化并添加你的新类：

```typescript
export class GithubSkillSource {
  private sources: BaseSkillSource[] = [
    new AnthropicSkillSource(),
    new OpenAISkillSource(),
    new HuggingFaceSkillSource(),
    new SuperpowersSkillSource(),
    new ComposioSkillSource(),
    new NewSkillSource(), // 在此添加
  ];
  // ...
}
```

### 4. (可选) 添加内置种子数据

为了保证在 API 受限时仍能看到该源的代表性技能，可以在 `GithubSkillSource` 类的 `seedSkills` 数组中添加该源的技能条目。**注意：种子数据必须包含 `branch` 字段。**

### 5. 在 UI 中注册二级筛选器

打开 [marketplace.html](file:///e:/Document/open_skill_Marketplace/resources/marketplace.html)，在 `sourceFilterContainer` 中添加新源的筛选芯片：

```html
<div
  class="sub-filter-chip"
  data-source="newsource"
  onclick="setSourceFilter('newsource')"
>
  <span class="source-icon" style="background: [品牌色];"></span> [源名称]
</div>
```

并在 `createSkillCard` 函数的 `sourceMap` 对象中添加名称映射：

```javascript
const sourceMap = {
  // ...
  newsource: "New Source Display Name",
};
```

### 6. 更新 README

在 [README.md](file:///e:/Document/open_skill_Marketplace/README.md) 的「已集成技能源」表格中添加新源的信息。

### 7. 验证

1. 运行 `npm run compile` 确保无类型错误。
2. 启动调试，在"可安装"页面的"来源"筛选器中检查是否出现了新的选项。
3. 测试安装新源的技能，确认下载正常完成。
