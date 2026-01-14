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

        // 异步加载官方技能
        this._loadOfficialSkills();

        webviewView.webview.onDidReceiveMessage(data => {
            switch (data.command) {
                case 'install':
                    this._handleInstall(data.skillId, data.skillName);
                    break;
                case 'uninstall':
                    this._handleUninstall(data.skillId, data.skillName);
                    break;
                case 'openRepo':
                    if (data.url) {
                        vscode.env.openExternal(vscode.Uri.parse(data.url));
                    }
                    break;
                case 'search':
                    console.log(`搜索技能: ${data.query}`);
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
            }
        });

        this.updateAccentColor();
    }

    /**
     * 异步加载官方技能
     */
    private async _loadOfficialSkills() {
        let isRateLimited = false;
        try {
            const officialSkills = await this._githubSource.fetchSkillList();

            // 如果只拿到了 2 个（种子数据数量），且 fetchSkillList 内部抛出了 warn，说明可能受限
            // 这里简单判断：如果数量过少，提示可能受限
            if (officialSkills.length <= 6) {
                isRateLimited = true;
            }

            // 标记已安装状态
            const installedIds = this._installer.getInstalledSkillIds();
            for (const skill of officialSkills) {
                skill.isInstalled = installedIds.includes(String(skill.id));
            }

            this._allSkills = [...officialSkills];
            this._refreshView(isRateLimited);

            // 异步翻译描述（后台执行，不阻塞显示）
            this._translateSkillDescriptions();
        } catch (error) {
            console.error('加载官方技能失败:', error);
            this._refreshView(true);
        }
    }

    /**
     * 异步翻译技能描述
     */
    private async _translateSkillDescriptions() {
        const skillsToTranslate = this._allSkills.map(s => ({ id: String(s.id), desc: s.desc }));

        // 调用翻译，带进度回调
        const translations = await this._translator.translateSkills(skillsToTranslate, (current, total) => {
            if (this._view) {
                this._view.webview.postMessage({
                    command: 'translationProgress',
                    progress: Math.round((current / total) * 100)
                });
            }
        });

        // 更新描述
        for (const skill of this._allSkills) {
            const translated = translations.get(String(skill.id));
            if (translated && translated !== skill.desc) {
                skill.desc = translated;
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

        // 执行安装（传递完整的 Skill 对象）
        const success = await this._installer.installSkill(skill);

        if (success) {
            // 更新已安装状态并刷新视图
            skill.isInstalled = true;
            this._refreshView();
        }
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
        }
        // 如果选择原文，UI 会根据 currentTab 刷新，此处不需要额外逻辑
    }

    private _getHtmlForWebview(webview: vscode.Webview) {
        const config = vscode.workspace.getConfiguration('antigravity');
        const accentColor = config.get<string>('accentColor', '#8A2BE2');
        const glowColor = accentColor.replace('rgb', 'rgba').replace(')', ', 0.3)');

        // 读取 HTML 模板文件
        const htmlPath = path.join(this._extensionUri.fsPath, 'resources', 'marketplace.html');
        let html = fs.readFileSync(htmlPath, 'utf8');

        // 注入数据
        const currentLang = config.get<string>('language', '');
        html = html.replace('{{accentColor}}', accentColor);
        html = html.replace('{{accentGlow}}', glowColor);
        html = html.replace('[/*{{skillsData}}*/]', JSON.stringify(this._allSkills));
        html = html.replace('/*{{currentLang}}*/', currentLang);

        return html;
    }
}
