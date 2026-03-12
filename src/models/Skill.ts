export interface Skill {
    id: number | string;
    name: string;
    desc: string;
    category: string;
    icon: string;
    colors: [string, string];
    isFeatured?: boolean;
    repoLink?: string;
    isInstalled?: boolean;
    /** 仓库所有者 (anthropics / openai) */
    repoOwner?: string;
    /** 仓库名称 (skills) */
    repoName?: string;
    /** 技能在仓库中的完整路径 */
    skillPath?: string;
    /** 技能来源标识 (anthropic / openai) */
    source?: string;
    /** 仓库分支 (main / master) */
    branch?: string;
    /** 翻译后的描述 (显示决策权交由前端) */
    translatedDesc?: string;
    /** AI 识别的分类 (显示决策权交由前端) */
    aiCategory?: string;
    /** 最新 commit SHA (短格式，7位) */
    commitSha?: string;
    /** 最后更新时间戳 */
    lastUpdated?: number;
    /** 是否有可用更新 */
    hasUpdate?: boolean;
    /** 已安装的版本 SHA */
    installedVersion?: string;
    /** 是否被用户修改（从元数据读取） */
    isLocalModified?: boolean;
}
