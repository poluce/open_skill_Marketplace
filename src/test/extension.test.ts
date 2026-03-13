import * as assert from 'assert';
import { buildInstallTargetPath, collectFileEntries } from '../services/SkillInstaller';
import { areSourceSignaturesEqual } from '../services/GithubSkillSource';
import { getAppShellTitle, normalizeHealthMessage, getHealthPlaceholder } from '../app/bootstrap';

suite('Extension Test Suite', () => {
	test('collectFileEntries 保留嵌套目录相对路径', () => {
		const files = collectFileEntries('skills/example', [
			{ type: 'file', path: 'skills/example/SKILL.md', name: 'SKILL.md' },
			{ type: 'file', path: 'skills/example/scripts/helper.js', name: 'helper.js' },
			{ type: 'dir', path: 'skills/example/scripts', name: 'scripts' }
		]);

		assert.deepStrictEqual(files, [
			{ name: 'SKILL.md', path: 'skills/example/SKILL.md', relativePath: 'SKILL.md' },
			{ name: 'helper.js', path: 'skills/example/scripts/helper.js', relativePath: 'scripts/helper.js' }
		]);
	});

	test('buildInstallTargetPath 保留子目录结构', () => {
		assert.strictEqual(
			buildInstallTargetPath('C:/target', 'scripts/helper.js').replace(/\\/g, '/'),
			'C:/target/scripts/helper.js'
		);
	});

	test('areSourceSignaturesEqual 在任一源变化时返回 false', () => {
		assert.strictEqual(
			areSourceSignaturesEqual(
				['anthropic:abc', 'openai:def'],
				['anthropic:abc', 'openai:xyz']
			),
			false
		);
	});

	test('getAppShellTitle 返回桌面应用标题', () => {
		assert.strictEqual(getAppShellTitle(), '技能市场');
	});

	test('normalizeHealthMessage 规范化 rust 健康检查文案', () => {
		assert.strictEqual(normalizeHealthMessage('  tauri ready  '), 'tauri ready');
	});

	test('getHealthPlaceholder 返回 React 壳加载提示', () => {
		assert.strictEqual(getHealthPlaceholder(), '正在连接 Rust 后端…');
	});
});
