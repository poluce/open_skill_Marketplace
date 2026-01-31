/**
 * 技能安装元数据
 * 存储在每个已安装技能目录的 .metadata.json 文件中
 */
export interface SkillMetadata {
    /** 技能 ID (source:name 格式) */
    skillId: string;
    /** 安装时的 commit SHA (短格式，7位) */
    installedVersion: string;
    /** 安装时间戳 */
    installedAt: number;
    /** 技能来源标识 (anthropic / openai 等) */
    source: string;
    /** 仓库所有者 */
    repoOwner: string;
    /** 仓库名称 */
    repoName: string;
    /** 技能在仓库中的完整路径 */
    skillPath: string;
    /** 仓库分支 */
    branch: string;
}
