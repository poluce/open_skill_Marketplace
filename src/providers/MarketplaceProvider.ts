import * as vscode from 'vscode';
import * as path from 'path';
import * as fs from 'fs';
import * as os from 'os';
import { Skill } from '../models/Skill';
import { GithubSkillSource } from '../services/GithubSkillSource';
import { SkillInstaller } from '../services/SkillInstaller';
import { TranslationService } from '../services/TranslationService';

export class SkillMarketplaceViewProvider implements vscode.WebviewViewProvider {

    public static readonly viewType = 'skill-marketplace.views.sidebar';
    private _view?: vscode.WebviewView;
    private _githubSource: GithubSkillSource;
    private _installer: SkillInstaller;
    private _translator: TranslationService;
    private _allSkills: Skill[] = [];
    private _fileWatcher?: vscode.FileSystemWatcher;
    private _storageWatcher?: vscode.FileSystemWatcher;

    constructor(
        private readonly _extensionUri: vscode.Uri,
        private readonly _globalStorageUri: vscode.Uri,
    ) {
        this._githubSource = new GithubSkillSource();
        this._installer = new SkillInstaller();
        this._translator = new TranslationService();
    }

    /**
     * 清理资源
     */
    public dispose(): void {
        if (this._fileWatcher) {
            this._fileWatcher.dispose();
        }
        if (this._storageWatcher) {
            this._storageWatcher.dispose();
        }
    }

    /**
     * 获取技能实际存储路径
     * 优先使用 ~/.skill-marketplace/skills，权限不足时回退到 VS Code 存储目录
     */
    private getSkillStoragePath(): string {
        const preferredPath = path.join(os.homedir(), '.skill-marketplace', 'skills');
        try {
            if (!fs.existsSync(preferredPath)) {
                fs.mkdirSync(preferredPath, { recursive: true });
            }
            return preferredPath;
        } catch {
            // 权限不足时回退到 VS Code 存储目录
            return path.join(this._globalStorageUri.fsPath, 'skills');
        }
    }

    public async resolveWebviewView(
        webviewView: vscode.WebviewView,
        context: vscode.WebviewViewResolveContext,
        _token: vscode.CancellationToken,
    ) {
        this._view = webviewView;

        webviewView.webview.options = {
            enableScripts: true,
            localResourceRoots: [this._extensionUri]
        };

        // 初始为空列表
        this._allSkills = [];
        webviewView.webview.html = this._getHtmlForWebview(webviewView.webview);

        // 异步加载高赞技能
        this._loadOfficialSkills();

        webviewView.webview.onDidReceiveMessage(async data => {
            switch (data.command) {
                case 'install':
                    this._handleInstall(data.skillId, data.skillName);
                    break;
                case 'uninstall':
                    this._handleUninstall(data.skillId, data.skillName);
                    break;
                case 'update':
                    this._handleUpdate(data.skillId, data.skillName);
                    break;
                case 'editSkill':
                    this._handleEditSkill(data.skillId, data.skillName);
                    break;
                case 'restoreOfficial':
                    this._handleRestoreOfficial(data.skillId, data.skillName);
                    break;
                case 'revealInExplorer':
                    this._handleRevealInExplorer(data.skillId);
                    break;
                case 'showDetail':
                    this._showSkillDetail(data.skillId);
                    break;
                case 'openRepo':
                    if (data.url) {
                        vscode.env.openExternal(vscode.Uri.parse(data.url));
                    }
                    break;
                case 'search':
                    // 搜索由前端 updateUI() 实时处理，后端无需响应
                    break;
                case 'ready':
                    this._refreshView();
                    break;
                case 'configureToken':
                    this._handleConfigureToken();
                    break;
                case 'setLanguage':
                    this._handleSetLanguage(data.lang);
                    break;
                case 'setAgentType':
                    await vscode.workspace.getConfiguration('antigravity').update('agentType', data.agentType, vscode.ConfigurationTarget.Global);
                    this._updateInstalledStatus();
                    this._refreshView();
                    break;
                case 'setScope':
                    await vscode.workspace.getConfiguration('antigravity').update('installScope', data.scope, vscode.ConfigurationTarget.Global);
                    this._updateInstalledStatus();
                    this._refreshView();
                    break;
                case 'setShowAiCategories':
                    vscode.workspace.getConfiguration('antigravity').update('showAiCategories', data.show, vscode.ConfigurationTarget.Global);
                    break;
            }
        });

        this.updateAccentColor();

        // 监听配置变更，迁移 Junction
        vscode.workspace.onDidChangeConfiguration(e => {
            if (e.affectsConfiguration('antigravity.agentType') ||
                e.affectsConfiguration('antigravity.installScope')) {
                this._migrateJunctions();
            }
        });

        // 设置文件监听器，监控技能目录的文件变化
        this._setupFileWatcher();
    }

    /**
     * 配置变更时迁移 Junction
     * 实际文件位置固定在扩展存储目录，只需重建 Junction 到新的用户目录
     */
    private async _migrateJunctions(): Promise<void> {
        const skillsStoragePath = this.getSkillStoragePath();

        if (!fs.existsSync(skillsStoragePath)) {
            return;
        }

        // 获取所有已安装技能
        const skillDirs = fs.readdirSync(skillsStoragePath, { withFileTypes: true })
            .filter(d => d.isDirectory())
            .map(d => d.name);

        if (skillDirs.length === 0) {
            return;
        }

        // 获取新的用户目录
        const newInstallPath = this._installer.getInstallPath(false);
        if (!newInstallPath) {
            return;
        }

        // 确保新目录存在
        if (!fs.existsSync(newInstallPath)) {
            fs.mkdirSync(newInstallPath, { recursive: true });
        }

        // 为每个技能创建 Junction
        for (const skillDir of skillDirs) {
            const actualPath = path.join(skillsStoragePath, skillDir);
            const junctionPath = path.join(newInstallPath, skillDir);

            // 读取元数据，清理旧的 Junction
            const metadata = this._installer.readMetadata(actualPath);
            if (metadata?.junctionPath && metadata.junctionPath !== junctionPath) {
                // 删除旧的 Junction
                this._installer.removeJunction(metadata.junctionPath);
            }

            // 如果 Junction 已存在，跳过
            if (fs.existsSync(junctionPath)) {
                continue;
            }

            // 创建 Junction
            const success = this._installer.createJunction(actualPath, junctionPath);
            if (success) {
                // 更新元数据中的 junctionPath
                this._installer.updateMetadataJunctionPath(actualPath, junctionPath);
            }
        }

        // 重新设置文件监听器（监听新目录）
        this._setupFileWatcher();
    }

    /**
     * 设置文件监听器，监控已安装技能目录的文件变化
     */
    private _setupFileWatcher(): void {
        // 清理旧的监听器
        if (this._fileWatcher) {
            this._fileWatcher.dispose();
        }
        if (this._storageWatcher) {
            this._storageWatcher.dispose();
        }

        // 防抖：避免频繁刷新
        let debounceTimer: NodeJS.Timeout | undefined;
        const debouncedRefresh = () => {
            if (debounceTimer) {
                clearTimeout(debounceTimer);
            }
            debounceTimer = setTimeout(() => {
                console.log('文件变化检测，更新本地修改状态');
                this._updateLocalModifiedStatus();
            }, 500);
        };

        // 监听实际存储目录（这是主要的监听目标）
        const storagePath = this.getSkillStoragePath();
        if (storagePath && fs.existsSync(storagePath)) {
            const storagePattern = new vscode.RelativePattern(storagePath, '**/*');
            this._storageWatcher = vscode.workspace.createFileSystemWatcher(storagePattern);
            this._storageWatcher.onDidChange(debouncedRefresh);
            this._storageWatcher.onDidCreate(debouncedRefresh);
            this._storageWatcher.onDidDelete(debouncedRefresh);
            console.log('已设置存储目录监听器:', storagePath);
        }

        // 也监听 Junction 目录（备用）
        const installPath = this._installer.getInstallPath(false);
        if (installPath && fs.existsSync(installPath)) {
            const pattern = new vscode.RelativePattern(installPath, '**/*');
            this._fileWatcher = vscode.workspace.createFileSystemWatcher(pattern);
            this._fileWatcher.onDidChange(debouncedRefresh);
            this._fileWatcher.onDidCreate(debouncedRefresh);
            this._fileWatcher.onDidDelete(debouncedRefresh);
        }
    }

    /**
     * 更新所有已安装技能的本地修改状态
     */
    private _updateLocalModifiedStatus(): void {
        const installPath = this._installer.getInstallPath(false);
        if (!installPath) {
            return;
        }

        let hasChanges = false;
        for (const skill of this._allSkills) {
            if (skill.isInstalled) {
                const skillDir = path.join(installPath, this._installer.getSafeDirName(String(skill.id)));
                const isModified = this._installer.checkLocalModified(skillDir);
                if (skill.isLocalModified !== isModified) {
                    skill.isLocalModified = isModified;
                    hasChanges = true;
                }
            }
        }

        if (hasChanges) {
            this._refreshView();
        }
    }

    /**
     * 异步加载高赞技能
     */
    private async _loadOfficialSkills() {
        try {
            const result = await this._githubSource.fetchSkillList();
            const officialSkills = result.skills;
            const isRateLimited = result.isRateLimited;

            // 标记已安装状态
            this._updateInstalledStatus(officialSkills);

            // 检测更新
            const updateMap = await this._installer.checkUpdates(officialSkills);
            for (const skill of officialSkills) {
                const updateInfo = updateMap.get(String(skill.id));
                if (updateInfo) {
                    skill.hasUpdate = updateInfo.hasUpdate;
                    skill.installedVersion = updateInfo.installedVersion;
                }
            }

            // 新增：使用 git 检测本地修改状态
            for (const skill of officialSkills) {
                if (skill.isInstalled) {
                    const skillDir = path.join(
                        this._installer.getInstallPath(false),
                        this._installer.getSafeDirName(String(skill.id))
                    );
                    // 使用 git status 检测是否有本地修改
                    skill.isLocalModified = this._installer.checkLocalModified(skillDir);
                }
            }

            // 1. 尝试从本地缓存预填充翻译和分类（实现零等待切换）
            for (const skill of officialSkills) {
                const cached = this._translator.getCachedTranslation(String(skill.id));
                if (cached) {
                    skill.translatedDesc = cached.translated;
                    skill.aiCategory = cached.category;
                }
            }

            this._allSkills = [...officialSkills];
            this._refreshView(isRateLimited);

            // 2. 异步增量翻译（仅针对无缓存的内容）
            this._translateSkillDescriptions();
        } catch (error) {
            console.error('加载高赞技能失败:', error);
            this._refreshView(true);
        }
    }

    /**
     * 更新技能的已安装状态标记
     */
    private _updateInstalledStatus(skills: Skill[] = this._allSkills) {
        if (skills.length === 0) {
            return;
        }
        const installedIds = this._installer.getInstalledSkillIds();
        for (const skill of skills) {
            skill.isInstalled = installedIds.includes(String(skill.id));
        }
    }

    /**
     * 异步翻译技能描述
     */
    private async _translateSkillDescriptions() {
        // 仅找出真正需要翻译（无缓存）的技能
        const skillsToTranslate = this._allSkills
            .filter(s => !s.translatedDesc)
            .map(s => ({ id: String(s.id), desc: s.desc }));

        if (skillsToTranslate.length === 0) {
            return;
        }

        // 调用翻译，带进度回调
        const translations = await this._translator.translateSkills(skillsToTranslate, (current, total) => {
            if (this._view) {
                this._view.webview.postMessage({
                    command: 'translationProgress',
                    progress: Math.round((current / total) * 100)
                });
            }
        });

        // 更新翻译描述和 AI 分类字段（不覆盖原始属性）
        for (const skill of this._allSkills) {
            const result = translations.get(String(skill.id));
            if (result) {
                if (result.translated) {
                    skill.translatedDesc = result.translated;
                }
                if (result.category) {
                    skill.aiCategory = result.category;
                }
            }
        }

        // 刷新视图并隐藏进度条
        this._refreshView();
        if (this._view) {
            this._view.webview.postMessage({ command: 'translationProgress', progress: 100, finished: true });
        }
    }

    /**
     * 刷新 WebView
     */
    private _refreshView(isRateLimited: boolean = false) {
        if (this._view) {
            this._view.webview.postMessage({
                command: 'updateSkills',
                skills: this._allSkills,
                isRateLimited
            });
        }
    }

    /**
     * 处理安装请求
     */
    private async _handleInstall(skillId: string | number, skillName: string) {
        // 使用更健壮的匹配（不区分 string/number 类型）
        const skill = this._allSkills.find(s => String(s.id) === String(skillId));

        if (!skill) {
            vscode.window.showErrorMessage(`未找到技能: ${skillName}`);
            return;
        }

        // 使用 VS Code Progress API 显示进度
        await vscode.window.withProgress(
            {
                location: vscode.ProgressLocation.Notification,
                title: `正在安装 "${skillName}"`,
                cancellable: false
            },
            async (progress) => {
                const success = await this._installer.installSkill(skill, (current, total) => {
                    const percentage = Math.round((current / total) * 100);
                    progress.report({
                        increment: 100 / total,
                        message: `${current}/${total} 文件 (${percentage}%)`
                    });
                }, this.getSkillStoragePath());

                if (success) {
                    // 更新已安装状态并刷新视图
                    skill.isInstalled = true;
                    this._refreshView();
                }

                return success;
            }
        );
    }

    /**
     * 处理删除请求
     */
    private async _handleUninstall(skillId: string | number, skillName: string) {
        const skill = this._allSkills.find(s => s.id === skillId);

        if (!skill) {
            return;
        }

        // 执行删除
        const success = await this._installer.uninstallSkill(String(skillId), skillName, this.getSkillStoragePath());

        if (success) {
            skill.isInstalled = false;
            this._refreshView();
        }
    }

    /**
     * 处理更新请求
     */
    private async _handleUpdate(skillId: string | number, skillName: string) {
        const skill = this._allSkills.find(s => String(s.id) === String(skillId));

        if (!skill) {
            vscode.window.showErrorMessage(`未找到技能: ${skillName}`);
            return;
        }

        // 使用 VS Code Progress API 显示进度
        await vscode.window.withProgress(
            {
                location: vscode.ProgressLocation.Notification,
                title: `正在更新 "${skillName}"`,
                cancellable: false
            },
            async (progress) => {
                const success = await this._installer.updateSkill(skill, (current, total) => {
                    const percentage = Math.round((current / total) * 100);
                    progress.report({
                        increment: 100 / total,
                        message: `${current}/${total} 文件 (${percentage}%)`
                    });
                }, this.getSkillStoragePath());

                if (success) {
                    skill.hasUpdate = false;
                    skill.installedVersion = skill.commitSha;
                    this._refreshView();
                }

                return success;
            }
        );
    }

    /**
     * 显示技能详情页
     */
    private async _showSkillDetail(skillId: string | number) {
        const skill = this._allSkills.find(s => String(s.id) === String(skillId));

        if (!skill) {
            vscode.window.showErrorMessage('未找到技能详情');
            return;
        }

        try {
            let filePath: string;

            // 如果已安装，打开实际安装的文件（可编辑，修改能被检测）
            if (skill.isInstalled) {
                const installPath = this._installer.getInstallPath(false);
                if (installPath) {
                    filePath = path.join(installPath, this._installer.getSafeDirName(String(skill.id)), 'SKILL.md');

                    if (fs.existsSync(filePath)) {
                        // 打开实际安装的文件
                        const doc = await vscode.workspace.openTextDocument(filePath);
                        await vscode.window.showTextDocument(doc, {
                            viewColumn: vscode.ViewColumn.One,
                            preview: false  // 非预览模式，可编辑
                        });

                        // 自动打开 Markdown 预览
                        await vscode.commands.executeCommand('markdown.showPreviewToSide');
                        return;
                    }
                }
            }

            // 未安装时，打开缓存文件（只读预览）
            const cacheDir = path.join(os.homedir(), '.gemini', 'skill_cache');
            if (!fs.existsSync(cacheDir)) {
                fs.mkdirSync(cacheDir, { recursive: true });
            }

            // 使用技能 ID 作为文件名（确保唯一性）
            const safeSkillId = String(skill.id).replace(/[^a-zA-Z0-9_-]/g, '_');
            const cacheFilePath = path.join(cacheDir, `${safeSkillId}.md`);

            // 检查缓存是否存在且未过期（24小时）
            let needsDownload = true;
            if (fs.existsSync(cacheFilePath)) {
                const stats = fs.statSync(cacheFilePath);
                const ageInHours = (Date.now() - stats.mtimeMs) / (1000 * 60 * 60);
                needsDownload = ageInHours > 24;
            }

            if (needsDownload) {
                // 缓存不存在或已过期，下载并保存
                const readmeContent = await this._fetchSkillReadme(skill);
                fs.writeFileSync(cacheFilePath, readmeContent, 'utf-8');
            }

            // 将缓存文件设置为只读
            try {
                fs.chmodSync(cacheFilePath, 0o444); // 只读权限
            } catch (error) {
                console.warn('设置文件只读失败:', error);
            }

            // 未安装时只打开 Markdown 预览（只读），不打开源文件编辑器
            const uri = vscode.Uri.file(cacheFilePath);
            await vscode.commands.executeCommand('markdown.showPreview', uri);
        } catch (error) {
            vscode.window.showErrorMessage(`无法打开技能详情: ${error}`);
        }
    }

    /**
     * 获取技能的 README 内容
     */
    private async _fetchSkillReadme(skill: Skill): Promise<string> {
        return new Promise((resolve) => {
            const https = require('https');
            const branch = skill.branch || 'main';
            const url = `https://raw.githubusercontent.com/${skill.repoOwner}/${skill.repoName}/${branch}/${skill.skillPath}/SKILL.md`;

            https.get(url, (res: any) => {
                let data = '';
                res.on('data', (chunk: any) => data += chunk);
                res.on('end', () => {
                    if (res.statusCode === 200) {
                        resolve(data);
                    } else {
                        resolve('# 无法加载技能详情\n\n请检查网络连接或稍后重试。');
                    }
                });
            }).on('error', () => {
                resolve('# 加载失败\n\n网络错误');
            });
        });
    }

    public updateAccentColor() {
        if (this._view) {
            const accentColor = vscode.workspace.getConfiguration('antigravity').get<string>('accentColor', '#8A2BE2');
            this._view.webview.postMessage({ command: 'updateAccentColor', color: accentColor });
        }
    }

    /**
     * 处理 Token 配置请求
     */
    private async _handleConfigureToken() {
        const token = await vscode.window.showInputBox({
            prompt: '请输入您的 GitHub 个人访问令牌 (Personal Access Token)',
            placeHolder: 'ghp_xxxxxxxxxxxx',
            password: true,
            ignoreFocusOut: true
        });

        if (token !== undefined) {
            const config = vscode.workspace.getConfiguration('antigravity');
            await config.update('githubToken', token, vscode.ConfigurationTarget.Global);
            vscode.window.showInformationMessage('GitHub Token 已保存，正在重新加载技能列表...');
            this._loadOfficialSkills();
        }
    }

    /**
     * 处理语言切换请求
     */
    private async _handleSetLanguage(lang: string) {
        const config = vscode.workspace.getConfiguration('antigravity');
        await config.update('language', lang, vscode.ConfigurationTarget.Global);

        if (lang === 'zh-CN') {
            // 检查是否已配置 DeepSeek API Key
            const apiKey = config.get<string>('deepseekApiKey', '');

            if (!apiKey) {
                // 弹窗请求配置
                const input = await vscode.window.showInputBox({
                    prompt: '请输入您的 DeepSeek API Key（用于翻译技能描述）',
                    placeHolder: 'sk-xxxxxxxx',
                    password: true,
                    ignoreFocusOut: true
                });

                if (input) {
                    await config.update('deepseekApiKey', input, vscode.ConfigurationTarget.Global);
                    vscode.window.showInformationMessage('DeepSeek API Key 已保存，正在翻译技能描述...');
                    this._translateSkillDescriptions();
                } else {
                    // 用户取消，恢复为原文（配置回滚）
                    await config.update('language', '', vscode.ConfigurationTarget.Global);
                    this._view?.webview.postMessage({ command: 'resetLang' });
                }
            } else {
                // 已有 Key，直接翻译
                this._translateSkillDescriptions();
            }
        } else {
            // “原文”模式：只需刷新视图，Webview 会根据 currentLanguage 自动切换显示
            this._refreshView();
        }
    }

    private _getHtmlForWebview(webview: vscode.Webview) {
        const config = vscode.workspace.getConfiguration('antigravity');
        const accentColor = config.get<string>('accentColor', '#8A2BE2');
        const glowColor = accentColor.replace('rgb', 'rgba').replace(')', ', 0.3)');

        // 生成外部资源 URI
        const cssUri = webview.asWebviewUri(vscode.Uri.joinPath(this._extensionUri, 'resources', 'marketplace.css'));
        const jsUri = webview.asWebviewUri(vscode.Uri.joinPath(this._extensionUri, 'resources', 'marketplace.js'));

        // 读取 HTML 模板文件
        const htmlPath = path.join(this._extensionUri.fsPath, 'resources', 'marketplace.html');
        let html = fs.readFileSync(htmlPath, 'utf8');

        // 注入数据
        const currentLang = config.get<string>('language', '');
        const showAiCategories = config.get<boolean>('showAiCategories', true);
        const currentAgentType = config.get<string>('agentType', 'antigravity');
        const currentScope = config.get<string>('installScope', 'global');

        html = html.replace('{{cssUri}}', cssUri.toString());
        html = html.replace('{{jsUri}}', jsUri.toString());
        html = html.replace('[/*{{skillsData}}*/]', JSON.stringify(this._allSkills));
        html = html.replace('[/*{{sourceConfigs}}*/]', JSON.stringify(this._githubSource.getSourceConfigs()));
        html = html.replace('/*{{currentLang}}*/', currentLang);
        html = html.replace('/*{{showAiCategories}}*/', String(showAiCategories));
        html = html.replace('/*{{currentAgentType}}*/', currentAgentType);
        html = html.replace('/*{{currentScope}}*/', currentScope);

        return html;
    }

    /**
     * 处理编辑技能请求
     */
    private async _handleEditSkill(skillId: string | number, skillName: string) {
        const skill = this._allSkills.find(s => String(s.id) === String(skillId));

        if (!skill || !skill.isInstalled) {
            vscode.window.showErrorMessage(`技能 "${skillName}" 未安装`);
            return;
        }

        // 询问用户编辑方式
        const choice = await vscode.window.showQuickPick([
            {
                label: '$(folder-opened) 在文件浏览器中打开',
                description: '在系统文件浏览器中打开技能目录',
                action: 'explorer'
            },
            {
                label: '$(edit) 在 VS Code 中编辑',
                description: '在当前窗口打开技能目录',
                action: 'vscode'
            }
        ], {
            placeHolder: `选择编辑 "${skillName}" 的方式`
        });

        if (!choice) {
            return;
        }

        if (choice.action === 'explorer') {
            const success = await this._installer.revealSkillInExplorer(String(skillId));
            if (success) {
                vscode.window.showInformationMessage(
                    `已打开技能目录。编辑文件后，刷新列表即可看到"本地修改"标记。`
                );
            }
        } else {
            await this._installer.openSkillForEdit(String(skillId));
        }
    }

    /**
     * 处理恢复官方版本请求
     */
    private async _handleRestoreOfficial(skillId: string | number, skillName: string) {
        const skill = this._allSkills.find(s => String(s.id) === String(skillId));

        if (!skill) {
            vscode.window.showErrorMessage(`未找到技能: ${skillName}`);
            return;
        }

        // 确认操作
        const confirm = await vscode.window.showWarningMessage(
            `确定要恢复 "${skillName}" 的官方版本吗？\n\n您的本地修改将被删除，此操作不可撤销。`,
            { modal: true },
            '恢复官方版本'
        );

        if (confirm !== '恢复官方版本') {
            return;
        }

        // 使用进度条显示恢复过程
        await vscode.window.withProgress(
            {
                location: vscode.ProgressLocation.Notification,
                title: `正在恢复 "${skillName}" 的官方版本`,
                cancellable: false
            },
            async (progress) => {
                const success = await this._installer.restoreOfficialVersion(skill, this.getSkillStoragePath());

                if (success) {
                    // 更新技能状态：恢复后不再是本地修改，且是最新版本
                    skill.isLocalModified = false;
                    skill.hasUpdate = false;
                    skill.installedVersion = skill.commitSha;
                    skill.isInstalled = true;
                    this._refreshView();
                    vscode.window.showInformationMessage(`已恢复 "${skillName}" 的官方版本`);
                }

                return success;
            }
        );
    }

    /**
     * 处理在文件浏览器中显示
     */
    private async _handleRevealInExplorer(skillId: string | number) {
        await this._installer.revealSkillInExplorer(String(skillId));
    }
}
