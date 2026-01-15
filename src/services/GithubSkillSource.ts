import * as https from 'https';
import * as http from 'http';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import * as vscode from 'vscode';
import { ClaudeSkill } from '../models/ClaudeSkill';
import { Skill } from '../models/Skill';

const GITHUB_API_BASE = 'https://api.github.com';
const RAW_GITHUB_BASE = 'https://raw.githubusercontent.com';

/**
 * GitHub API 目录内容响应类型
 */
interface GithubContentItem {
    name: string;
    path: string;
    type: 'file' | 'dir';
}

/**
 * HTTP 请求头类型
 */
type HttpHeaders = Record<string, string>;

/**
 * 技能源抽象基类
 */
export abstract class BaseSkillSource {
    protected abstract owner: string;
    protected abstract repo: string;
    protected abstract defaultBranch: string;

    /**
     * 获取统一格式的技能列表
     */
    abstract fetchSkills(): Promise<Skill[]>;

    /**
     * 发起 GitHub API 请求
     */
    protected fetchGithubApi(path: string): Promise<string> {
        return new Promise((resolve, reject) => {
            const url = `${GITHUB_API_BASE}${path}`;
            const config = vscode.workspace.getConfiguration('antigravity');
            const token = config.get<string>('githubToken', '');

            const headers: HttpHeaders = {
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
                        resolve(data);
                    } else {
                        console.error(`GitHub API 请求失败 [${res.statusCode}]: ${url}`);
                        reject(new Error(`GitHub API 错误: ${res.statusCode} (${path})`));
                    }
                });
            }).on('error', (err) => {
                console.error(`GitHub 网络请求异常: ${url}`, err);
                reject(err);
            });
        });
    }

    /**
     * 获取 raw 文件内容
     */
    protected fetchRawContent(url: string): Promise<string> {
        return new Promise((resolve, reject) => {
            https.get(url, (res: http.IncomingMessage) => {
                let data = '';
                res.on('data', (chunk: Buffer | string) => data += chunk);
                res.on('end', () => {
                    if (res.statusCode === 200) {
                        resolve(data);
                    } else {
                        reject(new Error(`获取文件失败: ${res.statusCode} (${url})`));
                    }
                });
            }).on('error', reject);
        });
    }

    /**
     * 解析 SKILL.md 的 YAML 前置数据
     */
    protected parseSkillMd(content: string): { name?: string; description?: string; category?: string; license?: string } {
        const yamlMatch = content.match(/^---\s*\n([\s\S]*?)\n---/);
        if (!yamlMatch) {
            return {};
        }

        const yamlContent = yamlMatch[1];
        const result: { name?: string; description?: string; category?: string; license?: string } = {};

        const lines = yamlContent.split('\n');
        for (const line of lines) {
            const match = line.match(/^(\w+):\s*(.+)$/);
            if (match) {
                const [, key, value] = match;
                const cleanValue = value.trim().replace(/^['"]|['"]$/g, '');
                if (key === 'name') { result.name = cleanValue; }
                if (key === 'description') { result.description = cleanValue; }
                if (key === 'category') { result.category = cleanValue; }
                if (key === 'license') { result.license = cleanValue; }
            }
        }

        return result;
    }

    /**
     * 根据描述猜测分类
     */
    protected internalGuessCategory(skill: ClaudeSkill): string {
        const text = (skill.name + ' ' + skill.description).toLowerCase();
        if (text.match(/code|program|script|debug|git|develop|api|shell|terminal|python|javascript|rust|go|c\+\+|java/)) { return '编程'; }
        if (text.match(/excel|word|document|report|sheet|ppt|office|mail|schedule|meeting|writing/)) { return '办公'; }
        if (text.match(/art|image|design|creative|draw|music|video|style|css/)) { return '创意'; }
        if (text.match(/data|analyze|research|math|stat|science|calc|chart|logic/)) { return '分析'; }
        if (text.match(/travel|food|health|sport|recipe|news|weather|social/)) { return '生活'; }
        return '其它';
    }

    /**
     * 获取单个技能的元数据
     */
    protected async fetchSkillMetadata(subdir: string, skillId: string): Promise<ClaudeSkill | null> {
        try {
            const rawUrl = `${RAW_GITHUB_BASE}/${this.owner}/${this.repo}/${this.defaultBranch}/${subdir}/${skillId}/SKILL.md`;
            const content = await this.fetchRawContent(rawUrl);
            const metadata = this.parseSkillMd(content);

            if (!metadata.name || !metadata.description) {
                return null;
            }

            return {
                id: skillId,
                name: metadata.name,
                description: metadata.description,
                category: metadata.category,
                license: metadata.license,
                rawUrl,
                repoLink: `https://github.com/${this.owner}/${this.repo}/tree/${this.defaultBranch}/${subdir}/${skillId}`,
                isFeatured: true
            };
        } catch (error) {
            return null;
        }
    }
}

/**
 * Anthropic 高赞技能源
 */
export class AnthropicSkillSource extends BaseSkillSource {
    protected owner = 'anthropics';
    protected repo = 'skills';
    protected defaultBranch = 'main';

    async fetchSkills(): Promise<Skill[]> {
        try {
            const skillsPath = 'skills';
            const dirContents = await this.fetchGithubApi(`/repos/${this.owner}/${this.repo}/contents/${skillsPath}`);
            const dirs = JSON.parse(dirContents).filter((item: GithubContentItem) => item.type === 'dir');
            console.log(`Anthropic 发现 ${dirs.length} 个潜在技能目录`);

            const skillPromises = dirs.map((dir: GithubContentItem) => this.fetchSkillMetadata(skillsPath, dir.name));
            const results = await Promise.all(skillPromises);

            const finalSkills = results
                .filter((s): s is ClaudeSkill => s !== null)
                .map(s => {
                    const category = s.category || this.internalGuessCategory(s);
                    return {
                        id: `anthropic:${s.id}`,
                        name: s.name,
                        desc: s.description,
                        category: category,
                        icon: '✓',
                        colors: ['#6366f1', '#8b5cf6'] as [string, string],
                        isFeatured: true,
                        repoLink: s.repoLink,
                        repoOwner: this.owner,
                        repoName: this.repo,
                        skillPath: `skills/${s.id}`,
                        source: 'anthropic',
                        branch: this.defaultBranch
                    };
                });
            console.log(`Anthropic 成功解析 ${finalSkills.length} 个技能`);
            return finalSkills;
        } catch (e) {
            console.error('Anthropic 技能抓取失败:', e);
            return [];
        }
    }
}

/**
 * OpenAI 高赞技能源
 */
export class OpenAISkillSource extends BaseSkillSource {
    protected owner = 'openai';
    protected repo = 'skills';
    protected defaultBranch = 'main';
    private categories = ['skills/.curated', 'skills/.experimental', 'skills/.system'];

    async fetchSkills(): Promise<Skill[]> {
        const allSkills: Skill[] = [];

        const fetchResults = await Promise.all(this.categories.map(async (path) => {
            try {
                const dirContents = await this.fetchGithubApi(`/repos/${this.owner}/${this.repo}/contents/${path}`);
                const dirs = JSON.parse(dirContents).filter((item: GithubContentItem) => item.type === 'dir');
                console.log(`OpenAI [${path}] 发现 ${dirs.length} 个潜在技能目录`);

                const skillPromises = dirs.map((dir: GithubContentItem) => this.fetchSkillMetadata(path, dir.name));
                const results = await Promise.all(skillPromises);

                return results
                    .filter((s): s is ClaudeSkill => s !== null)
                    .map(s => {
                        const category = s.category || this.internalGuessCategory(s);
                        return {
                            id: `openai:${s.id}`,
                            name: s.name,
                            desc: s.description,
                            category: category,
                            icon: 'O',
                            colors: ['#10a37f', '#108060'] as [string, string],
                            isFeatured: true,
                            repoLink: s.repoLink,
                            repoOwner: this.owner,
                            repoName: this.repo,
                            skillPath: `${path}/${s.id}`,
                            source: 'openai',
                            branch: this.defaultBranch
                        };
                    });
            } catch (err) {
                console.warn(`跳过 OpenAI 路径 ${path}:`, err);
                return [];
            }
        }));

        fetchResults.forEach(batch => allSkills.push(...batch));
        return allSkills;
    }
}

/**
 * HuggingFace 高赞技能源
 */
export class HuggingFaceSkillSource extends BaseSkillSource {
    protected owner = 'huggingface';
    protected repo = 'skills';
    protected defaultBranch = 'main';

    async fetchSkills(): Promise<Skill[]> {
        try {
            const skillsPath = 'skills';
            const dirContents = await this.fetchGithubApi(`/repos/${this.owner}/${this.repo}/contents/${skillsPath}`);
            const dirs = JSON.parse(dirContents).filter((item: GithubContentItem) => item.type === 'dir');
            console.log(`HuggingFace 发现 ${dirs.length} 个潜在技能目录`);

            const skillPromises = dirs.map((dir: GithubContentItem) => this.fetchSkillMetadata(skillsPath, dir.name));
            const results = await Promise.all(skillPromises);

            const finalSkills = results
                .filter((s): s is ClaudeSkill => s !== null)
                .map(s => {
                    const category = s.category || this.internalGuessCategory(s);
                    return {
                        id: `huggingface:${s.id}`,
                        name: s.name,
                        desc: s.description,
                        category: category,
                        icon: 'H',
                        colors: ['#FFD21E', '#FF9D00'] as [string, string],
                        isFeatured: true,
                        repoLink: s.repoLink,
                        repoOwner: this.owner,
                        repoName: this.repo,
                        skillPath: `skills/${s.id}`,
                        source: 'huggingface',
                        branch: this.defaultBranch
                    };
                });
            console.log(`HuggingFace 成功解析 ${finalSkills.length} 个技能`);
            return finalSkills;
        } catch (e) {
            console.error('HuggingFace 技能抓取失败:', e);
            return [];
        }
    }
}

/**
 * Superpowers 技能源 (obra/superpowers)
 */
export class SuperpowersSkillSource extends BaseSkillSource {
    protected owner = 'obra';
    protected repo = 'superpowers';
    protected defaultBranch = 'main';

    async fetchSkills(): Promise<Skill[]> {
        try {
            const skillsPath = 'skills';
            const dirContents = await this.fetchGithubApi(`/repos/${this.owner}/${this.repo}/contents/${skillsPath}`);
            const dirs = JSON.parse(dirContents).filter((item: GithubContentItem) => item.type === 'dir');
            console.log(`Superpowers 发现 ${dirs.length} 个潜在技能目录`);

            const skillPromises = dirs.map((dir: GithubContentItem) => this.fetchSkillMetadata(skillsPath, dir.name));
            const results = await Promise.all(skillPromises);

            const finalSkills = results
                .filter((s): s is ClaudeSkill => s !== null)
                .map(s => {
                    const category = s.category || this.internalGuessCategory(s);
                    return {
                        id: `superpowers:${s.id}`,
                        name: s.name,
                        desc: s.description,
                        category: category,
                        icon: 'S',
                        colors: ['#FF6B35', '#F7931E'] as [string, string],
                        isFeatured: true,
                        repoLink: s.repoLink,
                        repoOwner: this.owner,
                        repoName: this.repo,
                        skillPath: `skills/${s.id}`,
                        source: 'superpowers',
                        branch: this.defaultBranch
                    };
                });
            console.log(`Superpowers 成功解析 ${finalSkills.length} 个技能`);
            return finalSkills;
        } catch (e) {
            console.error('Superpowers 技能抓取失败:', e);
            return [];
        }
    }
}

/**
 * Composio 技能源 (ComposioHQ/awesome-claude-skills)
 * 特殊结构：技能目录直接在根目录下，非 skills 子目录
 */
export class ComposioSkillSource extends BaseSkillSource {
    protected owner = 'ComposioHQ';
    protected repo = 'awesome-claude-skills';
    protected defaultBranch = 'master';

    // 需要排除的非技能目录
    private excludeDirs = ['.claude-plugin', '.github', 'template-skill'];

    async fetchSkills(): Promise<Skill[]> {
        try {
            // 直接获取根目录
            const dirContents = await this.fetchGithubApi(`/repos/${this.owner}/${this.repo}/contents`);
            const dirs = JSON.parse(dirContents)
                .filter((item: GithubContentItem) => item.type === 'dir' && !this.excludeDirs.includes(item.name));
            console.log(`Composio 发现 ${dirs.length} 个潜在技能目录`);

            const skillPromises = dirs.map((dir: GithubContentItem) => this.fetchSkillMetadataRoot(dir.name));
            const results = await Promise.all(skillPromises);

            const finalSkills = results
                .filter((s): s is ClaudeSkill => s !== null)
                .map(s => {
                    const category = s.category || this.internalGuessCategory(s);
                    return {
                        id: `composio:${s.id}`,
                        name: s.name,
                        desc: s.description,
                        category: category,
                        icon: 'C',
                        colors: ['#7C3AED', '#A855F7'] as [string, string],
                        isFeatured: true,
                        repoLink: s.repoLink,
                        repoOwner: this.owner,
                        repoName: this.repo,
                        skillPath: s.id,
                        source: 'composio',
                        branch: this.defaultBranch
                    };
                });
            console.log(`Composio 成功解析 ${finalSkills.length} 个技能`);
            return finalSkills;
        } catch (e) {
            console.error('Composio 技能抓取失败:', e);
            return [];
        }
    }

    /**
     * 从根目录获取技能元数据 (技能目录直接在根目录)
     */
    private async fetchSkillMetadataRoot(skillId: string): Promise<ClaudeSkill | null> {
        try {
            const rawUrl = `https://raw.githubusercontent.com/${this.owner}/${this.repo}/${this.defaultBranch}/${skillId}/SKILL.md`;
            const content = await this.fetchRawContent(rawUrl);
            const metadata = this.parseSkillMd(content);

            if (!metadata.name || !metadata.description) {
                return null;
            }

            return {
                id: skillId,
                name: metadata.name,
                description: metadata.description,
                category: metadata.category,
                license: metadata.license,
                rawUrl,
                repoLink: `https://github.com/${this.owner}/${this.repo}/tree/${this.defaultBranch}/${skillId}`,
                isFeatured: true
            };
        } catch (error) {
            return null;
        }
    }
}

/**
 * 统一聚合入口类
 */
export class GithubSkillSource {
    private sources: BaseSkillSource[] = [
        new AnthropicSkillSource(),
        new OpenAISkillSource(),
        new HuggingFaceSkillSource(),
        new SuperpowersSkillSource(),
        new ComposioSkillSource()
    ];

    constructor(private readonly _extensionUri?: vscode.Uri) {}

    private getSeedSkills(): Skill[] {
        if (!this._extensionUri) {
            return [];
        }

        try {
            const seedPath = path.join(this._extensionUri.fsPath, 'resources', 'seed-skills.json');
            if (fs.existsSync(seedPath)) {
                return JSON.parse(fs.readFileSync(seedPath, 'utf8'));
            }
        } catch (e) {
            console.error('加载种子技能失败:', e);
        }
        return [];
    }

    /**
     * 获取合并后的高赞技能列表
     * @returns { skills: Skill[], isRateLimited: boolean }
     */
    async fetchSkillList(): Promise<{ skills: Skill[], isRateLimited: boolean }> {
        let isRateLimited = false;
        
        try {
            console.log('正在从 GitHub 实时获取技能列表...');
            const results = await Promise.all(this.sources.map(async (source) => {
                try {
                    return await source.fetchSkills();
                } catch (error) {
                    console.warn(`技能源抓取失败:`, error);
                    isRateLimited = true; // 任何源失败都标记为受限
                    return [];
                }
            }));
            const allSkills = results.flat();

            if (allSkills.length > 0) {
                this.saveToCache(allSkills);
                return { skills: allSkills, isRateLimited };
            }
        } catch (error) {
            console.warn('GitHub 实时抓取失败，尝试加载本地缓存:', error);
            isRateLimited = true;
        }

        const cached = this.loadFromCache();
        if (cached.length > 0) {
            console.log(`成功从本地缓存加载 ${cached.length} 个技能`);
            return { skills: cached, isRateLimited: true }; // 使用缓存也标记为受限
        }

        console.warn('所有请求和缓存均失效，加载内置种子数据');
        return { skills: this.getSeedSkills(), isRateLimited: true };
    }

    private getCachePath(): string {
        const cacheDir = path.join(os.homedir(), '.gemini');
        if (!fs.existsSync(cacheDir)) {
            fs.mkdirSync(cacheDir, { recursive: true });
        }
        return path.join(cacheDir, 'marketplace_cache.json');
    }

    private saveToCache(skills: Skill[]) {
        try {
            const data = {
                last_update: Date.now(),
                skills: skills
            };
            fs.writeFileSync(this.getCachePath(), JSON.stringify(data, null, 2), 'utf8');
        } catch (e) {
            console.error('备份缓存失败:', e);
        }
    }

    private loadFromCache(): Skill[] {
        try {
            const cachePath = this.getCachePath();
            if (fs.existsSync(cachePath)) {
                const data = JSON.parse(fs.readFileSync(cachePath, 'utf8'));
                // 缓存有效期 24 小时
                const isExpired = Date.now() - data.last_update > 24 * 60 * 60 * 1000;
                if (!isExpired) {
                    return data.skills || [];
                }
            }
        } catch (e) {
            console.error('加载缓存失败:', e);
        }
        return [];
    }
}
