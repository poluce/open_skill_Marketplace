export interface Skill {
    id: number | string;
    name: string;
    desc: string;
    category: string;
    icon: string;
    colors: [string, string];
    isOfficial?: boolean;
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
}
