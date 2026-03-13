import * as assert from 'assert';
import { buildInstallTargetPath, collectFileEntries } from '../services/SkillInstaller';
import { areSourceSignaturesEqual } from '../services/GithubSkillSource';

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
});
