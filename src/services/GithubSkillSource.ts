import * as https from 'https';
import { ClaudeSkill, UnifiedSkill } from '../models/ClaudeSkill';

const GITHUB_API_BASE = 'https://api.github.com';
const RAW_GITHUB_BASE = 'https://raw.githubusercontent.com';
const REPO_OWNER = 'anthropics';
const REPO_NAME = 'skills';
const SKILLS_PATH = 'skills';

/**
 * GitHub 官方技能源服务
 * 负责从 anthropics/skills 仓库获取技能列表和下载技能
 */
export class GithubSkillSource {

    /**
     * 获取官方技能列表
     */
    async fetchSkillList(): Promise<ClaudeSkill[]> {
        try {
            // 1. 调用 GitHub API 获取 skills 目录列表
            const dirContents = await this.fetchGithubApi(`/repos/${REPO_OWNER}/${REPO_NAME}/contents/${SKILLS_PATH}`);
            const dirs = JSON.parse(dirContents).filter((item: { type: string }) => item.type === 'dir');

            // 2. 并行获取每个技能的 SKILL.md 内容
            const skillPromises = dirs.map((dir: { name: string }) => this.fetchSkillMetadata(dir.name));
            const results = await Promise.allSettled(skillPromises);

            // 3. 过滤成功解析的技能
            const skills: ClaudeSkill[] = [];
            for (const result of results) {
                if (result.status === 'fulfilled' && result.value) {
                    skills.push(result.value);
                }
            }

            return skills;
        } catch (error) {
            console.error('获取官方技能列表失败:', error);
            return [];
        }
    }

    /**
     * 获取单个技能的元数据
     */
    private async fetchSkillMetadata(skillId: string): Promise<ClaudeSkill | null> {
        try {
            const rawUrl = `${RAW_GITHUB_BASE}/${REPO_OWNER}/${REPO_NAME}/main/${SKILLS_PATH}/${skillId}/SKILL.md`;
            const content = await this.fetchRawContent(rawUrl);
            const metadata = this.parseSkillMd(content);

            if (!metadata.name || !metadata.description) {
                return null;
            }

            return {
                id: skillId,
                name: metadata.name,
                description: metadata.description,
                license: metadata.license,
                rawUrl,
                repoLink: `https://github.com/${REPO_OWNER}/${REPO_NAME}/tree/main/${SKILLS_PATH}/${skillId}`,
                isOfficial: true
            };
        } catch (error) {
            console.error(`解析技能 ${skillId} 失败:`, error);
            return null;
        }
    }

    /**
     * 解析 SKILL.md 的 YAML 前置数据
     */
    parseSkillMd(content: string): { name?: string; description?: string; license?: string } {
        const yamlMatch = content.match(/^---\s*\n([\s\S]*?)\n---/);
        if (!yamlMatch) {
            return {};
        }

        const yamlContent = yamlMatch[1];
        const result: { name?: string; description?: string; license?: string } = {};

        // 简单的 YAML 解析（仅支持单行键值对）
        const lines = yamlContent.split('\n');
        for (const line of lines) {
            const match = line.match(/^(\w+):\s*(.+)$/);
            if (match) {
                const [, key, value] = match;
                if (key === 'name') {result.name = value.trim();}
                if (key === 'description') {result.description = value.trim();}
                if (key === 'license') {result.license = value.trim();}
            }
        }

        return result;
    }

    /**
     * 将官方技能转换为统一格式
     */
    toUnifiedSkill(skill: ClaudeSkill): UnifiedSkill {
        return {
            id: skill.id,
            name: skill.name,
            desc: skill.description,
            category: '官方',
            icon: '✓',
            colors: ['#6366f1', '#8b5cf6'] as [string, string], // 官方紫色渐变
            isOfficial: true,
            repoLink: skill.repoLink
        };
    }

    /**
     * 发起 GitHub API 请求
     */
    private fetchGithubApi(path: string): Promise<string> {
        return new Promise((resolve, reject) => {
            const url = `${GITHUB_API_BASE}${path}`;
            const options = {
                headers: {
                    'User-Agent': 'VSCode-Antigravity-SkillMarketplace',
                    'Accept': 'application/vnd.github.v3+json'
                }
            };

            https.get(url, options, (res) => {
                let data = '';
                res.on('data', chunk => data += chunk);
                res.on('end', () => {
                    if (res.statusCode === 200) {
                        resolve(data);
                    } else {
                        reject(new Error(`GitHub API 错误: ${res.statusCode}`));
                    }
                });
            }).on('error', reject);
        });
    }

    /**
     * 获取 raw 文件内容
     */
    private fetchRawContent(url: string): Promise<string> {
        return new Promise((resolve, reject) => {
            https.get(url, (res) => {
                let data = '';
                res.on('data', chunk => data += chunk);
                res.on('end', () => {
                    if (res.statusCode === 200) {
                        resolve(data);
                    } else {
                        reject(new Error(`获取文件失败: ${res.statusCode}`));
                    }
                });
            }).on('error', reject);
        });
    }
}
