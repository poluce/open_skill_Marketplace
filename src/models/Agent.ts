/**
 * Agent 接口定义
 * 所有的适配 Agent 必须实现此接口，以便 SkillInstaller 统一获取路径。
 */
export interface IAgent {
    /** 唯一标识符，对应 package.json 中的 enum */
    id: string;
    /** 显示名称 */
    name: string;
    /** 获取全局安装路径 */
    getGlobalPath(home: string): string;
    /** 获取项目本地安装路径 */
    getProjectPath(root: string): string;
    /** (可选) 额外的环境校验逻辑 */
    validate?(path: string): void;
}
