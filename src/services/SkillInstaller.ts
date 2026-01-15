import * as vscode from 'vscode';
import * as path from 'path';
import * as fs from 'fs';
import * as https from 'https';
import * as os from 'os';
import { Skill } from '../models/Skill';

const RAW_GITHUB_BASE = 'https://raw.githubusercontent.com';
const GITHUB_API_BASE = 'https://api.github.com';

import { AgentManager } from './AgentManager';

/**
 * 技能安装服务
 * 负责将技能从 GitHub 下载并安装到本地目录
 */
export class SkillInstaller {

    /**
     * 获取安装目标路径，并执行环境校验
     */
    getInstallPath(): string {
        const config = vscode.workspace.getConfiguration('antigravity');
        const agentId = config.get<string>('agentType', 'antigravity');
        const scope = config.get<string>('installScope', 'global');

        const agent = AgentManager.getInstance().getAgent(agentId);
        if (!agent) {
            throw new Error(`未知的 Agent 类型: ${agentId}`);
        }

        // 优先锁定基准目录
        let basePath = '';
        if (scope === 'project') {
            const workspaceFolder = vscode.workspace.workspaceFolders?.[0];
            if (!workspaceFolder) {
                throw new Error('请先打开一个 VS Code 项目或工作区以进行项目级安装。');
            }
            basePath = workspaceFolder.uri.fsPath;
        } else {
            basePath = os.homedir();
        }

        // 根据 Agent 策略动态获取路径
        const finalPath = scope === 'project' 
            ? agent.getProjectPath(basePath)
            : agent.getGlobalPath(basePath);

        // 全局校验：如果目录不存在，提示用户安装 Agent
        if (scope === 'global' && !fs.existsSync(finalPath)) {
            // 注意：对于 Open Code 这种深层路径，可能需要检查其父目录
            const checkPath = agentId === 'opencode' ? path.dirname(finalPath) : finalPath;
            if (!fs.existsSync(checkPath)) {
                throw new Error(`未检测到 ${agent.name} 的环境，请先安装该 Agent 工具。`);
            }
        }

        // 执行 Agent 特有的进一步验证 (可选)
        if (agent.validate) {
            agent.validate(finalPath);
        }

        return finalPath;
    }

    private getAgentName(type: string): string {
        const agent = AgentManager.getInstance().getAgent(type);
        return agent ? agent.name : type;
    }

    /**
     * 将技能 ID 转换为安全的文件目录名
     * 例如: "anthropic:algorithmic-art" -> "anthropic--algorithmic-art"
     */
    private getSafeDirName(skillId: string): string {
        return skillId.replace(/:/g, '--');
    }

    /**
     * 将目录名还原为技能 ID (用于扫描已安装列表)
     * 例如: "anthropic--algorithmic-art" -> "anthropic:algorithmic-art"
     */
    private getSkillIdFromDirName(dirName: string): string {
        return dirName.replace(/--/g, ':');
    }

    /**
     * 获取已安装的技能 ID 列表
     */
    getInstalledSkillIds(): string[] {
        const installPath = this.getInstallPath();

        if (!fs.existsSync(installPath)) {
            return [];
        }

        try {
            const entries = fs.readdirSync(installPath, { withFileTypes: true });
            return entries
                .filter(entry => entry.isDirectory())
                .filter(entry => {
                    // 检查目录中是否有 SKILL.md 文件
                    const skillMdPath = path.join(installPath, entry.name, 'SKILL.md');
                    return fs.existsSync(skillMdPath);
                })
                .map(entry => this.getSkillIdFromDirName(entry.name));
        } catch {
            return [];
        }
    }

    /**
     * 检查某个技能是否已安装
     */
    isSkillInstalled(skillId: string): boolean {
        const skillPath = path.join(this.getInstallPath(), this.getSafeDirName(skillId), 'SKILL.md');
        return fs.existsSync(skillPath);
    }

    /**
     * 删除已安装的技能
     */
    uninstallSkill(skillId: string, skillName: string): boolean {
        const skillDir = path.join(this.getInstallPath(), this.getSafeDirName(skillId));

        if (!fs.existsSync(skillDir)) {
            vscode.window.showWarningMessage(`技能 "${skillName}" 未安装`);
            return false;
        }

        try {
            // 递归删除目录
            fs.rmSync(skillDir, { recursive: true, force: true });
            return true;
        } catch (error) {
            const errMsg = error instanceof Error ? error.message : String(error);
            vscode.window.showErrorMessage(`删除失败: ${errMsg}`);
            return false;
        }
    }

    /**
     * 安装技能
     * @param skill 完整的 Skill 对象，包含仓库信息
     */
    async installSkill(skill: Skill): Promise<boolean> {
        const skillId = String(skill.id);
        const targetDir = path.join(this.getInstallPath(), this.getSafeDirName(skillId));

        const config = vscode.workspace.getConfiguration('antigravity');
        const scope = config.get<string>('installScope', 'global');
        if (scope === 'project' && !vscode.workspace.workspaceFolders?.[0]) {
            vscode.window.showWarningMessage('当前未打开 VS Code 工作区，技能将安装到全局目录（~/.gemini/skills/）');
        }

        // 验证必要的仓库信息
        if (!skill.repoOwner || !skill.repoName || !skill.skillPath) {
            vscode.window.showErrorMessage(`技能 "${skill.name}" 缺少仓库信息，无法安装`);
            return false;
        }

        try {
            // 1. 获取技能目录下的所有文件列表
            const files = await this.fetchSkillFiles(skill);

            if (files.length === 0) {
                vscode.window.showErrorMessage(`技能 "${skill.name}" 没有找到可安装的文件`);
                return false;
            }

            // 2. 创建目标目录
            if (!fs.existsSync(targetDir)) {
                fs.mkdirSync(targetDir, { recursive: true });
            }

            // 3. 下载所有文件
            const downloadPromises = files.map(file =>
                this.downloadFile(skill, file.path, path.join(targetDir, file.name))
            );

            await Promise.all(downloadPromises);

            vscode.window.showInformationMessage(`技能 "${skill.name}" 已安装到 ${targetDir}`);
            return true;

        } catch (error) {
            const errMsg = error instanceof Error ? error.message : String(error);
            vscode.window.showErrorMessage(`安装失败: ${errMsg}`);
            return false;
        }
    }

    /**
     * 获取技能目录下的所有文件
     * @param skill 包含仓库信息的 Skill 对象
     */
    private async fetchSkillFiles(skill: Skill): Promise<Array<{ name: string; path: string }>> {
        return new Promise((resolve, reject) => {
            const url = `${GITHUB_API_BASE}/repos/${skill.repoOwner}/${skill.repoName}/contents/${skill.skillPath}`;
            const config = vscode.workspace.getConfiguration('antigravity');
            const token = config.get<string>('githubToken', '');

            const headers: any = {
                'User-Agent': 'VSCode-Antigravity-SkillMarketplace',
                'Accept': 'application/vnd.github.v3+json'
            };

            if (token) {
                headers['Authorization'] = `token ${token}`;
            }

            const options = {
                headers
            };

            https.get(url, options, (res) => {
                let data = '';
                res.on('data', chunk => data += chunk);
                res.on('end', () => {
                    if (res.statusCode === 200) {
                        try {
                            const items = JSON.parse(data);
                            const files = items
                                .filter((item: { type: string }) => item.type === 'file')
                                .map((item: { name: string; path: string }) => ({
                                    name: item.name,
                                    path: item.path
                                }));
                            resolve(files);
                        } catch (e) {
                            reject(new Error('解析文件列表失败'));
                        }
                    } else {
                        reject(new Error(`获取文件列表失败: ${res.statusCode}`));
                    }
                });
            }).on('error', reject);
        });
    }

    /**
     * 下载单个文件
     * @param skill 包含仓库信息的 Skill 对象
     * @param filePath 文件在仓库中的完整路径
     * @param targetPath 本地保存路径
     */
    private downloadFile(skill: Skill, filePath: string, targetPath: string): Promise<void> {
        return new Promise((resolve, reject) => {
            const branch = skill.branch || 'main';
            const url = `${RAW_GITHUB_BASE}/${skill.repoOwner}/${skill.repoName}/${branch}/${filePath}`;

            https.get(url, (res) => {
                if (res.statusCode === 200) {
                    const writeStream = fs.createWriteStream(targetPath);
                    res.pipe(writeStream);
                    writeStream.on('finish', () => {
                        writeStream.close();
                        resolve();
                    });
                    writeStream.on('error', reject);
                } else {
                    reject(new Error(`下载 ${filePath} 失败: ${res.statusCode}`));
                }
            }).on('error', reject);
        });
    }

    /**
     * 展开路径中的 ~ 为用户主目录
     */
    private expandPath(inputPath: string): string {
        if (inputPath.startsWith('~')) {
            return path.join(os.homedir(), inputPath.slice(1));
        }
        return inputPath;
    }
}

