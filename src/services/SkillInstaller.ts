import * as vscode from 'vscode';
import * as path from 'path';
import * as fs from 'fs';
import * as https from 'https';
import * as http from 'http';
import * as os from 'os';
import { Skill } from '../models/Skill';
import { SkillMetadata } from '../models/SkillMetadata';

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
     * @param throwOnMissing 如果为 false，在环境不存在时返回空字符串而不抛出错误
     */
    getInstallPath(throwOnMissing: boolean = true): string {
        const config = vscode.workspace.getConfiguration('antigravity');
        const agentId = config.get<string>('agentType', 'antigravity');
        const scope = config.get<string>('installScope', 'global');

        const agent = AgentManager.getInstance().getAgent(agentId);
        if (!agent) {
            if (throwOnMissing) {
                throw new Error(`未知的 Agent 类型: ${agentId}`);
            }
            return '';
        }

        // 优先锁定基准目录
        let basePath = '';
        if (scope === 'project') {
            const workspaceFolder = vscode.workspace.workspaceFolders?.[0];
            if (!workspaceFolder) {
                if (throwOnMissing) {
                    throw new Error('请先打开一个 VS Code 项目或工作区以进行项目级安装。');
                }
                return '';
            }
            basePath = workspaceFolder.uri.fsPath;
        } else {
            basePath = os.homedir();
        }

        // 根据 Agent 策略动态获取路径
        const finalPath = scope === 'project'
            ? agent.getProjectPath(basePath)
            : agent.getGlobalPath(basePath);

        // 全局校验：检查 Agent 根目录是否存在
        if (scope === 'global') {
            // 定义每个 Agent 的根目录（用于检测 Agent 是否已安装）
            const agentRootDirs: Record<string, string> = {
                'antigravity': path.join(basePath, '.gemini'),
                'gemini': path.join(basePath, '.gemini'),
                'claude': path.join(basePath, '.claude'),
                'codex': path.join(basePath, '.codex'),
                'opencode': path.join(basePath, '.config', 'opencode')
            };

            const agentRootDir = agentRootDirs[agentId];

            // 检查 Agent 根目录是否存在
            if (agentRootDir && !fs.existsSync(agentRootDir)) {
                if (throwOnMissing) {
                    throw new Error(`未检测到 ${agent.name} 的环境，请先安装该 Agent 工具。`);
                }
                return '';
            }

            // 如果 Agent 根目录存在，但技能目录不存在，自动创建技能目录
            if (!fs.existsSync(finalPath)) {
                try {
                    fs.mkdirSync(finalPath, { recursive: true });
                    console.log(`已自动创建技能目录: ${finalPath}`);
                } catch (error) {
                    console.warn(`创建技能目录失败: ${error}`);
                    if (throwOnMissing) {
                        throw new Error(`无法创建技能目录: ${finalPath}`);
                    }
                    return '';
                }
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
        try {
            const installPath = this.getInstallPath(false); // 不抛出错误

            if (!installPath || !fs.existsSync(installPath)) {
                return [];
            }

            const entries = fs.readdirSync(installPath, { withFileTypes: true });
            return entries
                .filter(entry => entry.isDirectory())
                .filter(entry => {
                    // 检查目录中是否有 SKILL.md 文件
                    const skillMdPath = path.join(installPath, entry.name, 'SKILL.md');
                    return fs.existsSync(skillMdPath);
                })
                .map(entry => this.getSkillIdFromDirName(entry.name));
        } catch (error) {
            console.warn('获取已安装技能列表失败:', error instanceof Error ? error.message : String(error));
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
     * @param onProgress 可选的进度回调函数
     */
    async installSkill(skill: Skill, onProgress?: (current: number, total: number) => void): Promise<boolean> {
        const skillId = String(skill.id);
        const targetDir = path.join(this.getInstallPath(), this.getSafeDirName(skillId));

        const config = vscode.workspace.getConfiguration('antigravity');
        const scope = config.get<string>('installScope', 'global');
        if (scope === 'project' && !vscode.workspace.workspaceFolders?.[0]) {
            vscode.window.showWarningMessage('当前未打开 VS Code 工作区，技能将安装到全局目录（~/.gemini/antigravity/global_skills/）');
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
                throw new Error('没有找到可安装的文件');
            }

            // 2. 创建目标目录
            if (!fs.existsSync(targetDir)) {
                fs.mkdirSync(targetDir, { recursive: true });
            }

            // 3. 下载所有文件（串行下载以便追踪进度）
            let completed = 0;
            const total = files.length;

            for (const file of files) {
                await this.downloadFile(skill, file.path, path.join(targetDir, file.name));
                completed++;
                if (onProgress) {
                    onProgress(completed, total);
                }
            }

            // 4. 保存元数据
            this.saveMetadata(skill, targetDir);

            vscode.window.showInformationMessage(`技能 "${skill.name}" 已安装到 ${targetDir}`);
            return true;

        } catch (error) {
            const errMsg = error instanceof Error ? error.message : String(error);

            // 错误恢复：删除半成品目录
            if (fs.existsSync(targetDir)) {
                try {
                    fs.rmSync(targetDir, { recursive: true, force: true });
                    console.log(`已清理失败的安装目录: ${targetDir}`);
                } catch (cleanupError) {
                    console.error('清理失败目录时出错:', cleanupError);
                }
            }

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

            const headers: Record<string, string> = {
                'User-Agent': 'VSCode-Antigravity-SkillMarketplace',
                'Accept': 'application/vnd.github.v3+json'
            };

            if (token) {
                headers['Authorization'] = `token ${token}`;
            }

            const options = {
                headers
            };

            https.get(url, options, (res: http.IncomingMessage) => {
                let data = '';
                res.on('data', (chunk: Buffer | string) => data += chunk);
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

            https.get(url, (res: http.IncomingMessage) => {
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

    /**
     * 保存技能安装元数据
     */
    private saveMetadata(skill: Skill, targetDir: string): void {
        const metadata: SkillMetadata = {
            skillId: String(skill.id),
            installedVersion: skill.commitSha || 'unknown',
            installedAt: Date.now(),
            source: skill.source || '',
            repoOwner: skill.repoOwner || '',
            repoName: skill.repoName || '',
            skillPath: skill.skillPath || '',
            branch: skill.branch || 'main'
        };

        const metadataPath = path.join(targetDir, '.metadata.json');
        fs.writeFileSync(metadataPath, JSON.stringify(metadata, null, 2), 'utf8');
    }

    /**
     * 读取技能元数据
     */
    private readMetadata(skillDir: string): SkillMetadata | null {
        try {
            const metadataPath = path.join(skillDir, '.metadata.json');
            if (fs.existsSync(metadataPath)) {
                return JSON.parse(fs.readFileSync(metadataPath, 'utf8'));
            }
        } catch (error) {
            console.warn('读取元数据失败:', error);
        }
        return null;
    }

    /**
     * 为旧技能生成元数据（向后兼容）
     */
    private generateLegacyMetadata(skillId: string, skillDir: string): void {
        const metadata: SkillMetadata = {
            skillId: skillId,
            installedVersion: 'legacy',
            installedAt: Date.now(),
            source: skillId.split(':')[0] || 'unknown',
            repoOwner: '',
            repoName: '',
            skillPath: '',
            branch: 'main'
        };

        const metadataPath = path.join(skillDir, '.metadata.json');
        fs.writeFileSync(metadataPath, JSON.stringify(metadata, null, 2), 'utf8');
    }

    /**
     * 检测已安装技能的更新状态
     */
    async checkUpdates(
        allSkills: Skill[]
    ): Promise<Map<string, { hasUpdate: boolean; installedVersion: string; latestVersion: string }>> {
        const updateMap = new Map();
        const installPath = this.getInstallPath(false); // 不抛出错误

        if (!installPath || !fs.existsSync(installPath)) {
            return updateMap;
        }

        const entries = fs.readdirSync(installPath, { withFileTypes: true });

        for (const entry of entries) {
            if (!entry.isDirectory()) {continue;}

            const skillDir = path.join(installPath, entry.name);
            let metadata = this.readMetadata(skillDir);

            // 向后兼容：如果没有元数据，生成一个
            if (!metadata) {
                const skillId = this.getSkillIdFromDirName(entry.name);
                this.generateLegacyMetadata(skillId, skillDir);
                metadata = this.readMetadata(skillDir);
            }

            if (!metadata) {continue;}

            // 从 allSkills 中找到对应的技能（包含最新 commitSha）
            const latestSkill = allSkills.find(s => String(s.id) === metadata!.skillId);

            if (latestSkill && latestSkill.commitSha) {
                const hasUpdate = metadata.installedVersion !== latestSkill.commitSha
                               && metadata.installedVersion !== 'legacy';
                updateMap.set(metadata.skillId, {
                    hasUpdate,
                    installedVersion: metadata.installedVersion,
                    latestVersion: latestSkill.commitSha
                });
            }
        }

        return updateMap;
    }

    /**
     * 更新技能（先删除后重新安装）
     */
    async updateSkill(skill: Skill, onProgress?: (current: number, total: number) => void): Promise<boolean> {
        const skillId = String(skill.id);
        const skillDir = path.join(this.getInstallPath(), this.getSafeDirName(skillId));

        // 删除旧版本
        if (fs.existsSync(skillDir)) {
            fs.rmSync(skillDir, { recursive: true, force: true });
        }

        // 重新安装
        const success = await this.installSkill(skill, onProgress);

        if (success) {
            vscode.window.showInformationMessage(`技能 "${skill.name}" 已更新到最新版本`);
        }

        return success;
    }
}

