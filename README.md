# 通用技能市场 (Skill Marketplace)

一款通用的 Agent Skill 市场插件，提供集成在 IDE 内部的原生界面，用于浏览、安装和管理来自不同源的 Agent Skill。

## 支持平台 (Support Matrix)

| 平台                                | 安装范围    | 状态      |
| ----------------------------------- | ----------- | --------- |
| **Antigravity** (Google Gemini CLI) | 全局 / 项目 | ✅ 已支持 |
| **Claude Code CLI**                 | 全局 / 项目 | ✅ 已支持 |
| **Codex CLI**                       | 全局 / 项目 | ✅ 已支持 |
| **Open Code**                       | 全局 / 项目 | ✅ 已支持 |

## 核心功能

- **多 Agent 精准分发**：支持将技能安装到不同 Agent 的特定存储路径。
- **双路径安装模式**：支持安装到“全局用户目录”或“当前项目工作区”。
- **同名冲突解决**：采用 `source:id` 模式确保不同来源的同名技能互不干扰，物理路径自动映射为 `source--id`。
- **智能环境校验**：安装前自动检查 Agent 工具是否已安装，并验证工作区状态。
- **多语言驱动**：支持通过 DeepSeek 自动将技能描述翻译为中文，并自动识别 AI 分类。
- **直观界面布局**：采用纵向按钮设计（查看/安装），优化了在高分屏下的预览体验。

## 界面预览

![发现技能 - 列表展示](https://raw.githubusercontent.com/poluce/open_skill_Marketplace/dev/resources/Snipaste_2026-01-16_13-31-58.png)
*发现技能：支持多源筛选与 AI 智能分类，纵向按钮布局提升操作效率。*

![已安装 - 管理界面](https://raw.githubusercontent.com/poluce/open_skill_Marketplace/dev/resources/Snipaste_2026-01-16_13-31-25.png)
*已安装：清晰展示已集成到不同 Agent 的技能，支持一键删除。*

## 已集成技能源

| 源名称      | 仓库                                                                                    | 分支   | 说明                     |
| ----------- | --------------------------------------------------------------------------------------- | ------ | ------------------------ |
| Anthropic   | [anthropics/skills](https://github.com/anthropics/skills)                               | main   | Claude 官方技能库        |
| OpenAI      | [openai/skills](https://github.com/openai/skills)                                       | main   | OpenAI 官方技能库        |
| HuggingFace | [huggingface/skills](https://github.com/huggingface/skills)                             | main   | HuggingFace 官方技能库   |
| Superpowers | [obra/superpowers](https://github.com/obra/superpowers)                                 | main   | 高质量开发工作流技能     |
| Composio    | [ComposioHQ/awesome-claude-skills](https://github.com/ComposioHQ/awesome-claude-skills) | master | 社区贡献的多样化技能集合 |
| Obsidian    | [kepano/obsidian-skills](https://github.com/kepano/obsidian-skills)                     | main   | Obsidian 官方提供的代理技能 |
| ClaudeKit   | [mrgoonie/claudekit-skills](https://github.com/mrgoonie/claudekit-skills)               | main   | Claude 能力扩展工具包     |
| Scientific  | [K-Dense-AI/claude-scientific-skills](https://github.com/K-Dense-AI/claude-scientific-skills) | main   | 专注于科学计算与分析的技能 |
| Bear2u      | [bear2u/my-skills](https://github.com/bear2u/my-skills)                               | master | 个人开发的实用工具技能集   |
| n8n         | [czlonkowski/n8n-skills](https://github.com/czlonkowski/n8n-skills)                   | main   | n8n 自动化工作流集成技能   |

## 插件设置

- `antigravity.agentType`: 目标 Agent 类型 (antigravity/claude/codex/opencode)。
- `antigravity.installScope`: 技能安装范围 (global/project)。
- `antigravity.skillsPath`: 自定义本地技能目录路径（覆盖默认路径）。
- `antigravity.githubToken`: GitHub 个人访问令牌 (解除 API 频率限制)。
- `antigravity.deepseekApiKey`: 用于技能描述自动翻译的 API Key。
- `antigravity.accentColor`: 界面主题强调色自定义。

## 版本历史

### 0.0.2 (当前)

- **多 Agent 支持**：新增对 Claude, Codex, Open Code 的安装支持。
- **布局优化**：更新两行式搜索与配置栏，包含“安装位置”显式标签。
- **机制重构**：引入 ID 唯一化重构，解决 OpenAI 与 Anthropic 同名技能冲突问题。

### 0.0.1

- 初始版本，包含基础的 WebView 界面与技能抓取功能。
