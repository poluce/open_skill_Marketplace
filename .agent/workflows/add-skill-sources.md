---
description: 如何向技能市场添加新的 GitHub 技能源
---

本工作流指导开发者如何向技能市场添加新的官方或第三方 GitHub 技能源。

> [!TIP]
> 从 v1.x 版本开始，添加新源**只需编辑配置文件**，无需修改任何代码！

## 添加新技能源

### 1. 编辑配置文件

打开 [skill-sources.json](file:///resources/skill-sources.json)，在 `sources` 数组中添加新对象：

```json
{
  "id": "newsource",
  "displayName": "New Source",
  "owner": "github-org-or-user",
  "repo": "repository-name",
  "branch": "main",
  "skillsPath": "skills",
  "pathType": "subdir",
  "icon": "N",
  "colors": ["#FF5733", "#C70039"],
  "iconUrl": "https://github.com/github-org-or-user.png?s=40"
}
```

### 2. 配置字段说明

| 字段          | 类型                   | 必填 | 说明                               |
| ------------- | ---------------------- | ---- | ---------------------------------- |
| `id`          | string                 | ✓    | 源唯一标识，用于内部引用和筛选     |
| `displayName` | string                 | ✓    | UI 显示名称                        |
| `owner`       | string                 | ✓    | GitHub 用户名或组织名              |
| `repo`        | string                 | ✓    | 仓库名                             |
| `branch`      | string                 | ✓    | 默认分支（如 `main` 或 `master`）  |
| `skillsPath`  | string \| string[]     | ✓    | 技能目录路径，数组表示多目录       |
| `pathType`    | `"subdir"` \| `"root"` | ✓    | 目录结构类型                       |
| `excludeDirs` | string[]               | -    | 需排除的目录（仅 `root` 类型需要） |
| `icon`        | string                 | ✓    | 技能卡片图标（emoji 或字符）       |
| `colors`      | [string, string]       | ✓    | 渐变色（起始色，结束色）           |
| `iconUrl`     | string                 | ✓    | 筛选器头像 URL                     |

### 3. 目录结构类型

**`subdir` 类型**（标准子目录结构）：

```
repo/
├── skills/           ← skillsPath: "skills"
│   ├── skill-a/
│   │   └── SKILL.md
│   └── skill-b/
│       └── SKILL.md
```

**多目录示例**（如 OpenAI）：

```json
"skillsPath": ["skills/.curated", "skills/.experimental", "skills/.system"]
```

**`root` 类型**（根目录结构）：

```
repo/
├── skill-a/          ← skillsPath: ""
│   └── SKILL.md
├── skill-b/
│   └── SKILL.md
└── .github/          ← excludeDirs: [".github", "template-skill"]
```

### 4. 验证

```bash
# 编译验证
npm run compile

# 启动调试
F5

# 检查项：
# 1. 侧边栏"高赞榜"筛选器中出现新源
# 2. 点击新源筛选器，技能列表正确过滤
# 3. 测试安装新源的技能
```

### 5. 更新 README

在 [README.md](file:///README.md) 的「已集成技能源」表格中添加新源信息。

---

## 常见问题

### Q: 技能源获取失败？

检查：

1. 仓库是否公开
2. `owner`、`repo`、`branch` 是否正确
3. `skillsPath` 是否存在
4. 技能目录中是否有 `SKILL.md` 文件

### Q: 技能不显示名称和描述？

确保 `SKILL.md` 文件包含有效的 YAML 前置数据：

```yaml
---
name: "技能名称"
description: "技能描述"
---
```
