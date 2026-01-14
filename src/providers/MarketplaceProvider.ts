import * as vscode from 'vscode';
import * as path from 'path';
import * as fs from 'fs';
import { Skill } from '../models/Skill';
import { GithubSkillSource } from '../services/GithubSkillSource';

export class SkillMarketplaceViewProvider implements vscode.WebviewViewProvider {

    public static readonly viewType = 'skill-marketplace.views.sidebar';
    private _view?: vscode.WebviewView;
    private _githubSource: GithubSkillSource;
    private _allSkills: Skill[] = [];

    constructor(
        private readonly _extensionUri: vscode.Uri,
    ) {
        this._githubSource = new GithubSkillSource();
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
                case 'openRepo':
                    if (data.url) {
                        vscode.env.openExternal(vscode.Uri.parse(data.url));
                    }
                    break;
                case 'search':
                    console.log(`搜索技能: ${data.query}`);
                    break;
            }
        });

        this.updateAccentColor();
    }

    /**
     * 异步加载官方技能
     */
    private async _loadOfficialSkills() {
        try {
            const claudeSkills = await this._githubSource.fetchSkillList();
            const officialSkills: Skill[] = claudeSkills.map(skill => this._githubSource.toUnifiedSkill(skill));
            
            // 仅使用官方技能
            this._allSkills = [...officialSkills];
            
            // 刷新 WebView
            if (this._view) {
                this._view.webview.html = this._getHtmlForWebview(this._view.webview);
            }
        } catch (error) {
            console.error('加载官方技能失败:', error);
        }
    }

    /**
     * 处理安装请求
     */
    private async _handleInstall(skillId: string | number, skillName: string) {
        const skill = this._allSkills.find(s => s.id === skillId);
        
        if (skill?.isOfficial) {
            vscode.window.showInformationMessage(`正在安装官方技能: ${skillName}`, '查看源码').then(selection => {
                if (selection === '查看源码' && skill.repoLink) {
                    vscode.env.openExternal(vscode.Uri.parse(skill.repoLink));
                }
            });
        } else {
            vscode.window.showInformationMessage(`正在安装技能: ${skillName}`);
        }
    }

    public updateAccentColor() {
        if (this._view) {
            const accentColor = vscode.workspace.getConfiguration('antigravity').get<string>('accentColor', '#8A2BE2');
            this._view.webview.postMessage({ command: 'updateAccentColor', color: accentColor });
        }
    }

    private _getHtmlForWebview(webview: vscode.Webview) {
        const accentColor = vscode.workspace.getConfiguration('antigravity').get<string>('accentColor', '#8A2BE2');
        const glowColor = accentColor.replace('rgb', 'rgba').replace(')', ', 0.3)');

        // 读取 HTML 模板文件
        const htmlPath = path.join(this._extensionUri.fsPath, 'resources', 'marketplace.html');
        let html = fs.readFileSync(htmlPath, 'utf8');

        // 注入数据
        html = html.replace('{{accentColor}}', accentColor);
        html = html.replace('{{accentGlow}}', glowColor);
        html = html.replace('[/*{{skillsData}}*/]', JSON.stringify(this._allSkills));

        return html;
    }
}
