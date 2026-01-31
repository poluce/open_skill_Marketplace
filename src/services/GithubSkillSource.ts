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
 * 技能源配置接口
 */
export interface SkillSourceConfig {
    id: string;
    displayName: string;
    owner: string;
    repo: string;
    branch: string;
    skillsPath: string | string[];
    pathType: 'subdir' | 'root';
    excludeDirs?: string[];
    icon: string;
    colors: [string, string];
    iconUrl: string;
}

/**
 * 技能源配置文件结构
 */
interface SkillSourcesFile {
    sources: SkillSourceConfig[];
}

/**
 * 通用技能源类 - 根据配置动态构建
 */
class GenericSkillSource {
    private config: SkillSourceConfig;

    constructor(config: SkillSourceConfig) {
        this.config = config;
    }

    /**
     * 获取配置
     */
    getConfig(): SkillSourceConfig {
        return this.config;
    }

    /**
     * 发起 GitHub API 请求
     */
    private fetchGithubApi(apiPath: string): Promise<string> {
        return new Promise((resolve, reject) => {
            const url = `${GITHUB_API_BASE}${apiPath}`;
            const vsConfig = vscode.workspace.getConfiguration('antigravity');
            const token = vsConfig.get<string>('githubToken', '');

            const headers: HttpHeaders = {
                'User-Agent': 'VSCode-Antigravity-SkillMarketplace',
                'Accept': 'application/vnd.github.v3+json'
            };

            if (token) {
                headers['Authorization'] = `token ${token}`;
            }

            const options = { headers };

            https.get(url, options, (res: http.IncomingMessage) => {
                let data = '';
                res.on('data', (chunk: Buffer | string) => data += chunk);
                res.on('end', () => {
                    if (res.statusCode === 200) {
                        resolve(data);
                    } else {
                        console.error(`GitHub API 请求失败 [${res.statusCode}]: ${url}`);
                        reject(new Error(`GitHub API 错误: ${res.statusCode} (${apiPath})`));
                    }
                });
            }).on('error', (err) => {
                console.error(`GitHub 网络请求异常: ${url}`, err);
                reject(err);
            });
        });
    }

    /**
     * 获取指定路径的最新 commit SHA 和时间
     */
    private async fetchLatestCommit(
        owner: string,
        repo: string,
        branch: string,
        path: string
    ): Promise<{ sha: string; timestamp: number } | null> {
        try {
            const apiPath = `/repos/${owner}/${repo}/commits?path=${path}&sha=${branch}&per_page=1`;
            const data = await this.fetchGithubApi(apiPath);
            const commits = JSON.parse(data);

            if (commits.length > 0) {
                return {
                    sha: commits[0].sha.substring(0, 7), // 短 SHA
                    timestamp: new Date(commits[0].commit.author.date).getTime()
                };
            }
        } catch (error) {
            console.warn(`获取 commit 失败: ${path}`, error);
        }
        return null;
    }

    /**
     * 获取 raw 文件内容
     */
    private fetchRawContent(url: string): Promise<string> {
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
    private parseSkillMd(content: string): { name?: string; description?: string; category?: string; license?: string } {
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
    private guessCategory(skill: ClaudeSkill): string {
        const text = (skill.name + ' ' + skill.description).toLowerCase();
        if (text.match(/code|program|script|debug|git|develop|api|shell|terminal|python|javascript|rust|go|c\+\+|java/)) { return '编程'; }
        if (text.match(/excel|word|document|report|sheet|ppt|office|mail|schedule|meeting|writing/)) { return '办公'; }
        if (text.match(/art|image|design|creative|draw|music|video|style|css/)) { return '创意'; }
        if (text.match(/data|analyze|research|math|stat|science|calc|chart|logic/)) { return '分析'; }
        if (text.match(/travel|food|health|sport|recipe|news|weather|social/)) { return '生活'; }
        return '其它';
    }

    /**
     * 获取单个技能的元数据（子目录结构）
     */
    private async fetchSkillMetadata(skillsPath: string, skillId: string): Promise<ClaudeSkill | null> {
        try {
            const rawUrl = `${RAW_GITHUB_BASE}/${this.config.owner}/${this.config.repo}/${this.config.branch}/${skillsPath}/${skillId}/SKILL.md`;
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
                repoLink: `https://github.com/${this.config.owner}/${this.config.repo}/tree/${this.config.branch}/${skillsPath}/${skillId}`,
                isFeatured: true
            };
        } catch {
            return null;
        }
    }

    /**
     * 获取单个技能的元数据（根目录结构）
     */
    private async fetchSkillMetadataRoot(skillId: string): Promise<ClaudeSkill | null> {
        try {
            const rawUrl = `${RAW_GITHUB_BASE}/${this.config.owner}/${this.config.repo}/${this.config.branch}/${skillId}/SKILL.md`;
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
                repoLink: `https://github.com/${this.config.owner}/${this.config.repo}/tree/${this.config.branch}/${skillId}`,
                isFeatured: true
            };
        } catch {
            return null;
        }
    }

    /**
     * 将 ClaudeSkill 转换为统一的 Skill 格式
     */
    private toSkill(claudeSkill: ClaudeSkill, skillPath: string): Skill {
        const category = claudeSkill.category || this.guessCategory(claudeSkill);
        return {
            id: `${this.config.id}:${claudeSkill.id}`,
            name: claudeSkill.name,
            desc: claudeSkill.description,
            category: category,
            icon: this.config.icon,
            colors: this.config.colors,
            isFeatured: true,
            repoLink: claudeSkill.repoLink,
            repoOwner: this.config.owner,
            repoName: this.config.repo,
            skillPath: skillPath,
            source: this.config.id,
            branch: this.config.branch
        };
    }

    /**
     * 从单个目录路径获取技能列表
     */
    private async fetchSkillsFromPath(skillsPath: string): Promise<Skill[]> {
        try {
            const apiPath = skillsPath
                ? `/repos/${this.config.owner}/${this.config.repo}/contents/${skillsPath}`
                : `/repos/${this.config.owner}/${this.config.repo}/contents`;

            const dirContents = await this.fetchGithubApi(apiPath);
            let dirs = JSON.parse(dirContents).filter((item: GithubContentItem) => item.type === 'dir');

            // 排除指定目录
            if (this.config.excludeDirs && this.config.excludeDirs.length > 0) {
                dirs = dirs.filter((item: GithubContentItem) => !this.config.excludeDirs!.includes(item.name));
            }

            console.log(`[${this.config.displayName}] 在 ${skillsPath || '根目录'} 发现 ${dirs.length} 个潜在技能目录`);

            // 根据 pathType 选择元数据获取方式
            const skillPromises = dirs.map((dir: GithubContentItem) => {
                if (this.config.pathType === 'root') {
                    return this.fetchSkillMetadataRoot(dir.name);
                } else {
                    return this.fetchSkillMetadata(skillsPath, dir.name);
                }
            });

            const results = await Promise.all(skillPromises);

            return results
                .filter((s): s is ClaudeSkill => s !== null)
                .map(s => {
                    const finalPath = this.config.pathType === 'root' ? s.id : `${skillsPath}/${s.id}`;
                    return this.toSkill(s, finalPath);
                });
        } catch (err) {
            console.warn(`[${this.config.displayName}] 跳过路径 ${skillsPath}:`, err);
            return [];
        }
    }

    /**
     * 获取统一格式的技能列表
     */
    async fetchSkills(): Promise<Skill[]> {
        const allSkills: Skill[] = [];

        // 处理单路径或多路径
        const paths = Array.isArray(this.config.skillsPath)
            ? this.config.skillsPath
            : [this.config.skillsPath];

        const results = await Promise.all(paths.map(p => this.fetchSkillsFromPath(p)));
        results.forEach(batch => allSkills.push(...batch));

        // 并行获取所有技能的 commit 信息
        const skillsWithVersion = await Promise.all(
            allSkills.map(async (skill) => {
                const commitInfo = await this.fetchLatestCommit(
                    this.config.owner,
                    this.config.repo,
                    this.config.branch,
                    skill.skillPath || ''
                );

                if (commitInfo) {
                    skill.commitSha = commitInfo.sha;
                    skill.lastUpdated = commitInfo.timestamp;
                }

                return skill;
            })
        );

        console.log(`[${this.config.displayName}] 成功解析 ${skillsWithVersion.length} 个技能`);
        return skillsWithVersion;
    }
}

/**
 * 统一聚合入口类
 */
export class GithubSkillSource {
    private sources: GenericSkillSource[] = [];
    private sourceConfigs: SkillSourceConfig[] = [];

    constructor() {
        this.loadSourceConfigs();
    }

    /**
     * 从配置文件加载技能源
     */
    private loadSourceConfigs() {
        try {
            // 获取扩展根目录
            // 打包后 __dirname = .../dist/，往上一级是扩展根目录
            const extensionRoot = path.resolve(__dirname, '..');
            const configPath = path.join(extensionRoot, 'resources', 'skill-sources.json');

            if (fs.existsSync(configPath)) {
                const configContent = fs.readFileSync(configPath, 'utf8');
                const config: SkillSourcesFile = JSON.parse(configContent);
                this.sourceConfigs = config.sources;

                // 为每个配置创建 GenericSkillSource 实例
                this.sources = this.sourceConfigs.map(cfg => new GenericSkillSource(cfg));
                console.log(`成功加载 ${this.sources.length} 个技能源配置`);
            } else {
                console.error('技能源配置文件不存在:', configPath);
            }
        } catch (error) {
            console.error('加载技能源配置失败:', error);
        }
    }

    /**
     * 获取源配置列表（供 UI 使用）
     */
    getSourceConfigs(): SkillSourceConfig[] {
        return this.sourceConfigs;
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

        console.warn('所有请求和缓存均失效');
        return { skills: [], isRateLimited: true };
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
