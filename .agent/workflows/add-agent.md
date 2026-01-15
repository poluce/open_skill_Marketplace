---
description: 如何向技能市场添加对新 Agent 工具的支持
---

# 添加新 Agent 支持工作流

本工作流指导开发者如何为技能市场增加对新的 Agent 工具（如 Windsurf, Cody, Cline 等）的安装分发支持。

## ⚠️ 核心前置要求：深度调研

在开始编写代码前，**必须**执行以下调研步骤，确保路径的通用性和准确性：

1.  **确定工具名称**：Agent 的标准 ID（建议小写，如 `cursor`）。
2.  **查找全局路径 (Global Path)**：
    - 该 Agent 存储全局技能指令的默认目录。
    - 典型路径如 `~/.agent-name/skills`。
    - **注意**：需验证在 Windows, macOS, Linux 下是否存在路径差异。
3.  **查找项目路径 (Project Path)**：
    - 该 Agent 在项目工作区内检测技能的特有隐藏目录。
    - 典型路径如 `.agent-name/skills`。
4.  **识别特例**：
    - 是否存在路径为单数（如 `skill` 而非 `skills`）的情况？
    - 是否兼容其他 Agent 的路径（如 Cline 兼容 `.claude/skills`）？

---

## 步骤 1：在配置文件中注册

### 1.1 修改 `package.json`

在 `contributes.configuration.properties["antigravity.agentType"]` 下：

- 在 `enum` 数组中增加新 Agent 的 ID。
- 在 `enumDescriptions` 数组中增加对应的显示名称。

---

## 步骤 2：实现 Agent 策略类

### 2.1 创建或修改策略文件

- 推荐在 `src/services/agents/` 下创建独立的 `[AgentID]Agent.ts`（如 `CursorAgent.ts`）。
- 或者在 `DefaultAgents.ts` 中追加新的类实现。

### 2.2 实现 `IAgent` 接口

```typescript
import { IAgent } from "../../models/Agent";
import * as path from "path";

export class CursorAgent implements IAgent {
  id = "cursor"; // 对应 package.json 的 enum
  name = "Cursor IDE";

  getGlobalPath(home: string): string {
    return path.join(home, ".cursor", "skills");
  }

  getProjectPath(root: string): string {
    return path.join(root, ".cursor", "skills");
  }
}
```

---

## 步骤 3：在管理器中集成

### 3.1 修改 `src/services/AgentManager.ts`

在 `AgentManager` 的构造函数中，参照以下模式注册：

```typescript
    private constructor() {
        [
            new AntigravityAgent(),
            new ClaudeAgent(),
            new CodexAgent(),
            new OpenCodeAgent(),
            new YourNewAgent() // 在此处添加
        ].forEach(agent => this.registerAgent(agent));
    }
```

---

## 步骤 4：UI 层同步（可选）

### 4.1 修改 [resources/marketplace.html](file:///resources/marketplace.html)

- 找到 `#agentTypeSelect` 元素。
- 增加对应的 `<option value="your-id">Your Name</option>`，确保与 `package.json` 中的枚举一致。

---

## 步骤 5：验证与打包

1.  **编译检查**：运行 `npm run compile` 确保无类型错误。
2.  **路径测试**：在插件内切换到新 Agent，尝试安装一个技能，检查本地目标目录是否正确创建并下载了文件。
3.  **打包**：执行 `npm run package` 或相关的打包脚本生成 VSIX。
