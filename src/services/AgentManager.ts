import { IAgent } from '../models/Agent';
import { AntigravityAgent, GeminiAgent, ClaudeAgent, CodexAgent, OpenCodeAgent } from './agents/DefaultAgents';

/**
 * Agent 管理器
 * 负责注册和获取支持的 Agent 策略
 */
export class AgentManager {
    private static instance: AgentManager;
    private agents: Map<string, IAgent> = new Map();

    private constructor() {
        // 注册默认支持的 Agent
        [
            new AntigravityAgent(),
            new GeminiAgent(),
            new ClaudeAgent(),
            new CodexAgent(),
            new OpenCodeAgent()
        ].forEach(agent => this.registerAgent(agent));
    }

    public static getInstance(): AgentManager {
        if (!AgentManager.instance) {
            AgentManager.instance = new AgentManager();
        }
        return AgentManager.instance;
    }

    /**
     * 注册一个新的 Agent
     */
    public registerAgent(agent: IAgent): void {
        this.agents.set(agent.id, agent);
    }

    /**
     * 根据 ID 获取 Agent 策略
     */
    public getAgent(id: string): IAgent | undefined {
        return this.agents.get(id);
    }

    /**
     * 获取所有已注册的 Agent
     */
    public getAllAgents(): IAgent[] {
        return Array.from(this.agents.values());
    }
}
