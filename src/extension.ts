import * as vscode from 'vscode';
import { SkillMarketplaceViewProvider } from './providers/MarketplaceProvider';

export function activate(context: vscode.ExtensionContext) {
	console.log('技能市场已激活（重构版）！');

	const provider = new SkillMarketplaceViewProvider(context.extensionUri);

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

export function deactivate() {
	console.log('技能市场已停用。');
}
