export interface AppSettings {
  agentType: string;
  installScope: string;
  projectRoot: string;
  githubToken: string;
  deepseekApiKey: string;
  language: string;
  showAiCategories: boolean;
  accentColor: string;
  installMode: string;
  storageRoot: string;
}

export interface Skill {
  id: string;
  name: string;
  desc: string;
  category: string;
  icon: string;
  colors: [string, string];
  isFeatured: boolean;
  repoLink?: string;
  isInstalled?: boolean;
  repoOwner?: string;
  repoName?: string;
  skillPath?: string;
  source?: string;
  branch?: string;
  translatedDesc?: string;
  aiCategory?: string;
  commitSha?: string;
  lastUpdated?: number;
  hasUpdate?: boolean;
  installedVersion?: string;
  isLocalModified?: boolean;
  installMode?: string;
  installPath?: string;
  actualPath?: string;
}

export interface SkillSourceConfig {
  id: string;
  displayName: string;
  owner: string;
  repo: string;
  branch: string;
  skillsPath: string | string[];
  pathType: string;
  excludeDirs: string[];
  icon: string;
  colors: [string, string];
  iconUrl: string;
}

export interface SourceStatus {
  id: string;
  displayName: string;
  status: string;
  skillCount: number;
  error?: string;
  matchedReadmeCount?: number;
  parsedSkillCount?: number;
  requestMode?: string;
}

export interface MarketplacePayload {
  settings: AppSettings;
  sourceConfigs: SkillSourceConfig[];
  sourceStatuses: SourceStatus[];
  skills: Skill[];
  resolvedInstallPath: string;
  resolvedStoragePath: string;
  warning?: string;
  fromCache: boolean;
}

export interface SkillDetail {
  markdown: string;
  sourceUrl: string;
  localPath?: string;
}

export interface OperationResult {
  message: string;
  warning?: string;
}
