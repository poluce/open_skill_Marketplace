import * as vscode from 'vscode';
import * as path from 'path';
import * as fs from 'fs';
import { promises as fsPromises } from 'fs';
import * as https from 'https';
import * as http from 'http';
import * as os from 'os';
import { execSync } from 'child_process';
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
    private gitAvailable: boolean | null = null;

    /**
     * 检测 git 是否可用
     */
    private isGitAvailable(): boolean {
        if (this.gitAvailable !== null) {
            return this.gitAvailable;
        }

        try {
            execSync('git --version', { stdio: 'ignore' });
            this.gitAvailable = true;
            return true;
        } catch (error) {
            this.gitAvailable = false;
            console.warn('Git 不可用，技能修改检测功能将受限');
            return false;
        }
    }

    /**
     * 创建 Junction（目录联接）
     * @param target 目标目录（实际文件所在）
     * @param link Junction 路径
     */
    createJunction(target: string, link: string): boolean {
        try {
            console.log(`创建 Junction: ${link} -> ${target}`);

            // 如果 link 已存在，先删除
            if (fs.existsSync(link)) {
                console.log(`Junction 路径已存在，先删除: ${link}`);
                if (this.isJunction(link)) {
                    this.removeJunction(link);
                } else {
                    fs.rmSync(link, { recursive: true, force: true });
                }
            }

            // Windows: mklink /J
            // Linux/Mac: ln -s
            if (process.platform === 'win32') {
                const cmd = `mklink /J "${link}" "${target}"`;
                console.log(`执行命令: ${cmd}`);
                execSync(cmd, { shell: 'cmd.exe' });
            } else {
                execSync(`ln -s "${target}" "${link}"`);
            }
            console.log('Junction 创建成功');
            return true;
        } catch (error) {
            console.error('创建 Junction 失败:', error);
            vscode.window.showWarningMessage(`创建 Junction 失败: ${error instanceof Error ? error.message : String(error)}`);
            return false;
        }
    }

    /**
     * 检查路径是否是 Junction
     */
    private isJunction(dirPath: string): boolean {
        try {
            const stats = fs.lstatSync(dirPath);
            return stats.isSymbolicLink();
        } catch {
            return false;
        }
    }

    /**
     * 删除 Junction（不会删除目标内容）
     */
    removeJunction(junctionPath: string): boolean {
        try {
            if (!fs.existsSync(junctionPath)) {
                return true;
            }

            if (!this.isJunction(junctionPath)) {
                console.warn(`${junctionPath} 不是 Junction，跳过删除`);
                return false;
            }

            // Windows: rmdir（不会删除目标内容）
            // Linux/Mac: unlink
            if (process.platform === 'win32') {
                execSync(`rmdir "${junctionPath}"`, { stdio: 'ignore', shell: 'cmd.exe' });
            } else {
                fs.unlinkSync(junctionPath);
            }
            return true;
        } catch (error) {
            console.error('删除 Junction 失败:', error);
            return false;
        }
    }

    /**
     * 更新元数据中的 junctionPath
     */
    updateMetadataJunctionPath(skillDir: string, junctionPath: string): void {
        try {
            const metadataPath = path.join(skillDir, '.metadata.json');
            if (fs.existsSync(metadataPath)) {
                const metadata = JSON.parse(fs.readFileSync(metadataPath, 'utf8'));
                metadata.junctionPath = junctionPath;
                fs.writeFileSync(metadataPath, JSON.stringify(metadata, null, 2), 'utf8');
            }
        } catch (error) {
            console.warn('更新元数据失败:', error);
        }
    }

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
    getSafeDirName(skillId: string): string {
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
     * @param storagePath 可选的扩展存储路径（用于 Junction 模式）
     */
    async uninstallSkill(skillId: string, skillName: string, storagePath?: string): Promise<boolean> {
        const safeDirName = this.getSafeDirName(skillId);
        const junctionDir = path.join(this.getInstallPath(), safeDirName);
        const actualDir = storagePath
            ? path.join(storagePath, safeDirName)
            : junctionDir;

        if (!fs.existsSync(junctionDir) && !fs.existsSync(actualDir)) {
            vscode.window.showWarningMessage(`技能 "${skillName}" 未安装`);
            return false;
        }

        try {
            // 1. 删除 Junction（如果是 Junction）
            if (storagePath && this.isJunction(junctionDir)) {
                this.removeJunction(junctionDir);
            } else if (fs.existsSync(junctionDir) && !storagePath) {
                // 非 Junction 模式，直接删除目录
                await this.safeRemoveDir(junctionDir);
                return true;
            }

            // 2. 删除实际目录
            if (fs.existsSync(actualDir)) {
                await this.safeRemoveDir(actualDir);
            }

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
     * @param storagePath 可选的扩展存储路径（用于 Junction 模式）
     */
    async installSkill(skill: Skill, onProgress?: (current: number, total: number) => void, storagePath?: string): Promise<boolean> {
        const skillId = String(skill.id);
        const safeDirName = this.getSafeDirName(skillId);

        // 实际文件存储在扩展存储目录（如果提供了 storagePath）
        const actualDir = storagePath
            ? path.join(storagePath, safeDirName)
            : path.join(this.getInstallPath(), safeDirName);

        // 用户目录的 Junction 路径
        const junctionDir = path.join(this.getInstallPath(), safeDirName);

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

            // 2. 创建实际存储目录
            if (!fs.existsSync(actualDir)) {
                fs.mkdirSync(actualDir, { recursive: true });
            }

            // 3. 下载所有文件（串行下载以便追踪进度）
            let completed = 0;
            const total = files.length;

            for (const file of files) {
                await this.downloadFile(skill, file.path, path.join(actualDir, file.name));
                completed++;
                if (onProgress) {
                    onProgress(completed, total);
                }
            }

            // 4. 保存元数据（包含 junctionPath）
            this.saveMetadata(skill, actualDir, storagePath ? junctionDir : undefined);

            // 5. 初始化 git 仓库并提交初始版本
            await this.initGitRepo(actualDir);

            // 6. 如果使用存储路径，创建 Junction
            if (storagePath && actualDir !== junctionDir) {
                // 确保用户目录存在
                const userSkillsDir = this.getInstallPath();
                if (!fs.existsSync(userSkillsDir)) {
                    fs.mkdirSync(userSkillsDir, { recursive: true });
                }

                // 创建 Junction
                const junctionSuccess = this.createJunction(actualDir, junctionDir);
                if (!junctionSuccess) {
                    console.warn('创建 Junction 失败，技能仍可通过实际路径访问');
                }
            }

            vscode.window.showInformationMessage(`技能 "${skill.name}" 已安装到 ${junctionDir}`);
            return true;

        } catch (error) {
            const errMsg = error instanceof Error ? error.message : String(error);

            // 错误恢复：删除半成品目录
            if (fs.existsSync(actualDir)) {
                try {
                    fs.rmSync(actualDir, { recursive: true, force: true });
                    console.log(`已清理失败的安装目录: ${actualDir}`);
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
    private saveMetadata(skill: Skill, targetDir: string, junctionPath?: string): void {
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

        if (junctionPath) {
            metadata.junctionPath = junctionPath;
        }

        const metadataPath = path.join(targetDir, '.metadata.json');
        fs.writeFileSync(metadataPath, JSON.stringify(metadata, null, 2), 'utf8');
    }

    /**
     * 读取技能元数据
     */
    readMetadata(skillDir: string): SkillMetadata | null {
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
     * 初始化 git 仓库并提交初始版本
     */
    private async initGitRepo(skillDir: string): Promise<void> {
        if (!this.isGitAvailable()) {
            return; // git 不可用，跳过
        }

        try {
            // 初始化 git 仓库
            execSync('git init', { cwd: skillDir, stdio: 'ignore' });

            // 设置临时用户信息（避免全局配置缺失导致提交失败）
            execSync('git config user.name "Skill Marketplace"', { cwd: skillDir, stdio: 'ignore' });
            execSync('git config user.email "marketplace@local"', { cwd: skillDir, stdio: 'ignore' });

            // 添加所有文件
            execSync('git add -A', { cwd: skillDir, stdio: 'ignore' });

            // 提交初始版本（禁用 GPG 签名）
            execSync('git commit --no-gpg-sign -m "Initial install from marketplace"', { cwd: skillDir, stdio: 'ignore' });
        } catch (error) {
            console.warn('初始化 git 仓库失败:', error);
        }
    }

    /**
     * 检测技能是否有本地修改（通过 git status）
     */
    checkLocalModified(skillDir: string): boolean {
        try {
            const gitDir = path.join(skillDir, '.git');
            if (!fs.existsSync(gitDir)) {
                return false; // 没有 git 仓库，无法检测
            }
            // git status --porcelain 返回空字符串表示没有修改
            const status = execSync('git status --porcelain', { cwd: skillDir, encoding: 'utf8' });
            return status.trim().length > 0;
        } catch (error) {
            console.warn('检测本地修改失败:', error);
            return false;
        }
    }

    /**
     * 恢复技能到官方版本（通过 git checkout）
     */
    async restoreToOfficialVersion(skillDir: string): Promise<boolean> {
        try {
            const gitDir = path.join(skillDir, '.git');
            if (!fs.existsSync(gitDir)) {
                return false;
            }
            // 恢复所有文件到初始状态
            execSync('git checkout .', { cwd: skillDir, stdio: 'ignore' });
            // 清理未跟踪的文件
            execSync('git clean -fd', { cwd: skillDir, stdio: 'ignore' });
            return true;
        } catch (error) {
            console.warn('恢复官方版本失败:', error);
            return false;
        }
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

            // 新增：跳过本地修改的技能
            if (metadata.isLocalModified) {
                continue;
            }

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
     * 在文件浏览器中打开技能目录
     */
    async revealSkillInExplorer(skillId: string): Promise<boolean> {
        const skillDir = path.join(this.getInstallPath(), this.getSafeDirName(skillId));

        if (!fs.existsSync(skillDir)) {
            return false;
        }

        const uri = vscode.Uri.file(skillDir);
        await vscode.commands.executeCommand('revealFileInOS', uri);

        return true;
    }

    /**
     * 打开技能目录进行编辑
     */
    async openSkillForEdit(skillId: string): Promise<boolean> {
        const skillDir = path.join(this.getInstallPath(), this.getSafeDirName(skillId));

        if (!fs.existsSync(skillDir)) {
            return false;
        }

        // 打开 SKILL.md 文件进行编辑（而不是整个目录，避免文件占用）
        const skillMdPath = path.join(skillDir, 'SKILL.md');
        if (fs.existsSync(skillMdPath)) {
            const uri = vscode.Uri.file(skillMdPath);
            await vscode.commands.executeCommand('vscode.open', uri);
        } else {
            // 如果没有 SKILL.md，则在文件资源管理器中显示目录
            const uri = vscode.Uri.file(skillDir);
            await vscode.commands.executeCommand('revealFileInOS', uri);
        }

        return true;
    }

    /**
     * 安全删除目录（带重试逻辑，解决 Windows 文件占用问题）
     */
    private async safeRemoveDir(dirPath: string, maxRetries: number = 5): Promise<void> {
        for (let i = 0; i < maxRetries; i++) {
            try {
                if (fs.existsSync(dirPath)) {
                    await fsPromises.rm(dirPath, { recursive: true, force: true, maxRetries: 3, retryDelay: 100 });
                }
                return; // 成功删除，退出
            } catch (error: any) {
                if (i === maxRetries - 1) {
                    // 最后一次重试失败，抛出错误
                    throw new Error(`无法删除目录 ${dirPath}: ${error.message}\n\n可能原因：文件被占用（请关闭相关文件或文件夹）`);
                }
                // 指数退避：200ms, 400ms, 800ms, 1600ms
                const delay = 200 * Math.pow(2, i);
                await new Promise(resolve => setTimeout(resolve, delay));
            }
        }
    }

    /**
     * 恢复官方版本（优先使用 git 恢复，否则重新安装）
     * @param storagePath 可选的扩展存储路径（用于 Junction 模式）
     */
    async restoreOfficialVersion(skill: Skill, storagePath?: string): Promise<boolean> {
        const skillId = String(skill.id);
        const safeDirName = this.getSafeDirName(skillId);

        // 实际文件目录
        const actualDir = storagePath
            ? path.join(storagePath, safeDirName)
            : path.join(this.getInstallPath(), safeDirName);

        // 优先尝试 git 恢复（更快，不需要重新下载）
        const gitDir = path.join(actualDir, '.git');
        if (fs.existsSync(gitDir)) {
            const success = await this.restoreToOfficialVersion(actualDir);
            if (success) {
                vscode.window.showInformationMessage(`技能 "${skill.name}" 已恢复到官方版本`);
                return true;
            }
        }

        // git 恢复失败或没有 git 仓库，则删除后重新安装
        try {
            await this.safeRemoveDir(actualDir);

            // 如果是 Junction 模式，也删除 Junction
            if (storagePath) {
                const junctionDir = path.join(this.getInstallPath(), safeDirName);
                if (this.isJunction(junctionDir)) {
                    this.removeJunction(junctionDir);
                }
            }
        } catch (error: any) {
            vscode.window.showErrorMessage(error.message);
            return false;
        }

        return await this.installSkill(skill, undefined, storagePath);
    }

    /**
     * 更新技能（先删除后重新安装）
     * @param storagePath 可选的扩展存储路径（用于 Junction 模式）
     */
    async updateSkill(skill: Skill, onProgress?: (current: number, total: number) => void, storagePath?: string): Promise<boolean> {
        const skillId = String(skill.id);
        const safeDirName = this.getSafeDirName(skillId);

        // 实际文件目录
        const actualDir = storagePath
            ? path.join(storagePath, safeDirName)
            : path.join(this.getInstallPath(), safeDirName);

        // 删除旧版本（使用安全删除方法）
        try {
            await this.safeRemoveDir(actualDir);

            // 如果是 Junction 模式，也删除 Junction
            if (storagePath) {
                const junctionDir = path.join(this.getInstallPath(), safeDirName);
                if (this.isJunction(junctionDir)) {
                    this.removeJunction(junctionDir);
                }
            }
        } catch (error: any) {
            vscode.window.showErrorMessage(error.message);
            return false;
        }

        // 重新安装
        const success = await this.installSkill(skill, onProgress, storagePath);

        if (success) {
            vscode.window.showInformationMessage(`技能 "${skill.name}" 已更新到最新版本`);
        }

        return success;
    }
}

