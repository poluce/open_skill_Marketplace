# 通用技能市场桌面版 (Skill Marketplace Desktop)

这是一个只保留桌面应用代码的仓库，基于 `Tauri 2 + React + TypeScript + Vite + Rust`。
这里的代码只服务于桌面应用本身，目录已经按桌面应用开发与打包场景收口。

## 当前目录结构

```text
open_skill_Marketplace/
├─ src/                React 前端
│  ├─ app/             前端共享类型
│  ├─ components/      布局组件
│  ├─ desktop/         Tauri 业务 command 封装
│  ├─ features/        前端功能模块
│  ├─ platform/        官方插件适配层
│  ├─ App.tsx          桌面应用主界面
│  ├─ main.tsx         前端入口
│  └─ styles.css       全局样式
├─ src-tauri/          Rust 后端与 Tauri 配置
│  ├─ src/             Rust 业务实现
│  ├─ icons/           桌面应用图标
│  ├─ capabilities/    Tauri 权限配置
│  ├─ Cargo.toml       Rust 依赖与包配置
│  └─ tauri.conf.json  Tauri 应用配置
├─ resources/          桌面应用运行时资源
├─ build-desktop.ps1   桌面打包脚本
├─ dev-desktop.ps1     桌面开发脚本
└─ package.json        前端依赖与脚本
```

## 支持目标

| 平台                                | 安装范围    | 状态      |
| ----------------------------------- | ----------- | --------- |
| **Antigravity** (Google Gemini CLI) | 全局 / 项目 | 已支持 |
| **Claude Code CLI**                 | 全局 / 项目 | 已支持 |
| **Codex CLI**                       | 全局 / 项目 | 已支持 |
| **Open Code**                       | 全局 / 项目 | 已支持 |

## 核心能力

- 浏览和筛选多个技能源
- 支持安装、更新、恢复、删除技能
- 支持全局 / 项目双安装范围
- 支持多 Agent 目标目录
- 支持本地 `SKILL.md` 查看、编辑和保存
- 支持桌面端状态栏、进度事件和本地设置持久化

## 开发命令

```powershell
npm install
npm run compile
npm run tauri:dev
npm run tauri:build
```

也可以使用仓库脚本：

```powershell
./dev-desktop.ps1
./build-desktop.ps1
```
