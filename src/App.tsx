import {
  useDeferredValue,
  useEffect,
  useMemo,
  useState,
  type MouseEvent as ReactMouseEvent,
} from "react";
import {
  getSkillDetail,
  installSkill,
  loadMarketplace,
  restoreSkill,
  saveSkillReadme,
  saveSettings,
  uninstallSkill,
  updateSkill,
} from "./desktop/api";
import { listen } from "@tauri-apps/api/event";
import { AppSidebar } from "./components/layout/AppSidebar";
import { InspectContextMenu } from "./components/layout/InspectContextMenu";
import { StatusBar } from "./components/layout/StatusBar";
import type {
  OperationProgressState,
  StatusState,
  SurfaceKey,
  TabKey,
} from "./app/types";
import type {
  AppSettings,
  MarketplacePayload,
  Skill,
  SkillDetail,
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
  confirmDanger,
  copyTextToClipboard,
  openExternalUrl,
  openLocalPath,
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

type SkillAction =
  | "install"
  | "update"
  | "restore"
  | "uninstall"
  | "openRepo"
  | "openDir"
  | "openReadme";

function getSurfaceLabel(surface: SurfaceKey) {
  return surface === "settings" ? "应用设置" : "技能市场";
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

function getInstallModeLabel(mode?: string) {
  return mode === "copy" ? "复制安装" : "引用安装";
}

function getSkillStatusLabels(skill: Skill) {
  return createStateList(
    skill.isInstalled ? "已安装" : "未安装",
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
  const [selectedDetail, setSelectedDetail] = useState<SkillDetail | null>(null);
  const [detailLoading, setDetailLoading] = useState(false);
  const [detailDraft, setDetailDraft] = useState("");
  const [detailSaving, setDetailSaving] = useState(false);
  const [loading, setLoading] = useState(true);
  const [busySkillId, setBusySkillId] = useState<string | null>(null);
  const [status, setStatus] = useState<StatusState | null>(null);
  const [operationProgress, setOperationProgress] = useState<OperationProgressState | null>(null);
  const [searchText, setSearchText] = useState("");
  const [currentTab, setCurrentTab] = useState<TabKey>("available");
  const [activeCategory, setActiveCategory] = useState("全部");
  const [activeSource, setActiveSource] = useState("全部");
  const [contextMenu, setContextMenu] = useState<ContextMenuState | null>(null);
  const [copyingComponentId, setCopyingComponentId] = useState<string | null>(null);
  const [inspectMode, setInspectMode] = useState(false);
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
    const syncInstalledState = () => {
      if (!busySkillId) {
        void refreshMarketplace(false, { background: true });
      }
    };

    const timer = window.setInterval(syncInstalledState, 15000);
    window.addEventListener("focus", syncInstalledState);

    return () => {
      window.clearInterval(timer);
      window.removeEventListener("focus", syncInstalledState);
    };
  }, [busySkillId]);

  useEffect(() => {
    let debounceTimer: number | null = null;
    let unlisten: (() => void) | null = null;

    void listen<string>("skill-storage-changed", () => {
      if (busySkillId) {
        return;
      }

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
  }, [busySkillId]);

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

  const filteredSkills = useMemo(() => {
    return skills.filter((skill) => {
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
  }, [skills, settingsDraft, deferredSearch, activeCategory, activeSource]);

  const installedFilteredSkills = useMemo(
    () => filteredSkills.filter((skill) => Boolean(skill.isInstalled)),
    [filteredSkills],
  );

  const visibleSkills = currentTab === "installed" ? installedFilteredSkills : filteredSkills;

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
    if (!selectedSkill || surface === "settings") {
      setSelectedDetail(null);
      setDetailDraft("");
      return;
    }

    let cancelled = false;
    setDetailLoading(true);
    void getSkillDetail(selectedSkill)
      .then((detail) => {
        if (!cancelled) {
          setSelectedDetail(detail);
        }
      })
      .catch((error) => {
        if (!cancelled) {
          setSelectedDetail(null);
          setStatus({
            tone: "error",
            text: error instanceof Error ? error.message : String(error),
          });
        }
      })
      .finally(() => {
        if (!cancelled) {
          setDetailLoading(false);
        }
      });

    return () => {
      cancelled = true;
    };
  }, [selectedSkill, surface]);

  useEffect(() => {
    setDetailDraft(selectedDetail?.markdown ?? "");
  }, [selectedDetail]);

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

  const availableCount = filteredSkills.length;
  const installedTabCount = installedFilteredSkills.length;
  const settingsChanged =
    JSON.stringify(settingsDraft) !== JSON.stringify(payload?.settings ?? EMPTY_SETTINGS);
  const currentSurfaceLabel = getSurfaceLabel(surface);
  const selectedSkillSourceName = selectedSkill
    ? getSourceDisplayName(selectedSkill.source, sources)
    : "-";
  const detailIsEditable = Boolean(selectedDetail?.localPath && selectedSkill?.isInstalled);
  const detailDirty = detailDraft !== (selectedDetail?.markdown ?? "");
  const selectedSkillContext = selectedSkill
    ? buildSkillContext(selectedSkill, settingsDraft)
    : undefined;
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
    activeCategory === "高赞" && activeSource !== "全部"
      ? sourceStatusMap.get(activeSource)
      : undefined;
  const runtimeStatusText = getRuntimeStatusText(status, payload);
  const listEmptyText =
    currentTab === "installed"
      ? "暂无已安装技能"
      : activeSourceStatus?.status === "error"
        ? `来源 ${activeSourceStatus.displayName} 加载失败${activeSourceStatus.error ? `：${activeSourceStatus.error}` : "。"}`
        : activeSourceStatus?.status === "empty"
          ? `来源 ${activeSourceStatus.displayName} 当前没有可显示技能。`
          : "未发现匹配的技能";

  async function runSkillAction(skill: Skill, action: SkillAction) {
    const isMutatingAction =
      action === "install" ||
      action === "update" ||
      action === "restore" ||
      action === "uninstall";

    if (isMutatingAction) {
      setBusySkillId(skill.id);
      setStatus({
        tone: "info",
        text:
          action === "install"
            ? `正在安装 ${skill.name}...`
            : action === "update"
              ? `正在更新 ${skill.name}...`
              : action === "restore"
                ? `正在恢复 ${skill.name} 的官方版本...`
                : `正在删除 ${skill.name}...`,
      });
    }

    try {
      if (action === "install") {
        const result = await installSkill(skill);
        setStatus({
          tone: result.warning ? "warning" : "success",
          text: result.warning ? `${result.message}\n${result.warning}` : result.message,
        });
        await refreshMarketplace(true);
      } else if (action === "update") {
        const result = await updateSkill(skill);
        setStatus({
          tone: result.warning ? "warning" : "success",
          text: result.warning ? `${result.message}\n${result.warning}` : result.message,
        });
        await refreshMarketplace(true);
      } else if (action === "restore") {
        const confirmed = await confirmDanger(
          `确定恢复 "${skill.name}" 的官方版本吗？本地修改会被覆盖。`,
        );
        if (!confirmed) {
          setStatus(null);
          return;
        }
        const result = await restoreSkill(skill);
        setStatus({
          tone: result.warning ? "warning" : "success",
          text: result.warning ? `${result.message}\n${result.warning}` : result.message,
        });
        await refreshMarketplace(true);
      } else if (action === "uninstall") {
        const confirmed = await confirmDanger(`确定删除 "${skill.name}" 吗？`);
        if (!confirmed) {
          setStatus(null);
          return;
        }
        const result = await uninstallSkill(skill.id);
        setStatus({
          tone: result.warning ? "warning" : "success",
          text: result.warning ? `${result.message}\n${result.warning}` : result.message,
        });
        await refreshMarketplace(true);
      } else if (action === "openRepo") {
        if (skill.repoLink) {
          await openExternalUrl(skill.repoLink);
        }
      } else if (action === "openDir") {
        if (!skill.actualPath) {
          throw new Error("该技能当前未安装，无法打开目录。");
        }
        await openLocalPath(skill.actualPath);
      } else if (action === "openReadme") {
        if (!selectedDetail?.localPath) {
          throw new Error("未找到本地 SKILL.md。");
        }
        await openLocalPath(selectedDetail.localPath);
      }
    } catch (error) {
      setStatus({
        tone: "error",
        text: error instanceof Error ? error.message : String(error),
      });
    } finally {
      if (isMutatingAction) {
        setBusySkillId(null);
      }
    }
  }

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

  async function handleSaveLocalReadme() {
    if (!selectedSkill || !detailIsEditable) {
      return;
    }

    setDetailSaving(true);
    try {
      const result = await saveSkillReadme(selectedSkill.id, detailDraft);
      setSelectedDetail((current) =>
        current ? { ...current, markdown: detailDraft } : current,
      );
      setStatus({
        tone: result.warning ? "warning" : "success",
        text: result.warning ? `${result.message}\n${result.warning}` : result.message,
      });
      await refreshMarketplace(false, { background: true });
    } catch (error) {
      setStatus({
        tone: "error",
        text: error instanceof Error ? error.message : String(error),
      });
    } finally {
      setDetailSaving(false);
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
        currentTab={currentTab}
        installedTabCount={installedTabCount}
        onExpandSidebar={expandSidebar}
        onSurfaceChange={setSurface}
        onTabChange={setCurrentTab}
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
                : "技能市场 使用旧版来源分类与桌面工作区来浏览和管理技能。",
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
                  : "技能市场 使用旧版来源分类与桌面工作区来浏览和管理技能。",
            })}
          >
            <strong>{currentSurfaceLabel}</strong>
            <span>
              {surface === "settings"
                ? "管理安装路径、翻译配置和界面显示行为。"
                : "使用旧版来源分类与桌面工作区来浏览和管理技能。"}
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
                placeholder="搜索技能..."
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
                  {...getComponentAttrs({
                    id: "settings-field-install-mode",
                    label: "安装策略设置项",
                    type: "设置项",
                    location: "设置 > 安装位置",
                    text: "安装策略",
                    context: { "设置项": "安装策略" },
                  })}
                >
                  <span>安装策略</span>
                  <select
                    value={settingsDraft.installMode}
                    onChange={(event) =>
                      setSettingsDraft((current) => ({
                        ...current,
                        installMode: event.target.value,
                      }))
                    }
                    {...getComponentAttrs({
                      id: "settings-input-install-mode",
                      label: "安装策略选择器",
                      type: "下拉选择",
                      location: "设置 > 安装位置",
                      value: getInstallModeLabel(settingsDraft.installMode),
                      context: { "设置项": "安装策略" },
                    })}
                  >
                    <option value="reference">引用安装（推荐）</option>
                    <option value="copy">复制安装</option>
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
              id: "market-workspace",
              label: "技能市场工作区",
              type: "工作区",
              location: "主工作区",
              context: { "当前页面": currentSurfaceLabel },
            })}
          >
            <div
              className="market-tabs"
              {...getComponentAttrs({
                id: "market-tabs",
                label: "技能市场标签栏",
                type: "标签栏",
                location: "主工作区顶部",
                context: { "当前标签": currentTab === "installed" ? "已安装" : "发现技能" },
              })}
            >
              <button
                type="button"
                className={currentTab === "available" ? "market-tab active" : "market-tab"}
                onClick={() => setCurrentTab("available")}
                {...getComponentAttrs({
                  id: "market-tab-available",
                  label: "发现技能标签",
                  type: "标签按钮",
                  location: "主工作区顶部",
                  text: "发现技能",
                  state: createStateList(currentTab === "available" ? "已选中" : undefined),
                })}
              >
                发现技能 <span className="market-tab-count">{availableCount}</span>
              </button>
              <button
                type="button"
                className={currentTab === "installed" ? "market-tab active" : "market-tab"}
                onClick={() => setCurrentTab("installed")}
                {...getComponentAttrs({
                  id: "market-tab-installed",
                  label: "已安装标签",
                  type: "标签按钮",
                  location: "主工作区顶部",
                  text: "已安装",
                  state: createStateList(currentTab === "installed" ? "已选中" : undefined),
                })}
              >
                已安装 <span className="market-tab-count">{installedTabCount}</span>
              </button>
            </div>

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

            {activeCategory === "高赞" ? (
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
                context: { "当前页面": currentSurfaceLabel, "当前标签": currentTab },
              })}
            >
              <section
                className="list-pane"
                {...getComponentAttrs({
                  id: "skills-list-pane",
                  label: "技能列表区",
                  type: "列表区域",
                  location: "主工作区 > 左侧列表区",
                  context: { "当前页面": currentSurfaceLabel, "当前标签": currentTab },
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
                      text: "正在加载技能市场数据...",
                      state: createStateList("加载中"),
                    })}
                  >
                    正在加载技能市场数据...
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
                            {skill.isInstalled ? <span className="row-badge success">已安装</span> : null}
                            {skill.hasUpdate ? <span className="row-badge warning">可更新</span> : null}
                            {skill.isLocalModified ? <span className="row-badge warning">已修改</span> : null}
                            {!skill.isInstalled && !skill.hasUpdate && !skill.isLocalModified ? (
                              <span className="row-badge">可安装</span>
                            ) : null}
                          </span>
                        </button>
                      );
                    })
                  : null}
              </div>
            </section>

            <aside
              className="detail-pane"
              {...getComponentAttrs({
                id: "skill-detail-pane",
                label: "技能详情区",
                type: "详情区域",
                location: "主工作区 > 右侧详情区",
                state: createStateList(selectedSkill ? undefined : "空状态"),
                context: selectedSkillContext,
              })}
            >
              {selectedSkill ? (
                <>
                  <div
                    className="detail-toolbar"
                    {...getComponentAttrs({
                      id: "skill-detail-toolbar",
                      label: "技能详情头部",
                      type: "标题区",
                      location: "主工作区 > 右侧详情区",
                      text: `${selectedSkill.name} ${selectedSkillSourceName} ${getVisibleCategory(selectedSkill, settingsDraft)}`,
                      context: { ...selectedSkillContext, "来源显示名": selectedSkillSourceName },
                    })}
                  >
                    <div
                      {...getComponentAttrs({
                        id: "skill-detail-summary",
                        label: "技能详情摘要",
                        type: "摘要区",
                        location: "主工作区 > 右侧详情区",
                        text: `${selectedSkill.name} ${selectedSkillSourceName} ${getVisibleCategory(selectedSkill, settingsDraft)}`,
                        context: { ...selectedSkillContext, "来源显示名": selectedSkillSourceName },
                      })}
                    >
                      <h2
                        {...getComponentAttrs({
                          id: "skill-detail-title",
                          label: "技能详情标题",
                          type: "标题文本",
                          location: "主工作区 > 右侧详情区",
                          text: selectedSkill.name,
                          context: selectedSkillContext,
                        })}
                      >
                        {selectedSkill.name}
                      </h2>
                      <p
                        {...getComponentAttrs({
                          id: "skill-detail-subtitle",
                          label: "技能详情副标题",
                          type: "说明文本",
                          location: "主工作区 > 右侧详情区",
                          text: `${selectedSkillSourceName} · ${getVisibleCategory(selectedSkill, settingsDraft)}`,
                          context: { ...selectedSkillContext, "来源显示名": selectedSkillSourceName },
                        })}
                      >
                        {selectedSkillSourceName} · {getVisibleCategory(selectedSkill, settingsDraft)}
                      </p>
                      <span
                        className="detail-copy-hint"
                        {...getComponentAttrs({
                          id: "skill-detail-copy-hint",
                          label: "组件检查提示",
                          type: "提示文本",
                          location: "主工作区 > 右侧详情区",
                          text: "按住 Alt 并右键可复制当前组件信息",
                        })}
                      >
                        按住 Alt 并右键可复制当前组件信息
                      </span>
                    </div>
                    <div
                      className="detail-toolbar-actions"
                      {...getComponentAttrs({
                        id: "skill-detail-toolbar-actions",
                        label: "技能详情头部操作区",
                        type: "操作区",
                        location: "主工作区 > 右侧详情区",
                        context: selectedSkillContext,
                      })}
                    >
                      {selectedSkill.repoLink ? (
                        <button
                          className="toolbar-button"
                          onClick={() => void runSkillAction(selectedSkill, "openRepo")}
                          {...getComponentAttrs({
                            id: "skill-detail-button-open-repo",
                            label: "打开仓库按钮",
                            type: "按钮",
                            location: "主工作区 > 右侧详情区",
                            text: "仓库",
                            context: selectedSkillContext,
                          })}
                        >
                          仓库
                        </button>
                      ) : null}
                      {selectedSkill.isInstalled ? (
                        <>
                          <button
                            className="toolbar-button"
                            onClick={() => void runSkillAction(selectedSkill, "openReadme")}
                            {...getComponentAttrs({
                              id: "skill-detail-button-open-readme",
                              label: "编辑 README 按钮",
                              type: "按钮",
                              location: "主工作区 > 右侧详情区",
                              text: "编辑 README",
                              context: selectedSkillContext,
                            })}
                          >
                            编辑 README
                          </button>
                          <button
                            className="toolbar-button"
                            onClick={() => void runSkillAction(selectedSkill, "openDir")}
                            {...getComponentAttrs({
                              id: "skill-detail-button-open-dir",
                              label: "打开目录按钮",
                              type: "按钮",
                              location: "主工作区 > 右侧详情区",
                              text: "打开目录",
                              context: selectedSkillContext,
                            })}
                          >
                            打开目录
                          </button>
                        </>
                      ) : null}
                    </div>
                  </div>

                  <section
                    className="detail-section"
                    {...getComponentAttrs({
                      id: "skill-detail-overview",
                      label: "技能概要区",
                      type: "详情分组",
                      location: "主工作区 > 右侧详情区",
                      text: getVisibleDescription(selectedSkill, settingsDraft),
                      context: selectedSkillContext,
                    })}
                  >
                    <div
                      className="detail-metrics"
                      {...getComponentAttrs({
                        id: "skill-detail-metrics",
                        label: "技能状态指标区",
                        type: "指标区",
                        location: "主工作区 > 右侧详情区",
                        context: selectedSkillContext,
                      })}
                    >
                      <div
                        {...getComponentAttrs({
                          id: "skill-detail-metric-installed-version",
                          label: "已安装版本指标",
                          type: "指标卡片",
                          location: "主工作区 > 右侧详情区",
                          text: selectedSkill.installedVersion || "未安装",
                          context: selectedSkillContext,
                        })}
                      >
                        <span>已安装版本</span>
                        <strong>{selectedSkill.installedVersion || "未安装"}</strong>
                      </div>
                      <div
                        {...getComponentAttrs({
                          id: "skill-detail-metric-latest-version",
                          label: "最新版本指标",
                          type: "指标卡片",
                          location: "主工作区 > 右侧详情区",
                          text: selectedSkill.commitSha || "未获取",
                          context: selectedSkillContext,
                        })}
                      >
                        <span>最新版本</span>
                        <strong>{selectedSkill.commitSha || "未获取"}</strong>
                      </div>
                      <div
                        {...getComponentAttrs({
                          id: "skill-detail-metric-local-status",
                          label: "本地状态指标",
                          type: "指标卡片",
                          location: "主工作区 > 右侧详情区",
                          text: selectedSkill.isLocalModified ? "已修改" : "干净",
                          context: selectedSkillContext,
                        })}
                      >
                        <span>本地状态</span>
                        <strong>{selectedSkill.isLocalModified ? "已修改" : "干净"}</strong>
                      </div>
                      <div
                        {...getComponentAttrs({
                          id: "skill-detail-metric-install-mode",
                          label: "安装模式指标",
                          type: "指标卡片",
                          location: "主工作区 > 右侧详情区",
                          text: getInstallModeLabel(selectedSkill.installMode),
                          context: selectedSkillContext,
                        })}
                      >
                        <span>安装模式</span>
                        <strong>{getInstallModeLabel(selectedSkill.installMode)}</strong>
                      </div>
                      <div
                        {...getComponentAttrs({
                          id: "skill-detail-metric-install-path",
                          label: "安装目录指标",
                          type: "指标卡片",
                          location: "主工作区 > 右侧详情区",
                          text: selectedSkill.installPath || "未解析",
                          context: selectedSkillContext,
                        })}
                      >
                        <span>安装目录</span>
                        <strong>{selectedSkill.installPath || "未解析"}</strong>
                      </div>
                      <div
                        {...getComponentAttrs({
                          id: "skill-detail-metric-actual-path",
                          label: "实际存储目录指标",
                          type: "指标卡片",
                          location: "主工作区 > 右侧详情区",
                          text: selectedSkill.actualPath || selectedSkill.installPath || "未解析",
                          context: selectedSkillContext,
                        })}
                      >
                        <span>实际目录</span>
                        <strong>{selectedSkill.actualPath || selectedSkill.installPath || "未解析"}</strong>
                      </div>
                    </div>
                    <p
                      {...getComponentAttrs({
                        id: "skill-detail-description",
                        label: "技能描述文本",
                        type: "说明文本",
                        location: "主工作区 > 右侧详情区",
                        text: getVisibleDescription(selectedSkill, settingsDraft),
                        context: selectedSkillContext,
                      })}
                    >
                      {getVisibleDescription(selectedSkill, settingsDraft)}
                    </p>
                    <div
                      className="detail-path-list"
                      {...getComponentAttrs({
                        id: "skill-detail-path-list",
                        label: "安装路径说明",
                        type: "说明列表",
                        location: "主工作区 > 右侧详情区",
                        text: `${selectedSkill.installPath || "未解析"} ${selectedSkill.actualPath || selectedSkill.installPath || "未解析"}`,
                        context: selectedSkillContext,
                      })}
                    >
                      <span>引用入口：{selectedSkill.installPath || "未解析"}</span>
                      <span>实际目录：{selectedSkill.actualPath || selectedSkill.installPath || "未解析"}</span>
                    </div>
                  </section>

                  <section
                    className="detail-section"
                    {...getComponentAttrs({
                      id: "skill-detail-actions",
                      label: "技能操作区",
                      type: "操作区",
                      location: "主工作区 > 右侧详情区",
                      context: selectedSkillContext,
                    })}
                  >
                    <div className="action-group">
                      {!selectedSkill.isInstalled ? (
                        <button
                          className="toolbar-button primary"
                          disabled={busySkillId === selectedSkill.id}
                          onClick={() => void runSkillAction(selectedSkill, "install")}
                          {...getComponentAttrs({
                            id: "skill-detail-button-install",
                            label: "安装按钮",
                            type: "按钮",
                            location: "主工作区 > 右侧详情区",
                            text: "安装",
                            state: createStateList(
                              busySkillId === selectedSkill.id ? "处理中" : undefined,
                            ),
                            context: selectedSkillContext,
                          })}
                        >
                          安装
                        </button>
                      ) : null}
                      {selectedSkill.hasUpdate && !selectedSkill.isLocalModified ? (
                        <button
                          className="toolbar-button primary"
                          disabled={busySkillId === selectedSkill.id}
                          onClick={() => void runSkillAction(selectedSkill, "update")}
                          {...getComponentAttrs({
                            id: "skill-detail-button-update",
                            label: "更新按钮",
                            type: "按钮",
                            location: "主工作区 > 右侧详情区",
                            text: "更新",
                            state: createStateList(
                              busySkillId === selectedSkill.id ? "处理中" : undefined,
                            ),
                            context: selectedSkillContext,
                          })}
                        >
                          更新
                        </button>
                      ) : null}
                      {selectedSkill.isLocalModified ? (
                        <button
                          className="toolbar-button warning"
                          disabled={busySkillId === selectedSkill.id}
                          onClick={() => void runSkillAction(selectedSkill, "restore")}
                          {...getComponentAttrs({
                            id: "skill-detail-button-restore",
                            label: "恢复官方版按钮",
                            type: "按钮",
                            location: "主工作区 > 右侧详情区",
                            text: "恢复官方版",
                            state: createStateList(
                              busySkillId === selectedSkill.id ? "处理中" : undefined,
                            ),
                            context: selectedSkillContext,
                          })}
                        >
                          恢复官方版
                        </button>
                      ) : null}
                      {selectedSkill.isInstalled ? (
                        <button
                          className="toolbar-button danger"
                          disabled={busySkillId === selectedSkill.id}
                          onClick={() => void runSkillAction(selectedSkill, "uninstall")}
                          {...getComponentAttrs({
                            id: "skill-detail-button-uninstall",
                            label: "删除按钮",
                            type: "按钮",
                            location: "主工作区 > 右侧详情区",
                            text: "删除",
                            state: createStateList(
                              busySkillId === selectedSkill.id ? "处理中" : undefined,
                            ),
                            context: selectedSkillContext,
                          })}
                        >
                          删除
                        </button>
                      ) : null}
                    </div>
                  </section>

                  <section
                    className="detail-section markdown-section"
                    {...getComponentAttrs({
                      id: "skill-detail-markdown",
                      label: "SKILL.md 预览区",
                      type: "文档预览区",
                      location: "主工作区 > 右侧详情区",
                      state: createStateList(detailLoading ? "加载中" : "已加载"),
                      context: selectedSkillContext,
                    })}
                  >
                    <div
                      className="section-head"
                      {...getComponentAttrs({
                        id: "skill-detail-markdown-header",
                        label: "SKILL.md 标题栏",
                        type: "标题区",
                        location: "主工作区 > 右侧详情区",
                        text: "SKILL.md",
                      })}
                    >
                      <strong>SKILL.md</strong>
                      <div className="detail-markdown-actions">
                        {detailIsEditable ? (
                          <button
                            type="button"
                            className="toolbar-button primary"
                            disabled={!detailDirty || detailSaving}
                            onClick={() => void handleSaveLocalReadme()}
                            {...getComponentAttrs({
                              id: "skill-detail-button-save-readme",
                              label: "保存本地 README 按钮",
                              type: "按钮",
                              location: "主工作区 > 右侧详情区",
                              text: detailSaving ? "保存中" : "保存",
                              state: createStateList(
                                detailDirty ? "有未保存修改" : "无需保存",
                                detailSaving ? "处理中" : undefined,
                              ),
                            })}
                          >
                            {detailSaving ? "保存中…" : "保存"}
                          </button>
                        ) : null}
                        {detailLoading ? <span>加载中…</span> : null}
                      </div>
                    </div>
                    {detailIsEditable ? (
                      <textarea
                        className="markdown-editor"
                        value={detailDraft}
                        onChange={(event) => setDetailDraft(event.target.value)}
                        {...getComponentAttrs({
                          id: "skill-detail-markdown-editor",
                          label: "SKILL.md 编辑器",
                          type: "多行输入框",
                          location: "主工作区 > 右侧详情区",
                          value: detailDraft || "空白",
                          state: createStateList(
                            detailDirty ? "已修改" : "未修改",
                            detailSaving ? "处理中" : undefined,
                          ),
                          context: selectedSkillContext,
                        })}
                      />
                    ) : (
                      <pre
                        {...getComponentAttrs({
                          id: "skill-detail-markdown-body",
                          label: "SKILL.md 内容区",
                          type: "文档内容",
                          location: "主工作区 > 右侧详情区",
                          text: selectedDetail?.markdown ? "已加载文档内容" : "暂无详情内容。",
                          state: createStateList(detailLoading ? "加载中" : "已显示"),
                          context: selectedSkillContext,
                        })}
                      >
                        {selectedDetail?.markdown || "暂无详情内容。"}
                      </pre>
                    )}
                  </section>
                </>
              ) : (
                <div
                  className="empty-state"
                  {...getComponentAttrs({
                    id: "skill-detail-empty",
                    label: "技能详情空状态",
                    type: "空状态",
                    location: "主工作区 > 右侧详情区",
                    text: "请选择一个技能查看详情和操作。",
                    state: createStateList("空状态"),
                  })}
                >
                  请选择一个技能查看详情和操作。
                </div>
              )}
            </aside>
          </section>
          </section>
        )}

        <StatusBar
          availableCount={availableCount}
          currentTab={currentTab}
          installedTabCount={installedTabCount}
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
