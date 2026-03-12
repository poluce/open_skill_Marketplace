# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

This is a VS Code extension called "技能市场" (Skill Marketplace) that provides a universal marketplace for Agent Skills. It allows users to browse, install, and manage skills from multiple GitHub sources for different AI agent platforms (Antigravity/Gemini, Claude Code CLI, Codex CLI, Open Code).

**Key Features:**
- Multi-agent support with precise skill distribution to different agent storage paths
- Dual installation modes: global user directory or current project workspace
- Conflict resolution using `source:id` pattern (physical path: `source--id`)
- Automatic environment validation before installation
- Optional AI-powered translation (DeepSeek) and category detection
- WebView-based UI integrated into VS Code sidebar

## Development Commands

### Build & Development
```bash
# Install dependencies
npm install

# Compile TypeScript and bundle with esbuild
npm run compile

# Watch mode (runs type checking and esbuild in parallel)
npm run watch

# Type checking only
npm run check-types

# Lint code
npm run lint

# Package for production (minified)
npm run package
```

### Testing
```bash
# Run tests
npm test

# Compile tests
npm run compile-tests

# Watch tests
npm run watch-tests
```

### Packaging Extension
```powershell
# Use PowerShell script to package the extension
.\package_extension.ps1
```

## Architecture

### Core Components

**Extension Entry Point** (`src/extension.ts`)
- Activates the extension and registers the WebView provider
- Registers the `skill-marketplace.openMarketplace` command
- Monitors configuration changes for accent color updates

**Agent System** (Strategy Pattern)
- `src/models/Agent.ts`: `IAgent` interface defining agent contract
- `src/services/AgentManager.ts`: Singleton registry for all agent implementations
- `src/services/agents/DefaultAgents.ts`: Concrete implementations for:
  - AntigravityAgent: `~/.gemini/antigravity/global_skills` (global), `.agent/skills` (project)
  - ClaudeAgent: `~/.claude/skills` (global), `.claude/skills` (project)
  - CodexAgent: `~/.codex/skills` (global), `.codex/skills` (project)
  - OpenCodeAgent: `~/.config/opencode/skill` (global), `.opencode/skill` (project)

**Skill Management**
- `src/services/GithubSkillSource.ts`: Fetches skills from multiple GitHub repositories
  - Loads configuration from `resources/skill-sources.json`
  - Supports both `subdir` and `root` path types
  - Implements caching at `~/.gemini/marketplace_cache.json` (24-hour expiry)
  - Parses YAML frontmatter from `SKILL.md` files
- `src/services/SkillInstaller.ts`: Handles skill installation/uninstallation
  - Downloads all files from skill directory via GitHub API
  - Converts skill IDs to safe directory names (`source:id` → `source--id`)
  - Validates agent environment before installation

**UI Layer**
- `src/providers/MarketplaceProvider.ts`: WebView provider for sidebar UI
  - Handles bidirectional communication with WebView
  - Manages skill list state and installation status
  - Integrates with TranslationService for optional Chinese translation

**Translation** (`src/services/TranslationService.ts`)
- Optional DeepSeek API integration for translating skill descriptions to Chinese

### Data Models

- `src/models/Skill.ts`: Unified skill representation with repository metadata
- `src/models/ClaudeSkill.ts`: Raw skill data from GitHub sources

### Skill Sources Configuration

Skills are loaded from `resources/skill-sources.json`, which defines:
- Repository owner, name, branch
- Skills path (can be string or array for multiple paths)
- Path type (`subdir` or `root`)
- Display metadata (icon, colors, iconUrl)
- Optional excluded directories

Currently integrated sources: Anthropic, OpenAI, HuggingFace, Superpowers, Composio, Obsidian, ClaudeKit, Scientific, Bear2u, n8n, Output Skills.

## Key Technical Details

### Skill ID Format
- External format: `source:skillName` (e.g., `anthropic:algorithmic-art`)
- Filesystem format: `source--skillName` (colons replaced with double dashes)
- Conversion handled by `getSafeDirName()` and `getSkillIdFromDirName()` in SkillInstaller

### Installation Flow
1. User selects agent type and scope (global/project) in settings
2. SkillInstaller validates agent environment via AgentManager
3. Fetches file list from GitHub API for the skill directory
4. Downloads all files to target directory using raw.githubusercontent.com
5. Updates installation status in UI

### GitHub API Usage
- Uses GitHub API v3 for directory listings
- Supports optional GitHub token via `antigravity.githubToken` setting
- Rate limits: 60/hour (unauthenticated), 5000/hour (authenticated)
- Falls back to local cache on API failure

### Build System
- Uses esbuild for fast bundling (see `esbuild.js`)
- Entry point: `src/extension.ts` → `dist/extension.js`
- Production builds are minified, development builds include sourcemaps
- External dependency: `vscode` module

## Configuration Settings

All settings use the `antigravity` namespace:
- `agentType`: Target agent (antigravity/claude/codex/opencode)
- `installScope`: Installation scope (global/project)
- `skillsPath`: Custom skills directory path (overrides defaults)
- `accentColor`: UI accent color (CSS color value)
- `githubToken`: GitHub PAT for higher rate limits
- `deepseekApiKey`: DeepSeek API key for translation
- `language`: Display language ("" for original, "zh-CN" for Chinese)
- `showAiCategories`: Show/hide AI-detected categories

## Adding New Agent Support

To add a new agent platform:
1. Create a new class implementing `IAgent` in `src/services/agents/DefaultAgents.ts`
2. Define `getGlobalPath()` and `getProjectPath()` methods
3. Register the agent in `AgentManager` constructor
4. Add the agent ID to `package.json` configuration enum
5. Update README.md support matrix

## Adding New Skill Sources

To add a new skill source:
1. Add configuration to `resources/skill-sources.json`
2. Specify repository details, branch, and skills path
3. Set `pathType` to `subdir` (skills in subdirectories) or `root` (skills at root level)
4. Optionally add `excludeDirs` to skip certain directories
5. The system will automatically fetch and display skills from the new source
