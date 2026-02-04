import * as https from 'https';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import * as vscode from 'vscode';

const DEEPSEEK_API_URL = 'api.deepseek.com';
const CACHE_FILE = 'translations_cache.json';

interface TranslationCache {
    version: number;
    translations: {
        [skillId: string]: {
            original: string;
            translated: string;
            category?: string;
            timestamp: number;
        };
    };
}

interface TranslationResult {
    translated: string;
    category: string;
}

/**
 * DeepSeek 翻译服务
 * 负责调用 DeepSeek API 翻译技能描述，并管理本地缓存
 */
export class TranslationService {
    private cache: TranslationCache = { version: 1, translations: {} };
    private cacheLoaded = false;

    /**
     * 获取缓存文件路径
     */
    private getCachePath(): string {
        const cacheDir = path.join(os.homedir(), '.skill-marketplace', 'cache');
        if (!fs.existsSync(cacheDir)) {
            fs.mkdirSync(cacheDir, { recursive: true });
        }
        return path.join(cacheDir, 'translations_cache.json');
    }

    /**
     * 加载缓存
     */
    private loadCache(): void {
        if (this.cacheLoaded) { return; }
        try {
            const cachePath = this.getCachePath();
            if (fs.existsSync(cachePath)) {
                const content = fs.readFileSync(cachePath, 'utf8');
                this.cache = JSON.parse(content);
            }
        } catch (e) {
            console.error('加载翻译缓存失败:', e);
        }
        this.cacheLoaded = true;
    }

    /**
     * 保存缓存
     */
    private saveCache(): void {
        try {
            fs.writeFileSync(this.getCachePath(), JSON.stringify(this.cache, null, 2), 'utf8');
        } catch (e) {
            console.error('保存翻译缓存失败:', e);
        }
    }

    /**
     * 获取 DeepSeek API Key
     */
    private getApiKey(): string {
        const config = vscode.workspace.getConfiguration('antigravity');
        return config.get<string>('deepseekApiKey', '');
    }

    /**
     * 调用 DeepSeek API 翻译文本并分类
     */
    private async callDeepSeekApi(text: string): Promise<TranslationResult> {
        const apiKey = this.getApiKey();
        const defaultResult: TranslationResult = { translated: text, category: '' };

        if (!apiKey) {
            return defaultResult;
        }

        return new Promise((resolve) => {
            const requestBody = JSON.stringify({
                model: 'deepseek-chat',
                messages: [
                    {
                        role: 'system',
                        content: `你是一个专业的助手。请将用户提供的英文文本翻译为简洁的中文，并根据内容将其归类为以下分类之一：编程、办公、创意、分析、生活。
请严格以 JSON 格式输出，格式如下：
{
  "translated": "中文翻译",
  "category": "分类名称"
}
如果没有合适的分类，category 请留空。`
                    },
                    {
                        role: 'user',
                        content: text
                    }
                ],
                max_tokens: 300,
                temperature: 0.3,
                response_format: { type: 'json_object' }
            });

            const options = {
                hostname: DEEPSEEK_API_URL,
                port: 443,
                path: '/v1/chat/completions',
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    'Authorization': `Bearer ${apiKey}`,
                    'Content-Length': Buffer.byteLength(requestBody)
                }
            };

            const req = https.request(options, (res) => {
                let data = '';
                res.on('data', chunk => data += chunk);
                res.on('end', () => {
                    try {
                        if (res.statusCode === 200) {
                            const response = JSON.parse(data);
                            const content = response.choices?.[0]?.message?.content;
                            if (content) {
                                const parsed = JSON.parse(content);
                                resolve({
                                    translated: parsed.translated || text,
                                    category: parsed.category || ''
                                });
                            } else {
                                resolve(defaultResult);
                            }
                        } else {
                            console.error('DeepSeek API 错误:', res.statusCode, data);
                            resolve(defaultResult);
                        }
                    } catch (e) {
                        console.error('解析 DeepSeek 响应失败:', e);
                        resolve(defaultResult);
                    }
                });
            });

            req.on('error', (e) => {
                console.error('DeepSeek 请求失败:', e);
                resolve(defaultResult);
            });

            req.setTimeout(10000, () => {
                req.destroy();
                resolve(defaultResult);
            });

            req.write(requestBody);
            req.end();
        });
    }

    /**
     * 检测文本是否主要为中文
     */
    private isChinese(text: string): boolean {
        const chineseChars = text.match(/[\u4e00-\u9fa5]/g) || [];
        return chineseChars.length > text.length * 0.3;
    }

    /**
     * 获取翻译后的描述及其分类（带缓存）
     */
    async getTranslatedDescriptionAndCategory(skillId: string, originalDesc: string): Promise<TranslationResult> {
        // 如果已经是中文，且无 API Key，我们无法重新分类，只能返回原文
        // 但如果由于已配置 Key，我们可能还是想分类。
        // 为了简化，如果已经是中文且缓存里没数据，直接返回
        this.loadCache();
        const cached = this.cache.translations[skillId];

        if (this.isChinese(originalDesc)) {
            return {
                translated: originalDesc,
                category: cached?.category || ''
            };
        }

        // 无 API Key，且缓存无数据，返回原文
        if (!this.getApiKey() && !cached) {
            return { translated: originalDesc, category: '' };
        }

        // 检查缓存
        if (cached && cached.original === originalDesc && cached.category) {
            return { translated: cached.translated, category: cached.category };
        }

        // 调用 API 翻译并分类
        const result = await this.callDeepSeekApi(originalDesc);

        // 如果翻译失败了但有缓存，优先使用缓存
        if (result.translated === originalDesc && cached) {
            return { translated: cached.translated, category: cached.category || '' };
        }

        // 保存到缓存
        this.cache.translations[skillId] = {
            original: originalDesc,
            translated: result.translated,
            category: result.category,
            timestamp: Date.now()
        };
        this.saveCache();

        return result;
    }

    /**
     * 同步获取已缓存的翻译结果（不需要 API Key，不发起请求）
     */
    public getCachedTranslation(skillId: string): TranslationResult | undefined {
        this.loadCache();
        const cached = this.cache.translations[skillId];
        if (cached) {
            return {
                translated: cached.translated,
                category: cached.category || ''
            };
        }
        return undefined;
    }

    /**
     * 批量翻译技能描述
     */
    /**
     * 批量翻译并分类技能描述
     */
    async translateSkills(
        skills: Array<{ id: string; desc: string }>,
        onProgress?: (current: number, total: number) => void
    ): Promise<Map<string, TranslationResult>> {
        const result = new Map<string, TranslationResult>();
        const total = skills.length;
        let processed = 0;

        // 并行翻译，增加并发数到 10
        const batchSize = 10;
        for (let i = 0; i < skills.length; i += batchSize) {
            const batch = skills.slice(i, i + batchSize);
            const translations = await Promise.all(
                batch.map(s => this.getTranslatedDescriptionAndCategory(String(s.id), s.desc))
            );

            batch.forEach((s, idx) => {
                result.set(String(s.id), translations[idx]);
            });

            processed += batch.length;
            if (onProgress) {
                onProgress(processed, total);
            }
        }

        return result;
    }
}
