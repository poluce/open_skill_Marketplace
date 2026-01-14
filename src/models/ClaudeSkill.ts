/**
 * Claude 官方技能类型定义
 * 来源：https://github.com/anthropics/skills
 */
export interface ClaudeSkill {
    /** GitHub 路径名 (如 'algorithmic-art') */
    id: string;
    /** 映射自 SKILL.md 的 name */
    name: string;
    /** 映射自 SKILL.md 的 description */
    description: string;
    /** 可选许可证信息 */
    license?: string;
    /** SKILL.md 的 raw 链接 */
    rawUrl: string;
    /** GitHub 页面链接 */
    repoLink: string;
    /** 标识为官方技能 */
    isOfficial: true;
}

/**
 * 统一技能类型（兼容本地 mock 和官方技能）
 */
export interface UnifiedSkill {
    id: string | number;
    name: string;
    desc: string;
    category: string;
    icon: string;
    colors: [string, string];
    isOfficial?: boolean;
    repoLink?: string;
}
