import { IAgent } from '../../models/Agent';
import * as path from 'path';

export class AntigravityAgent implements IAgent {
    id = 'antigravity';
    name = 'Antigravity';

    getGlobalPath(home: string): string {
        return path.join(home, '.gemini', 'antigravity', 'skills');
    }

    getProjectPath(root: string): string {
        return path.join(root, '.agent', 'skills');
    }
}

export class ClaudeAgent implements IAgent {
    id = 'claude';
    name = 'Claude Code CLI';

    getGlobalPath(home: string): string {
        return path.join(home, '.claude', 'skills');
    }

    getProjectPath(root: string): string {
        return path.join(root, '.claude', 'skills');
    }
}

export class CodexAgent implements IAgent {
    id = 'codex';
    name = 'Codex CLI';

    getGlobalPath(home: string): string {
        return path.join(home, '.codex', 'skills');
    }

    getProjectPath(root: string): string {
        return path.join(root, '.codex', 'skills');
    }
}

export class OpenCodeAgent implements IAgent {
    id = 'opencode';
    name = 'Open Code';

    getGlobalPath(home: string): string {
        // 全局：~/.config/opencode/skill
        return path.join(home, '.config', 'opencode', 'skill');
    }

    getProjectPath(root: string): string {
        // 项目：.opencode/skill
        return path.join(root, '.opencode', 'skill');
    }
}
