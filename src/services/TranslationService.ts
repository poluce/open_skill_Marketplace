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
            timestamp: number;
        };
    };
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
        const cacheDir = path.join(os.homedir(), '.gemini');
        if (!fs.existsSync(cacheDir)) {
            fs.mkdirSync(cacheDir, { recursive: true });
        }
        return path.join(cacheDir, CACHE_FILE);
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
     * 调用 DeepSeek API 翻译文本
     */
    private async callDeepSeekApi(text: string): Promise<string> {
        const apiKey = this.getApiKey();
        if (!apiKey) {
            return text; // 无 API Key，返回原文
        }

        return new Promise((resolve) => {
            const requestBody = JSON.stringify({
                model: 'deepseek-chat',
                messages: [
                    {
                        role: 'system',
                        content: '你是一个专业的翻译助手。请将用户提供的英文文本翻译为简洁的中文。只输出翻译结果，不要添加任何解释。'
                    },
                    {
                        role: 'user',
                        content: text
                    }
                ],
                max_tokens: 200,
                temperature: 0.3
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
                            const translated = response.choices?.[0]?.message?.content?.trim();
                            resolve(translated || text);
                        } else {
                            console.error('DeepSeek API 错误:', res.statusCode, data);
                            resolve(text);
                        }
                    } catch (e) {
                        console.error('解析 DeepSeek 响应失败:', e);
                        resolve(text);
                    }
                });
            });

            req.on('error', (e) => {
                console.error('DeepSeek 请求失败:', e);
                resolve(text);
            });

            req.setTimeout(10000, () => {
                req.destroy();
                resolve(text);
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
     * 获取翻译后的描述（带缓存）
     */
    async getTranslatedDescription(skillId: string, originalDesc: string): Promise<string> {
        // 如果已经是中文，直接返回
        if (this.isChinese(originalDesc)) {
            return originalDesc;
        }

        // 无 API Key，返回原文
        if (!this.getApiKey()) {
            return originalDesc;
        }

        this.loadCache();

        // 检查缓存
        const cached = this.cache.translations[skillId];
        if (cached && cached.original === originalDesc) {
            return cached.translated;
        }

        // 调用 API 翻译
        const translated = await this.callDeepSeekApi(originalDesc);

        // 保存到缓存
        this.cache.translations[skillId] = {
            original: originalDesc,
            translated: translated,
            timestamp: Date.now()
        };
        this.saveCache();

        return translated;
    }

    /**
     * 批量翻译技能描述
     */
    async translateSkills(
        skills: Array<{ id: string; desc: string }>,
        onProgress?: (current: number, total: number) => void
    ): Promise<Map<string, string>> {
        const result = new Map<string, string>();
        const total = skills.length;
        let processed = 0;

        // 并行翻译，增加并发数到 10
        const batchSize = 10;
        for (let i = 0; i < skills.length; i += batchSize) {
            const batch = skills.slice(i, i + batchSize);
            const translations = await Promise.all(
                batch.map(s => this.getTranslatedDescription(String(s.id), s.desc))
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
