# 通用技能市场 (Skill Marketplace)

一款通用的 Agent Skill 市场插件，提供集成在 IDE 内部的原生界面，用于浏览、安装和管理 Agent Skill。

## 支持平台

| 平台 | 状态 |
|------|------|
| Antigravity (Google Gemini CLI) | ✅ 已支持 |
| Claude Code | 🚧 计划中 |
| Cursor | 🚧 计划中 |

## 核心功能

- **技能浏览**：集成化的界面，可浏览所有可用的技能。
- **一键安装**：轻松将技能安装到您的本地 Agent 环境中。
- **技能管理**：直接从 VS Code 管理已安装的技能。

## 已集成技能源

| 源名称 | 仓库 | 分支 | 说明 |
|--------|------|------|------|
| Anthropic | [anthropics/skills](https://github.com/anthropics/skills) | main | Claude 官方技能库 |
| OpenAI | [openai/skills](https://github.com/openai/skills) | main | OpenAI 官方技能库 |
| HuggingFace | [huggingface/skills](https://github.com/huggingface/skills) | main | HuggingFace 官方技能库 |
| Superpowers | [obra/superpowers](https://github.com/obra/superpowers) | main | 高质量开发工作流技能 |
| Composio | [ComposioHQ/awesome-claude-skills](https://github.com/ComposioHQ/awesome-claude-skills) | master | 社区贡献的多样化技能集合 |

## 运行要求

- VS Code 1.90.0 或更高版本。
- Node.js (建议 v20 或更高版本以获得最佳性能)。

## 插件设置

本插件提供以下设置项：

- `antigravity.skillsPath`: 指向本地技能目录的路径。
- `antigravity.installScope`: 技能安装范围 (global/project)。
- `antigravity.githubToken`: GitHub 个人访问令牌 (解除 API 频率限制)。

## 已知问题

当前为早期 MVP 版本。如有问题，请在 GitHub 上反馈。

## 版本说明

### 0.0.1

初始 MVP 版本，包含基础的 WebView 界面。
