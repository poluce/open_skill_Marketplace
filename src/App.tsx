import {
  useDeferredValue,
  useEffect,
  useMemo,
  useState,
  type MouseEvent as ReactMouseEvent,
} from "react";
import {
  loadMarketplace,
  saveSettings,
} from "./desktop/api";
import { listen } from "@tauri-apps/api/event";
import { AppSidebar } from "./components/layout/AppSidebar";
import { InspectContextMenu } from "./components/layout/InspectContextMenu";
import { StatusBar } from "./components/layout/StatusBar";
import type {
  OperationProgressState,
  StatusState,
  SurfaceKey,
} from "./app/types";
import type {
  AppSettings,
  MarketplacePayload,
  Skill,
} from "./desktop/types";
import {
  buildComponentClipboardText,
  clampContextMenuPosition,
  createStateList,
  getComponentAttrs,
  resolveComponentSnapshot,
  type ComponentSnapshot,
  type ContextMenuState,
} from "./features/inspect";
import {
  copyTextToClipboard,
  pickDirectory,
} from "./platform/desktop";
import {
  loadSidebarCollapsedPreference,
  setSidebarCollapsedPreference,
} from "./platform/store";

const AGENT_OPTIONS = [
  { value: "antigravity", label: "Antigravity（Gemini）" },
  { value: "gemini", label: "Gemini 命令行" },
  { value: "claude", label: "Claude Code 命令行" },
  { value: "codex", label: "Codex 命令行" },
  { value: "opencode", label: "Open Code" },
];

const AI_CATEGORY_OPTIONS = ["编程", "办公", "创意", "分析", "生活"];

const EMPTY_SETTINGS: AppSettings = {
  agentType: "gemini",
  installScope: "global",
  projectRoot: "",
  githubToken: "",
  deepseekApiKey: "",
  language: "",
  showAiCategories: true,
  accentColor: "#1f7aec",
  installMode: "reference",
  storageRoot: "",
};

type QuickInstallSettingKey = "agentType" | "installScope";

function getSurfaceLabel(surface: SurfaceKey) {
  if (surface === "settings") {
    return "应用设置";
  }
  if (surface === "install") {
    return "安装";
  }
  return "技能市场";
}

function formatUpdatedAt(value?: number) {
  if (!value) {
    return "未知";
  }

  return new Date(value * 1000).toLocaleDateString("zh-CN");
}

function getVisibleDescription(skill: Skill, settings: AppSettings) {
  if (settings.language === "zh-CN" && skill.translatedDesc) {
    return skill.translatedDesc;
  }

  return skill.desc;
}

function getVisibleCategory(skill: Skill, settings: AppSettings) {
  if (settings.showAiCategories && skill.aiCategory) {
    return skill.aiCategory;
  }

  return skill.category;
}

function getSourceDisplayName(sourceId: string | undefined, sourceConfigs: MarketplacePayload["sourceConfigs"]) {
  if (!sourceId) {
    return "-";
  }

  if (sourceId === "local") {
    return "本地";
  }

  return sourceConfigs.find((config) => config.id === sourceId)?.displayName || sourceId;
}

function getRuntimeStatusText(
  status: StatusState | null,
  payload: MarketplacePayload | null,
) {
  if (status?.text) {
    return status.text;
  }

  if (payload?.warning) {
    return payload.warning;
  }

  if (payload?.fromCache) {
    return "当前显示的是本地缓存数据。";
  }

  return "就绪";
}

function getAgentLabel(agentType: string) {
  return AGENT_OPTIONS.find((option) => option.value === agentType)?.label || agentType;
}

function getInstallScopeLabel(scope?: string) {
  return scope === "project" ? "项目" : "全局";
}

function getSkillStatusLabels(skill: Skill) {
  return createStateList(
    skill.isDownloaded ? "已下载" : "未下载",
    skill.installedTargetCount ? `已安装 ${skill.installedTargetCount} 个目标` : undefined,
    skill.hasUpdate ? "可更新" : undefined,
    skill.isLocalModified ? "本地已修改" : undefined,
    skill.isFeatured ? "精选" : undefined,
  );
}

function buildSkillContext(skill: Skill, settings: AppSettings) {
  return {
    "技能 ID": skill.id,
    "技能名称": skill.name,
    "来源": skill.source || "未知",
    "分类": getVisibleCategory(skill, settings),
    "仓库": skill.repoOwner && skill.repoName ? `${skill.repoOwner}/${skill.repoName}` : undefined,
  };
}

export function App() {
  const [payload, setPayload] = useState<MarketplacePayload | null>(null);
  const [settingsDraft, setSettingsDraft] = useState<AppSettings>(EMPTY_SETTINGS);
  const [surface, setSurface] = useState<SurfaceKey>("market");
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false);
  const [sidebarPreferenceHydrated, setSidebarPreferenceHydrated] = useState(false);
  const [selectedSkillId, setSelectedSkillId] = useState("");
  const [loading, setLoading] = useState(true);
  const [status, setStatus] = useState<StatusState | null>(null);
  const [operationProgress, setOperationProgress] = useState<OperationProgressState | null>(null);
  const [searchText, setSearchText] = useState("");
  const [activeCategory, setActiveCategory] = useState("全部");
  const [activeSource, setActiveSource] = useState("全部");
  const [contextMenu, setContextMenu] = useState<ContextMenuState | null>(null);
  const [copyingComponentId, setCopyingComponentId] = useState<string | null>(null);
  const [inspectMode, setInspectMode] = useState(false);
  const [savingQuickSetting, setSavingQuickSetting] = useState<QuickInstallSettingKey | null>(null);
  const deferredSearch = useDeferredValue(searchText);

  async function refreshMarketplace(
    forceRefresh = false,
    options: { background?: boolean; syncSettings?: boolean } = {},
  ) {
    const { background = false, syncSettings = false } = options;
    if (!background) {
      setLoading(true);
    }

    try {
      const nextPayload = await loadMarketplace(forceRefresh);
      setPayload(nextPayload);
      setSettingsDraft((current) => {
        if (syncSettings || payload === null) {
          return nextPayload.settings;
        }

        const previousSettings = payload?.settings ?? EMPTY_SETTINGS;
        const hasUnsavedChanges =
          JSON.stringify(current) !== JSON.stringify(previousSettings);
        return hasUnsavedChanges ? current : nextPayload.settings;
      });
      setStatus(
        nextPayload.warning
          ? { tone: "warning", text: nextPayload.warning }
          : null,
      );
    } catch (error) {
      const text = error instanceof Error ? error.message : String(error);
      setStatus({ tone: "error", text });
    } finally {
      if (!background) {
        setLoading(false);
      }
    }
  }

  useEffect(() => {
    void refreshMarketplace(false, { syncSettings: true });
  }, []);

  useEffect(() => {
    let cancelled = false;

    void loadSidebarCollapsedPreference()
      .then((value) => {
        if (!cancelled) {
          setSidebarCollapsed(value);
        }
      })
      .finally(() => {
        if (!cancelled) {
          setSidebarPreferenceHydrated(true);
        }
      });

    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    document.documentElement.style.setProperty(
      "--accent-color",
      settingsDraft.accentColor || "#1f7aec",
    );
  }, [settingsDraft.accentColor]);

  useEffect(() => {
    if (!sidebarPreferenceHydrated) {
      return;
    }

    void setSidebarCollapsedPreference(sidebarCollapsed);
  }, [sidebarCollapsed, sidebarPreferenceHydrated]);

  useEffect(() => {
    let debounceTimer: number | null = null;
    let unlisten: (() => void) | null = null;

    void listen<string>("skill-storage-changed", () => {
      if (debounceTimer) {
        window.clearTimeout(debounceTimer);
      }

      debounceTimer = window.setTimeout(() => {
        void refreshMarketplace(false, { background: true });
      }, 350);
    }).then((dispose) => {
      unlisten = dispose;
    });

    return () => {
      if (debounceTimer) {
        window.clearTimeout(debounceTimer);
      }
      unlisten?.();
    };
  }, []);

  useEffect(() => {
    let resetTimer: number | null = null;
    let unlisten: (() => void) | null = null;

    void listen<OperationProgressState>("skill-operation-progress", (event) => {
      const payload = event.payload;
      setOperationProgress(payload);

      if (resetTimer) {
        window.clearTimeout(resetTimer);
      }

      if (payload.finished) {
        resetTimer = window.setTimeout(() => {
          setOperationProgress(null);
        }, 1200);
      }
    }).then((dispose) => {
      unlisten = dispose;
    });

    return () => {
      if (resetTimer) {
        window.clearTimeout(resetTimer);
      }
      unlisten?.();
    };
  }, []);

  useEffect(() => {
    const updateInspectMode = (event: KeyboardEvent) => {
      setInspectMode(event.altKey);
    };
    const clearInspectMode = () => setInspectMode(false);

    window.addEventListener("keydown", updateInspectMode);
    window.addEventListener("keyup", updateInspectMode);
    window.addEventListener("blur", clearInspectMode);

    return () => {
      window.removeEventListener("keydown", updateInspectMode);
      window.removeEventListener("keyup", updateInspectMode);
      window.removeEventListener("blur", clearInspectMode);
    };
  }, []);

  const skills = payload?.skills ?? [];
  const sources = payload?.sourceConfigs ?? [];
  const sourceStatuses = payload?.sourceStatuses ?? [];
  const sourceStatusMap = useMemo(
    () => new Map(sourceStatuses.map((status) => [status.id, status])),
    [sourceStatuses],
  );

  const categories = useMemo(
    () => [
      "全部",
      "高赞",
      ...(settingsDraft.showAiCategories ? AI_CATEGORY_OPTIONS : []),
    ],
    [settingsDraft.showAiCategories],
  );

  useEffect(() => {
    if (!categories.includes(activeCategory)) {
      setActiveCategory("全部");
    }
  }, [activeCategory, categories]);

  useEffect(() => {
    if (activeCategory !== "高赞" && activeSource !== "全部") {
      setActiveSource("全部");
    }
  }, [activeCategory, activeSource]);

  const marketSkills = useMemo(
    () => skills.filter((skill) => skill.source !== "local"),
    [skills],
  );

  const downloadedSkills = useMemo(
    () => skills.filter((skill) => Boolean(skill.isDownloaded)),
    [skills],
  );

  const filteredMarketSkills = useMemo(() => {
    return marketSkills.filter((skill) => {
      const visibleDescription = getVisibleDescription(skill, settingsDraft);
      const visibleCategory = getVisibleCategory(skill, settingsDraft);
      const matchesText =
        !deferredSearch ||
        skill.name.toLowerCase().includes(deferredSearch.toLowerCase()) ||
        skill.desc.toLowerCase().includes(deferredSearch.toLowerCase()) ||
        visibleDescription.toLowerCase().includes(deferredSearch.toLowerCase());

      const matchesCategory =
        activeCategory === "全部" ||
        (activeCategory === "高赞"
          ? Boolean(skill.isFeatured)
          : visibleCategory === activeCategory);
      const matchesSource =
        activeCategory !== "高赞" ||
        activeSource === "全部" ||
        skill.source === activeSource;

      return matchesText && matchesCategory && matchesSource;
    });
  }, [marketSkills, settingsDraft, deferredSearch, activeCategory, activeSource]);

  const filteredDownloadedSkills = useMemo(() => {
    return downloadedSkills.filter((skill) => {
      const visibleDescription = getVisibleDescription(skill, settingsDraft);
      return (
        !deferredSearch ||
        skill.name.toLowerCase().includes(deferredSearch.toLowerCase()) ||
        skill.desc.toLowerCase().includes(deferredSearch.toLowerCase()) ||
        visibleDescription.toLowerCase().includes(deferredSearch.toLowerCase())
      );
    });
  }, [downloadedSkills, settingsDraft, deferredSearch]);

  const visibleSkills = useMemo(
    () => (surface === "install" ? filteredDownloadedSkills : filteredMarketSkills),
    [filteredDownloadedSkills, filteredMarketSkills, surface],
  );

  useEffect(() => {
    if (surface === "settings") {
      setContextMenu(null);
      return;
    }

    if (!visibleSkills.length) {
      setSelectedSkillId("");
      return;
    }

    const existing = visibleSkills.some((skill) => skill.id === selectedSkillId);
    if (!existing) {
      setSelectedSkillId(visibleSkills[0].id);
    }
  }, [visibleSkills, selectedSkillId, surface]);

  const selectedSkill =
    visibleSkills.find((skill) => skill.id === selectedSkillId) ||
    skills.find((skill) => skill.id === selectedSkillId) ||
    null;

  useEffect(() => {
    if (!contextMenu) {
      return;
    }

    const closeMenu = () => setContextMenu(null);
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        setContextMenu(null);
      }
    };

    window.addEventListener("click", closeMenu);
    window.addEventListener("blur", closeMenu);
    window.addEventListener("resize", closeMenu);
    window.addEventListener("scroll", closeMenu, true);
    window.addEventListener("keydown", handleKeyDown);

    return () => {
      window.removeEventListener("click", closeMenu);
      window.removeEventListener("blur", closeMenu);
      window.removeEventListener("resize", closeMenu);
      window.removeEventListener("scroll", closeMenu, true);
      window.removeEventListener("keydown", handleKeyDown);
    };
  }, [contextMenu]);

  const availableCount = filteredMarketSkills.length;
  const downloadedSkillCount = downloadedSkills.length;
  const installedTargetCount = downloadedSkills.reduce(
    (total, skill) => total + (skill.installedTargetCount ?? skill.installTargets.length),
    0,
  );
  const settingsChanged =
    JSON.stringify(settingsDraft) !== JSON.stringify(payload?.settings ?? EMPTY_SETTINGS);
  const currentSurfaceLabel = getSurfaceLabel(surface);
  const currentAgentLabel = getAgentLabel(settingsDraft.agentType);
  const currentInstallScopeLabel = getInstallScopeLabel(settingsDraft.installScope);
  const contextMenuPosition = contextMenu
    ? clampContextMenuPosition(contextMenu.x, contextMenu.y)
    : null;
  const shellClassName = [
    "desktop-shell",
    inspectMode ? "inspect-mode" : "",
    sidebarCollapsed ? "sidebar-collapsed" : "",
  ]
    .filter(Boolean)
    .join(" ");
  const activeSourceStatus =
    surface === "market" && activeCategory === "高赞" && activeSource !== "全部"
      ? sourceStatusMap.get(activeSource)
      : undefined;
  const runtimeStatusText = getRuntimeStatusText(status, payload);
  const listEmptyText =
    surface === "install"
      ? downloadedSkills.length
        ? "未找到匹配的已下载技能。"
        : "暂无已下载技能。"
      : activeSourceStatus?.status === "error"
        ? `来源 ${activeSourceStatus.displayName} 加载失败${activeSourceStatus.error ? `：${activeSourceStatus.error}` : "。"}`
        : activeSourceStatus?.status === "empty"
          ? `来源 ${activeSourceStatus.displayName} 当前没有可显示技能。`
          : "未发现匹配的技能";

  function handleInspectContextMenu(event: ReactMouseEvent<HTMLElement>) {
    if (!event.altKey) {
      setContextMenu(null);
      return;
    }

    const target = event.target;
    if (!(target instanceof HTMLElement) || target.closest(".context-menu")) {
      return;
    }

    event.preventDefault();
    event.stopPropagation();

    const component = resolveComponentSnapshot(target, currentSurfaceLabel);
    if (!component) {
      setStatus({
        tone: "warning",
        text: "未识别到可复制的组件，请把鼠标放到具体区域或控件上后按住 Alt 再右键。",
      });
      return;
    }

    setContextMenu({
      x: event.clientX,
      y: event.clientY,
      component,
    });
  }

  async function handleCopyComponentInfo(component: ComponentSnapshot) {
    setContextMenu(null);
    setCopyingComponentId(component.id);

    try {
      await copyTextToClipboard(buildComponentClipboardText(component));
      setStatus({
        tone: "success",
        text: `已复制“${component.label}”的组件定位信息，直接粘贴给我再补一句需求就可以。`,
      });
    } catch (error) {
      setStatus({
        tone: "error",
        text: error instanceof Error ? error.message : String(error),
      });
    } finally {
      setCopyingComponentId(null);
    }
  }

  async function handleSaveSettings() {
    try {
      await saveSettings(settingsDraft);
      setStatus({ tone: "success", text: "设置已保存。" });
      await refreshMarketplace(true, { syncSettings: true });
    } catch (error) {
      setStatus({
        tone: "error",
        text: error instanceof Error ? error.message : String(error),
      });
    }
  }

  async function handleQuickInstallSettingChange(
    key: QuickInstallSettingKey,
    value: string,
  ) {
    const savedSettings = payload?.settings ?? EMPTY_SETTINGS;
    const previousDraftValue = settingsDraft[key];

    setSettingsDraft((current) => ({ ...current, [key]: value }));

    if (value === savedSettings[key]) {
      return;
    }

    setSavingQuickSetting(key);

    try {
      await saveSettings({ ...savedSettings, [key]: value });
      await refreshMarketplace(true, { background: true });

      const settingName = key === "agentType" ? "安装目标" : "安装范围";
      const selectedLabel =
        key === "agentType" ? getAgentLabel(value) : getInstallScopeLabel(value);
      const missingProjectRoot =
        key === "installScope" &&
        value === "project" &&
        !settingsDraft.projectRoot.trim();

      setStatus({
        tone: missingProjectRoot ? "warning" : "success",
        text: missingProjectRoot
          ? `已将${settingName}切换为${selectedLabel}。\n当前未保存项目根目录，安装前请先到设置中填写并保存。`
          : `已将${settingName}切换为${selectedLabel}。`,
      });
    } catch (error) {
      setSettingsDraft((current) => ({ ...current, [key]: previousDraftValue }));
      setStatus({
        tone: "error",
        text: error instanceof Error ? error.message : String(error),
      });
    } finally {
      setSavingQuickSetting(null);
    }
  }

  async function handlePickProjectRoot() {
    try {
      const picked = await pickDirectory("选择项目根目录");
      if (picked) {
        setSettingsDraft((current) => ({ ...current, projectRoot: picked }));
      }
    } catch (error) {
      setStatus({
        tone: "error",
        text: error instanceof Error ? error.message : String(error),
      });
    }
  }

  async function handlePickStorageRoot() {
    try {
      const picked = await pickDirectory("选择默认存储目录");
      if (picked) {
        setSettingsDraft((current) => ({ ...current, storageRoot: picked }));
      }
    } catch (error) {
      setStatus({
        tone: "error",
        text: error instanceof Error ? error.message : String(error),
      });
    }
  }

  function toggleSidebar() {
    setSidebarCollapsed((current) => !current);
  }

  function expandSidebar() {
    setSidebarCollapsed(false);
  }

  return (
    <main className={shellClassName} onContextMenuCapture={handleInspectContextMenu}>
      <AppSidebar
        downloadedSkillCount={downloadedSkillCount}
        installedTargetCount={installedTargetCount}
        onExpandSidebar={expandSidebar}
        onSurfaceChange={setSurface}
        onToggleSidebar={toggleSidebar}
        sidebarCollapsed={sidebarCollapsed}
        surface={surface}
      />

      <section
        className="desktop-main"
        {...getComponentAttrs({
          id: "desktop-main",
          label: "主内容区",
          type: "工作区",
          location: "主窗口",
          context: { "当前页面": currentSurfaceLabel },
        })}
      >
        <header
          className="command-bar"
          {...getComponentAttrs({
            id: "command-bar",
            label: "顶部命令栏",
            type: "工具栏",
            location: "顶部命令栏",
            text:
              surface === "settings"
                ? "应用设置 管理安装路径、翻译配置和界面显示行为。"
                : surface === "install"
                  ? "安装页面 管理本地已下载技能并以引用方式安装到各终端。"
                  : "技能市场 浏览远端技能并先下载到本地仓库。",
            context: { "当前页面": currentSurfaceLabel },
          })}
        >
          <div
            className="command-title"
            {...getComponentAttrs({
              id: "command-title",
              label: "当前页面标题区",
              type: "标题区",
              location: "顶部命令栏",
              text:
                surface === "settings"
                  ? "应用设置 管理安装路径、翻译配置和界面显示行为。"
                  : surface === "install"
                    ? "安装页面 管理本地已下载技能并以引用方式安装到各终端。"
                    : "技能市场 浏览远端技能并先下载到本地仓库。",
            })}
          >
            <strong>{currentSurfaceLabel}</strong>
            <span>
              {surface === "settings"
                ? "管理安装路径、翻译配置和界面显示行为。"
                : surface === "install"
                  ? "管理本地已下载技能，并把它们引用安装到不同终端。"
                  : "浏览远端技能，先下载到本地仓库，再进入安装页完成引用安装。"}
            </span>
          </div>

          <div
            className="command-actions"
            {...getComponentAttrs({
              id: "command-actions",
              label: "命令栏操作区",
              type: "操作区",
              location: "顶部命令栏",
            })}
          >
            {surface !== "settings" ? (
              <input
                className="desktop-search"
                type="search"
                placeholder={surface === "install" ? "搜索已下载技能..." : "搜索技能..."}
                value={searchText}
                onChange={(event) => setSearchText(event.target.value)}
                {...getComponentAttrs({
                  id: "toolbar-search",
                  label: "搜索输入框",
                  type: "输入框",
                  location: "顶部命令栏",
                  value: searchText || "空白",
                  state: createStateList(searchText ? "已填写" : "空白"),
                  context: { "当前页面": currentSurfaceLabel },
                })}
              />
            ) : null}
            <button
              className="toolbar-button"
              onClick={() => void refreshMarketplace(false)}
              {...getComponentAttrs({
                id: "toolbar-refresh",
                label: "刷新按钮",
                type: "按钮",
                location: "顶部命令栏",
                text: "刷新",
                context: { "当前页面": currentSurfaceLabel },
              })}
            >
              刷新
            </button>
            <button
              className="toolbar-button primary"
              onClick={() => void refreshMarketplace(true)}
              {...getComponentAttrs({
                id: "toolbar-force-sync",
                label: "强制同步按钮",
                type: "按钮",
                location: "顶部命令栏",
                text: "强制同步",
                context: { "当前页面": currentSurfaceLabel },
              })}
            >
              强制同步
            </button>
            {surface === "settings" ? (
              <button
                className="toolbar-button primary"
                disabled={!settingsChanged}
                onClick={() => void handleSaveSettings()}
                {...getComponentAttrs({
                  id: "toolbar-save-settings",
                  label: "保存设置按钮",
                  type: "按钮",
                  location: "顶部命令栏",
                  text: "保存设置",
                  state: createStateList(settingsChanged ? "有未保存修改" : "无需保存"),
                })}
              >
                保存设置
              </button>
            ) : null}
          </div>
        </header>

        {operationProgress ? (
          <div
            className="operation-progress"
            {...getComponentAttrs({
              id: "operation-progress",
              label: "操作进度条",
              type: "进度条",
              location: "主窗口顶部",
              text: operationProgress.message,
              state: createStateList(operationProgress.finished ? "已完成" : "进行中"),
            })}
          >
            <div className="operation-progress-info">
              <span>{operationProgress.message}</span>
              <span>
                {operationProgress.total > 0
                  ? `${Math.min(
                      100,
                      Math.round((operationProgress.current / operationProgress.total) * 100),
                    )}%`
                  : "处理中"}
              </span>
            </div>
            <div className="operation-progress-track">
              <div
                className="operation-progress-fill"
                style={{
                  width:
                    operationProgress.total > 0
                      ? `${Math.min(
                          100,
                          Math.round((operationProgress.current / operationProgress.total) * 100),
                        )}%`
                      : "100%",
                }}
              />
            </div>
          </div>
        ) : null}

        {surface === "settings" ? (
          <section
            className="settings-workspace"
            {...getComponentAttrs({
              id: "settings-workspace",
              label: "设置工作区",
              type: "工作区",
              location: "设置页面",
              context: { "当前页面": currentSurfaceLabel },
            })}
          >
            <section
              className="settings-group"
              {...getComponentAttrs({
                id: "settings-group-install",
                label: "安装位置分组",
                type: "设置分组",
                location: "设置 > 安装位置",
                text: "安装位置 选择桌面应用为不同 Agent 安装技能的目标目录。",
                context: { "设置分组": "安装位置" },
              })}
            >
              <header>
                <h2>安装位置</h2>
                <p>选择桌面应用为不同 Agent 安装技能的目标目录。</p>
              </header>
              <div className="settings-form two-column">
                <label
                  {...getComponentAttrs({
                    id: "settings-field-agent-type",
                    label: "目标 Agent 设置项",
                    type: "设置项",
                    location: "设置 > 安装位置",
                    text: "目标 Agent",
                    context: { "设置项": "目标 Agent" },
                  })}
                >
                  <span>目标 Agent</span>
                  <select
                    value={settingsDraft.agentType}
                    onChange={(event) =>
                      setSettingsDraft((current) => ({
                        ...current,
                        agentType: event.target.value,
                      }))
                    }
                    {...getComponentAttrs({
                      id: "settings-input-agent-type",
                      label: "目标 Agent 选择器",
                      type: "下拉选择",
                      location: "设置 > 安装位置",
                      value:
                        AGENT_OPTIONS.find((option) => option.value === settingsDraft.agentType)
                          ?.label || settingsDraft.agentType,
                      context: { "设置项": "目标 Agent" },
                    })}
                  >
                    {AGENT_OPTIONS.map((option) => (
                      <option key={option.value} value={option.value}>
                        {option.label}
                      </option>
                    ))}
                  </select>
                </label>

                <label
                  {...getComponentAttrs({
                    id: "settings-field-install-scope",
                    label: "安装范围设置项",
                    type: "设置项",
                    location: "设置 > 安装位置",
                    text: "安装范围",
                    context: { "设置项": "安装范围" },
                  })}
                >
                  <span>安装范围</span>
                  <select
                    value={settingsDraft.installScope}
                    onChange={(event) =>
                      setSettingsDraft((current) => ({
                        ...current,
                        installScope: event.target.value,
                      }))
                    }
                    {...getComponentAttrs({
                      id: "settings-input-install-scope",
                      label: "安装范围选择器",
                      type: "下拉选择",
                      location: "设置 > 安装位置",
                      value: settingsDraft.installScope === "project" ? "项目" : "全局",
                      context: { "设置项": "安装范围" },
                    })}
                  >
                    <option value="global">全局</option>
                    <option value="project">项目</option>
                  </select>
                </label>

                <label
                  className="full-span"
                  {...getComponentAttrs({
                    id: "settings-field-project-root",
                    label: "项目根目录设置项",
                    type: "设置项",
                    location: "设置 > 安装位置",
                    text: "项目根目录",
                    context: { "设置项": "项目根目录" },
                  })}
                >
                  <span>项目根目录</span>
                  <div
                    className="path-picker"
                    {...getComponentAttrs({
                      id: "settings-project-root-picker",
                      label: "项目根目录选择区",
                      type: "组合控件",
                      location: "设置 > 安装位置",
                      context: { "设置项": "项目根目录" },
                    })}
                  >
                    <input
                      type="text"
                      value={settingsDraft.projectRoot}
                      placeholder="仅在项目安装模式下使用"
                      onChange={(event) =>
                        setSettingsDraft((current) => ({
                          ...current,
                          projectRoot: event.target.value,
                        }))
                      }
                      {...getComponentAttrs({
                        id: "settings-input-project-root",
                        label: "项目根目录输入框",
                        type: "输入框",
                        location: "设置 > 安装位置",
                        value: settingsDraft.projectRoot || "未设置",
                        state: createStateList(settingsDraft.projectRoot ? "已填写" : "空白"),
                        context: { "设置项": "项目根目录" },
                      })}
                    />
                    <button
                      className="toolbar-button"
                      onClick={() => void handlePickProjectRoot()}
                      {...getComponentAttrs({
                        id: "settings-button-project-root-browse",
                        label: "项目根目录浏览按钮",
                        type: "按钮",
                        location: "设置 > 安装位置",
                        text: "浏览",
                        context: { "设置项": "项目根目录" },
                      })}
                    >
                      浏览
                    </button>
                  </div>
                </label>

                <label
                  className="full-span"
                  {...getComponentAttrs({
                    id: "settings-field-storage-root",
                    label: "实际存储目录设置项",
                    type: "设置项",
                    location: "设置 > 安装位置",
                    text: "实际存储目录",
                    context: { "设置项": "实际存储目录" },
                  })}
                >
                  <span>实际存储目录</span>
                  <div
                    className="path-picker"
                    {...getComponentAttrs({
                      id: "settings-storage-root-picker",
                      label: "实际存储目录选择区",
                      type: "组合控件",
                      location: "设置 > 安装位置",
                      context: { "设置项": "实际存储目录" },
                    })}
                  >
                    <input
                      type="text"
                      value={settingsDraft.storageRoot}
                      placeholder="留空时自动使用桌面应用默认存储目录"
                      onChange={(event) =>
                        setSettingsDraft((current) => ({
                          ...current,
                          storageRoot: event.target.value,
                        }))
                      }
                      {...getComponentAttrs({
                        id: "settings-input-storage-root",
                        label: "实际存储目录输入框",
                        type: "输入框",
                        location: "设置 > 安装位置",
                        value: settingsDraft.storageRoot || "自动",
                        state: createStateList(settingsDraft.storageRoot ? "已填写" : "自动"),
                        context: { "设置项": "实际存储目录" },
                      })}
                    />
                    <button
                      className="toolbar-button"
                      onClick={() => void handlePickStorageRoot()}
                      {...getComponentAttrs({
                        id: "settings-button-storage-root-browse",
                        label: "实际存储目录浏览按钮",
                        type: "按钮",
                        location: "设置 > 安装位置",
                        text: "浏览",
                        context: { "设置项": "实际存储目录" },
                      })}
                    >
                      浏览
                    </button>
                  </div>
                </label>
              </div>
            </section>

            <section
              className="settings-group"
              {...getComponentAttrs({
                id: "settings-group-integrations",
                label: "服务集成分组",
                type: "设置分组",
                location: "设置 > 服务集成",
                text: "服务集成 通过显式设置来管理 GitHub 和 DeepSeek 的接入参数。",
                context: { "设置分组": "服务集成" },
              })}
            >
              <header>
                <h2>服务集成</h2>
                <p>通过显式设置来管理 GitHub 和 DeepSeek 的接入参数。</p>
              </header>
              <div className="settings-form">
                <label
                  {...getComponentAttrs({
                    id: "settings-field-github-token",
                    label: "GitHub 访问令牌设置项",
                    type: "设置项",
                    location: "设置 > 服务集成",
                    text: "GitHub 访问令牌",
                    context: { "设置项": "GitHub 访问令牌" },
                  })}
                >
                  <span>GitHub 访问令牌</span>
                  <input
                    type="password"
                    value={settingsDraft.githubToken}
                    placeholder="可选，用于提升 GitHub 接口访问频率限制"
                    onChange={(event) =>
                      setSettingsDraft((current) => ({
                        ...current,
                        githubToken: event.target.value,
                      }))
                    }
                    {...getComponentAttrs({
                      id: "settings-input-github-token",
                      label: "GitHub 访问令牌输入框",
                      type: "密码输入框",
                      location: "设置 > 服务集成",
                      state: createStateList(
                        settingsDraft.githubToken ? "已填写" : "空白",
                        "敏感字段",
                      ),
                      context: { "设置项": "GitHub 访问令牌" },
                    })}
                  />
                </label>

                <label
                  {...getComponentAttrs({
                    id: "settings-field-deepseek-key",
                    label: "DeepSeek 密钥设置项",
                    type: "设置项",
                    location: "设置 > 服务集成",
                    text: "DeepSeek 密钥",
                    context: { "设置项": "DeepSeek 密钥" },
                  })}
                >
                  <span>DeepSeek 密钥</span>
                  <input
                    type="password"
                    value={settingsDraft.deepseekApiKey}
                    placeholder="用于翻译和 AI 分类"
                    onChange={(event) =>
                      setSettingsDraft((current) => ({
                        ...current,
                        deepseekApiKey: event.target.value,
                      }))
                    }
                    {...getComponentAttrs({
                      id: "settings-input-deepseek-key",
                      label: "DeepSeek 密钥输入框",
                      type: "密码输入框",
                      location: "设置 > 服务集成",
                      state: createStateList(
                        settingsDraft.deepseekApiKey ? "已填写" : "空白",
                        "敏感字段",
                      ),
                      context: { "设置项": "DeepSeek 密钥" },
                    })}
                  />
                </label>
              </div>
            </section>

            <section
              className="settings-group"
              {...getComponentAttrs({
                id: "settings-group-appearance",
                label: "界面显示分组",
                type: "设置分组",
                location: "设置 > 界面显示",
                text: "界面显示 以桌面应用的偏好设置方式控制语言、分类显示和主题色。",
                context: { "设置分组": "界面显示" },
              })}
            >
              <header>
                <h2>界面显示</h2>
                <p>以桌面应用的偏好设置方式控制语言、分类显示和主题色。</p>
              </header>
              <div className="settings-form two-column">
                <label
                  {...getComponentAttrs({
                    id: "settings-field-language",
                    label: "语言设置项",
                    type: "设置项",
                    location: "设置 > 界面显示",
                    text: "语言",
                    context: { "设置项": "语言" },
                  })}
                >
                  <span>语言</span>
                  <select
                    value={settingsDraft.language}
                    onChange={(event) =>
                      setSettingsDraft((current) => ({
                        ...current,
                        language: event.target.value,
                      }))
                    }
                    {...getComponentAttrs({
                      id: "settings-input-language",
                      label: "语言选择器",
                      type: "下拉选择",
                      location: "设置 > 界面显示",
                      value: settingsDraft.language === "zh-CN" ? "中文" : "原文",
                      context: { "设置项": "语言" },
                    })}
                  >
                    <option value="">原文</option>
                    <option value="zh-CN">中文</option>
                  </select>
                </label>

                <label
                  {...getComponentAttrs({
                    id: "settings-field-accent-color",
                    label: "强调色设置项",
                    type: "设置项",
                    location: "设置 > 界面显示",
                    text: "强调色",
                    context: { "设置项": "强调色" },
                  })}
                >
                  <span>强调色</span>
                  <div
                    className="color-picker"
                    {...getComponentAttrs({
                      id: "settings-accent-color-picker",
                      label: "强调色选择区",
                      type: "组合控件",
                      location: "设置 > 界面显示",
                      context: { "设置项": "强调色" },
                    })}
                  >
                    <input
                      type="color"
                      value={settingsDraft.accentColor}
                      onChange={(event) =>
                        setSettingsDraft((current) => ({
                          ...current,
                          accentColor: event.target.value,
                        }))
                      }
                      {...getComponentAttrs({
                        id: "settings-input-accent-color-picker",
                        label: "强调色色板",
                        type: "颜色选择器",
                        location: "设置 > 界面显示",
                        value: settingsDraft.accentColor,
                        context: { "设置项": "强调色" },
                      })}
                    />
                    <input
                      type="text"
                      value={settingsDraft.accentColor}
                      onChange={(event) =>
                        setSettingsDraft((current) => ({
                          ...current,
                          accentColor: event.target.value,
                        }))
                      }
                      {...getComponentAttrs({
                        id: "settings-input-accent-color-text",
                        label: "强调色文本输入框",
                        type: "输入框",
                        location: "设置 > 界面显示",
                        value: settingsDraft.accentColor,
                        state: createStateList("已填写"),
                        context: { "设置项": "强调色" },
                      })}
                    />
                  </div>
                </label>

                <label
                  className="full-span"
                  {...getComponentAttrs({
                    id: "settings-field-ai-category",
                    label: "AI 分类显示设置项",
                    type: "设置项",
                    location: "设置 > 界面显示",
                    text: "AI 分类显示",
                    context: { "设置项": "AI 分类显示" },
                  })}
                >
                  <span>AI 分类显示</span>
                  <button
                    type="button"
                    className={settingsDraft.showAiCategories ? "toggle-button on" : "toggle-button"}
                    onClick={() =>
                      setSettingsDraft((current) => ({
                        ...current,
                        showAiCategories: !current.showAiCategories,
                      }))
                    }
                    {...getComponentAttrs({
                      id: "settings-toggle-ai-category",
                      label: "AI 分类显示开关",
                      type: "开关按钮",
                      location: "设置 > 界面显示",
                      text: settingsDraft.showAiCategories ? "开启" : "关闭",
                      state: createStateList(settingsDraft.showAiCategories ? "已开启" : "已关闭"),
                      context: { "设置项": "AI 分类显示" },
                    })}
                  >
                    <span />
                    {settingsDraft.showAiCategories ? "开启" : "关闭"}
                  </button>
                </label>
              </div>
            </section>
          </section>
        ) : (
          <section
            className="market-workspace"
            {...getComponentAttrs({
              id: surface === "install" ? "install-workspace" : "market-workspace",
              label: surface === "install" ? "安装工作区" : "技能市场工作区",
              type: "工作区",
              location: "主工作区",
              context: { "当前页面": currentSurfaceLabel },
            })}
          >
            {surface === "install" ? (
              <div
                className="market-tabs"
                {...getComponentAttrs({
                  id: "install-target-bar",
                  label: "安装目标配置栏",
                  type: "配置栏",
                  location: "主工作区顶部",
                  context: {
                    "安装目标": currentAgentLabel,
                    "安装范围": currentInstallScopeLabel,
                    "项目根目录": settingsDraft.projectRoot || "未设置",
                  },
                })}
              >
                <div
                  className="market-tab-controls"
                  {...getComponentAttrs({
                    id: "install-target-controls",
                    label: "安装目标设置区",
                    type: "组合控件",
                    location: "主工作区顶部",
                    context: {
                      "安装目标": currentAgentLabel,
                      "安装范围": currentInstallScopeLabel,
                    },
                  })}
                >
                  <label
                    className="market-inline-field"
                    {...getComponentAttrs({
                      id: "install-field-agent-type",
                      label: "安装目标设置项",
                      type: "设置项",
                      location: "主工作区顶部",
                      text: "安装目标",
                      context: { "当前值": currentAgentLabel },
                    })}
                  >
                    <span>安装目标</span>
                    <select
                      value={settingsDraft.agentType}
                      disabled={savingQuickSetting !== null}
                      onChange={(event) =>
                        void handleQuickInstallSettingChange("agentType", event.target.value)
                      }
                      {...getComponentAttrs({
                        id: "install-input-agent-type",
                        label: "安装目标选择器",
                        type: "下拉选择",
                        location: "主工作区顶部",
                        value: currentAgentLabel,
                        state: createStateList(
                          savingQuickSetting === "agentType" ? "正在保存" : "已同步",
                        ),
                        context: { "设置项": "安装目标" },
                      })}
                    >
                      {AGENT_OPTIONS.map((option) => (
                        <option key={option.value} value={option.value}>
                          {option.label}
                        </option>
                      ))}
                    </select>
                  </label>

                  <label
                    className="market-inline-field"
                    {...getComponentAttrs({
                      id: "install-field-install-scope",
                      label: "安装范围设置项",
                      type: "设置项",
                      location: "主工作区顶部",
                      text: "安装范围",
                      context: { "当前值": currentInstallScopeLabel },
                    })}
                  >
                    <span>安装范围</span>
                    <select
                      value={settingsDraft.installScope}
                      disabled={savingQuickSetting !== null}
                      onChange={(event) =>
                        void handleQuickInstallSettingChange("installScope", event.target.value)
                      }
                      {...getComponentAttrs({
                        id: "install-input-install-scope",
                        label: "安装范围选择器",
                        type: "下拉选择",
                        location: "主工作区顶部",
                        value: currentInstallScopeLabel,
                        state: createStateList(
                          savingQuickSetting === "installScope" ? "正在保存" : "已同步",
                        ),
                        context: { "设置项": "安装范围" },
                      })}
                    >
                      <option value="global">全局</option>
                      <option value="project">项目</option>
                    </select>
                  </label>

                  {settingsDraft.installScope === "project" ? (
                    <label
                      className="market-inline-field market-inline-field-wide"
                      {...getComponentAttrs({
                        id: "install-field-project-root",
                        label: "安装页项目根目录设置项",
                        type: "设置项",
                        location: "主工作区顶部",
                        text: "项目根目录",
                        context: { "当前值": settingsDraft.projectRoot || "未设置" },
                      })}
                    >
                      <span>项目根目录</span>
                      <input
                        type="text"
                        value={settingsDraft.projectRoot}
                        placeholder="安装到项目作用域时必填"
                        onChange={(event) =>
                          setSettingsDraft((current) => ({
                            ...current,
                            projectRoot: event.target.value,
                          }))
                        }
                        {...getComponentAttrs({
                          id: "install-input-project-root",
                          label: "安装页项目根目录输入框",
                          type: "输入框",
                          location: "主工作区顶部",
                          value: settingsDraft.projectRoot || "未设置",
                          state: createStateList(settingsDraft.projectRoot ? "已填写" : "空白"),
                        })}
                      />
                      <button
                        type="button"
                        className="toolbar-button"
                        onClick={() => void handlePickProjectRoot()}
                        {...getComponentAttrs({
                          id: "install-button-project-root-browse",
                          label: "安装页项目根目录浏览按钮",
                          type: "按钮",
                          location: "主工作区顶部",
                          text: "浏览",
                        })}
                      >
                        浏览
                      </button>
                    </label>
                  ) : null}
                </div>
              </div>
            ) : null}

            {surface === "market" ? (
              <div
                className="market-categories"
                {...getComponentAttrs({
                  id: "market-categories",
                  label: "技能分类栏",
                  type: "筛选栏",
                  location: "主工作区顶部",
                  context: { "当前分类": activeCategory },
                })}
              >
                {categories.map((category) => (
                  <button
                    key={category}
                    type="button"
                    className={activeCategory === category ? "category-chip active" : "category-chip"}
                    onClick={() => setActiveCategory(category)}
                    {...getComponentAttrs({
                      id: `category-chip:${category}`,
                      label: `${category} 分类按钮`,
                      type: "筛选按钮",
                      location: "主工作区顶部",
                      text: category,
                      state: createStateList(activeCategory === category ? "已选中" : undefined),
                    })}
                  >
                    {category === "高赞" ? "✓ 高赞榜" : category}
                  </button>
                ))}
              </div>
            ) : null}

            {surface === "market" && activeCategory === "高赞" ? (
              <div
                className="source-filter-container visible"
                {...getComponentAttrs({
                  id: "source-filter-container",
                  label: "来源筛选栏",
                  type: "二级筛选栏",
                  location: "主工作区顶部",
                  context: { "当前来源": activeSource },
                })}
              >
                <button
                  type="button"
                  className={activeSource === "全部" ? "source-filter-chip active" : "source-filter-chip"}
                  onClick={() => setActiveSource("全部")}
                  {...getComponentAttrs({
                    id: "source-chip:all",
                    label: "全部来源按钮",
                    type: "筛选按钮",
                    location: "主工作区顶部",
                    text: "全部",
                    state: createStateList(activeSource === "全部" ? "已选中" : undefined),
                  })}
                >
                  全部
                </button>
                {sources.map((source) => (
                  (() => {
                    const sourceStatus = sourceStatusMap.get(source.id);
                    const sourceState = sourceStatus?.status ?? "unknown";
                    const sourceCount = sourceStatus?.skillCount ?? 0;

                    return (
                      <button
                        key={source.id}
                        type="button"
                        className={
                          activeSource === source.id
                            ? `source-filter-chip active source-state-${sourceState}`
                            : `source-filter-chip source-state-${sourceState}`
                        }
                        onClick={() => setActiveSource(source.id)}
                        {...getComponentAttrs({
                          id: `source-chip:${source.id}`,
                          label: `${source.displayName} 来源按钮`,
                          type: "筛选按钮",
                          location: "主工作区顶部",
                          text: source.displayName,
                          state: createStateList(
                            activeSource === source.id ? "已选中" : undefined,
                            sourceState === "error"
                              ? "加载失败"
                              : sourceState === "empty"
                                ? "空来源"
                                : undefined,
                          ),
                          context: {
                            "来源状态": sourceState,
                            "技能数量": sourceCount,
                          },
                        })}
                      >
                        <img className="source-chip-icon" src={source.iconUrl} alt={source.displayName} />
                        {source.displayName}
                        <span className="source-chip-count">{sourceCount}</span>
                      </button>
                    );
                  })()
                ))}
              </div>
            ) : null}

            <section
              className="workspace-split"
              {...getComponentAttrs({
                id: "workspace-split",
                label: "列表详情工作区",
                type: "工作区",
                location: "主工作区",
                context: { "当前页面": currentSurfaceLabel },
              })}
            >
              <section
                className="list-pane"
                {...getComponentAttrs({
                  id: "skills-list-pane",
                  label: "技能列表区",
                  type: "列表区域",
                  location: "主工作区 > 左侧列表区",
                  context: { "当前页面": currentSurfaceLabel },
                })}
              >
              <div
                className="list-header"
                {...getComponentAttrs({
                  id: "skills-list-header",
                  label: "技能列表表头区",
                  type: "表头区域",
                  location: "主工作区 > 左侧列表区",
                })}
              >
                <div
                  className="list-header-row header"
                  {...getComponentAttrs({
                    id: "skills-list-header-row",
                    label: "技能列表表头",
                    type: "表头行",
                    location: "主工作区 > 左侧列表区",
                  })}
                >
                  <span
                    {...getComponentAttrs({
                      id: "skills-list-header-name",
                      label: "名称列表头",
                      type: "表头项",
                      location: "主工作区 > 左侧列表区",
                      text: "名称",
                    })}
                  >
                    名称
                  </span>
                  <span
                    {...getComponentAttrs({
                      id: "skills-list-header-source",
                      label: "来源列表头",
                      type: "表头项",
                      location: "主工作区 > 左侧列表区",
                      text: "来源",
                    })}
                  >
                    来源
                  </span>
                  <span
                    {...getComponentAttrs({
                      id: "skills-list-header-category",
                      label: "分类列表头",
                      type: "表头项",
                      location: "主工作区 > 左侧列表区",
                      text: "分类",
                    })}
                  >
                    分类
                  </span>
                  <span
                    {...getComponentAttrs({
                      id: "skills-list-header-updated",
                      label: "更新列表头",
                      type: "表头项",
                      location: "主工作区 > 左侧列表区",
                      text: "更新",
                    })}
                  >
                    更新
                  </span>
                  <span
                    {...getComponentAttrs({
                      id: "skills-list-header-status",
                      label: "状态列表头",
                      type: "表头项",
                      location: "主工作区 > 左侧列表区",
                      text: "状态",
                    })}
                  >
                    状态
                  </span>
                </div>
              </div>

              <div
                className="list-body"
                {...getComponentAttrs({
                  id: "skills-list-body",
                  label: "技能列表内容区",
                  type: "列表内容区",
                  location: "主工作区 > 左侧列表区",
                  state: createStateList(loading ? "加载中" : "已加载"),
                })}
              >
                {loading ? (
                  <div
                    className="empty-state"
                    {...getComponentAttrs({
                      id: "skills-list-loading",
                      label: "技能列表加载状态",
                      type: "空状态",
                      location: "主工作区 > 左侧列表区",
                      text: surface === "install" ? "正在加载本地安装数据..." : "正在加载技能市场数据...",
                      state: createStateList("加载中"),
                    })}
                  >
                    {surface === "install" ? "正在加载本地安装数据..." : "正在加载技能市场数据..."}
                  </div>
                ) : null}
                {!loading && !visibleSkills.length ? (
                  <div
                    className="empty-state"
                    {...getComponentAttrs({
                      id: "skills-list-empty",
                      label: "技能列表空状态",
                      type: "空状态",
                      location: "主工作区 > 左侧列表区",
                      text: listEmptyText,
                      state: createStateList(
                        "无匹配结果",
                        activeSourceStatus?.status === "error" ? "来源加载失败" : undefined,
                        activeSourceStatus?.status === "empty" ? "来源为空" : undefined,
                      ),
                    })}
                  >
                    {listEmptyText}
                  </div>
                ) : null}

                {!loading
                  ? visibleSkills.map((skill) => {
                      const skillDescription = getVisibleDescription(skill, settingsDraft);
                      const skillCategory = getVisibleCategory(skill, settingsDraft);
                      const skillContext = buildSkillContext(skill, settingsDraft);
                      const sourceDisplayName = getSourceDisplayName(skill.source, sources);
                      const skillState = createStateList(
                        ...getSkillStatusLabels(skill),
                        selectedSkill?.id === skill.id ? "已选中" : undefined,
                      );

                      return (
                        <button
                          key={skill.id}
                          type="button"
                          className={selectedSkill?.id === skill.id ? "list-row selected" : "list-row"}
                          onClick={() => setSelectedSkillId(skill.id)}
                          {...getComponentAttrs({
                            id: `skill-row:${skill.id}`,
                            label: `${skill.name} 技能条目`,
                            type: "列表项",
                            location: "主工作区 > 左侧列表区",
                            text: `${skill.name} ${skillDescription}`,
                            state: skillState,
                            context: { ...skillContext, "来源显示名": sourceDisplayName },
                          })}
                        >
                          <div className="skill-cell skill-name-cell">
                            <div
                              className="row-icon"
                              style={{
                                background: `linear-gradient(135deg, ${skill.colors[0]}, ${skill.colors[1]})`,
                              }}
                            >
                              {skill.icon}
                            </div>
                            <div className="row-copy">
                              <strong>{skill.name}</strong>
                              <span>{skillDescription}</span>
                            </div>
                          </div>
                          <span className="skill-cell">{sourceDisplayName}</span>
                          <span className="skill-cell">{skillCategory}</span>
                          <span className="skill-cell">{formatUpdatedAt(skill.lastUpdated)}</span>
                          <span className="skill-cell status-cell">
                            {skill.isDownloaded ? <span className="row-badge success">已下载</span> : null}
                            {skill.installedTargetCount ? (
                              <span className="row-badge success">
                                已安装 {skill.installedTargetCount}
                              </span>
                            ) : null}
                            {skill.hasUpdate ? <span className="row-badge warning">可更新</span> : null}
                            {skill.isLocalModified ? <span className="row-badge warning">已修改</span> : null}
                            {!skill.isDownloaded && !skill.hasUpdate && !skill.isLocalModified ? (
                              <span className="row-badge">可下载</span>
                            ) : null}
                            {skill.isDownloaded && !skill.installedTargetCount && !skill.hasUpdate ? (
                              <span className="row-badge">待安装</span>
                            ) : null}
                          </span>
                        </button>
                      );
                    })
                  : null}
              </div>
            </section>

          </section>
          </section>
        )}

        <StatusBar
          availableCount={availableCount}
          downloadedCount={downloadedSkillCount}
          installedTargetCount={installedTargetCount}
          payload={payload}
          runtimeStatusText={runtimeStatusText}
          status={status}
          surface={surface}
        />
      </section>

      <InspectContextMenu
        contextMenu={contextMenu}
        copyingComponentId={copyingComponentId}
        position={contextMenuPosition}
        onCopy={handleCopyComponentInfo}
      />
    </main>
  );
}
