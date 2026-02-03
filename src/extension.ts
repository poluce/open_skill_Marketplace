import * as vscode from 'vscode';
import { execSync } from 'child_process';
import { SkillMarketplaceViewProvider } from './providers/MarketplaceProvider';

export function activate(context: vscode.ExtensionContext) {
	console.log('技能市场已激活（重构版）！');

	// 检测 git 是否可用
	checkGitAvailability();

	const provider = new SkillMarketplaceViewProvider(context.extensionUri, context.globalStorageUri);

	// 注册侧边栏 WebviewViewProvider
	context.subscriptions.push(
		vscode.window.registerWebviewViewProvider(SkillMarketplaceViewProvider.viewType, provider)
	);

	// 注册聚焦侧边栏的命令
	context.subscriptions.push(
		vscode.commands.registerCommand('skill-marketplace.openMarketplace', () => {
			vscode.commands.executeCommand('skill-marketplace.views.sidebar.focus');
		})
	);

	// 监听配置变化以实时更新强调色
	context.subscriptions.push(
		vscode.workspace.onDidChangeConfiguration(e => {
			if (e.affectsConfiguration('antigravity.accentColor')) {
				provider.updateAccentColor();
			}
		})
	);
}

/**
 * 检测 git 是否可用，不可用时提示用户
 */
function checkGitAvailability(): void {
	try {
		execSync('git --version', { stdio: 'ignore' });
	} catch (error) {
		vscode.window.showWarningMessage(
			'未检测到 Git，技能修改检测功能将不可用。建议安装 Git 以获得完整体验。',
			'了解更多'
		).then(selection => {
			if (selection === '了解更多') {
				vscode.env.openExternal(vscode.Uri.parse('https://git-scm.com/downloads'));
			}
		});
	}
}

export function deactivate() {
	console.log('技能市场已停用。');
}
