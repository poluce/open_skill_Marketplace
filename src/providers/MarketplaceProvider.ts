import * as vscode from 'vscode';
import * as path from 'path';
import * as fs from 'fs';
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

    constructor(
        private readonly _extensionUri: vscode.Uri,
    ) {
        this._githubSource = new GithubSkillSource();
        this._installer = new SkillInstaller();
        this._translator = new TranslationService();
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

            // 新增：读取本地修改状态
            for (const skill of officialSkills) {
                if (skill.isInstalled) {
                    const skillDir = path.join(
                        this._installer.getInstallPath(false),
                        this._installer.getSafeDirName(String(skill.id))
                    );
                    const metadata = this._installer.readMetadata(skillDir);
                    if (metadata?.isLocalModified) {
                        skill.isLocalModified = true;
                    }
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
                });

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
        const success = this._installer.uninstallSkill(String(skillId), skillName);

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
                });

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

        // 创建 WebView Panel
        const panel = vscode.window.createWebviewPanel(
            'skillDetail',
            skill.name,
            vscode.ViewColumn.One,
            { enableScripts: true }
        );

        // 获取 README 内容
        const readmeContent = await this._fetchSkillReadme(skill);

        panel.webview.html = this._getDetailHtml(skill, readmeContent);
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

    /**
     * 生成详情页 HTML
     */
    private _getDetailHtml(skill: Skill, markdown: string): string {
        return `
            <!DOCTYPE html>
            <html>
            <head>
                <style>
                    body {
                        font-family: var(--vscode-font-family);
                        padding: 20px;
                        color: var(--vscode-foreground);
                        line-height: 1.6;
                    }
                    pre {
                        background: var(--vscode-textCodeBlock-background);
                        padding: 10px;
                        border-radius: 4px;
                        overflow-x: auto;
                        white-space: pre-wrap;
                    }
                    code {
                        font-family: var(--vscode-editor-font-family);
                    }
                    h1, h2, h3 {
                        color: var(--vscode-foreground);
                    }
                </style>
            </head>
            <body>
                <h1>${this._escapeHtml(skill.name)}</h1>
                <pre>${this._escapeHtml(markdown)}</pre>
            </body>
            </html>
        `;
    }

    /**
     * HTML 转义
     */
    private _escapeHtml(text: string): string {
        return text
            .replace(/&/g, '&amp;')
            .replace(/</g, '&lt;')
            .replace(/>/g, '&gt;')
            .replace(/"/g, '&quot;')
            .replace(/'/g, '&#039;');
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
                // 标记为本地修改
                this._installer.markAsLocalModified(String(skillId));
                skill.isLocalModified = true;
                this._refreshView();

                vscode.window.showInformationMessage(
                    `已打开技能目录。编辑后，该技能将标记为"本地修改"，不再接收官方更新。`
                );
            }
        } else {
            const success = await this._installer.openSkillForEdit(String(skillId));
            if (success) {
                skill.isLocalModified = true;
                this._refreshView();
            }
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
                const success = await this._installer.restoreOfficialVersion(skill);

                if (success) {
                    skill.isLocalModified = false;
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
