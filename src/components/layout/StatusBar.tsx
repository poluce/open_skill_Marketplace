import type { SurfaceKey, TabKey, StatusState } from "../../app/types";
import { createStateList, getComponentAttrs } from "../../features/inspect";

interface StatusBarProps {
  availableCount: number;
  currentTab: TabKey;
  payload: {
    fromCache?: boolean;
    resolvedInstallPath?: string;
    resolvedStoragePath?: string;
  } | null;
  runtimeStatusText: string;
  status: StatusState | null;
  surface: SurfaceKey;
  installedTabCount: number;
}

export function StatusBar({
  availableCount,
  currentTab,
  payload,
  runtimeStatusText,
  status,
  surface,
  installedTabCount,
}: StatusBarProps) {
  return (
    <footer
      className="status-bar"
      {...getComponentAttrs({
        id: "status-bar",
        label: "底部状态栏",
        type: "状态栏",
        location: "底部状态栏",
        context: {
          "当前页面": surface === "settings" ? "应用设置" : "技能市场",
        },
      })}
    >
      <span
        className={status ? `status-runtime ${status.tone}` : "status-runtime"}
        {...getComponentAttrs({
          id: "status-bar-runtime",
          label: "运行状态",
          type: "状态项",
          location: "底部状态栏",
          text: runtimeStatusText,
          state: createStateList(status ? `状态：${status.tone}` : "状态：info"),
        })}
      >
        {runtimeStatusText}
      </span>
      <span
        {...getComponentAttrs({
          id: "status-bar-install-path",
          label: "安装路径状态",
          type: "状态项",
          location: "底部状态栏",
          text: payload?.resolvedInstallPath || "尚未解析安装路径。",
        })}
      >
        {payload?.resolvedInstallPath || "尚未解析安装路径。"}
      </span>
      <span
        {...getComponentAttrs({
          id: "status-bar-cache-state",
          label: "缓存状态",
          type: "状态项",
          location: "底部状态栏",
          text: payload?.fromCache ? "缓存" : "实时",
        })}
      >
        {payload?.fromCache ? "缓存" : "实时"}
      </span>
      <span
        {...getComponentAttrs({
          id: "status-bar-surface-state",
          label: "页面状态",
          type: "状态项",
          location: "底部状态栏",
          text:
            surface === "settings"
              ? "偏好设置"
              : currentTab === "installed"
                ? `已安装 ${installedTabCount} 项`
                : `发现技能 ${availableCount} 项`,
        })}
      >
        {surface === "settings"
          ? "偏好设置"
          : currentTab === "installed"
            ? `已安装 ${installedTabCount} 项`
            : `发现技能 ${availableCount} 项`}
      </span>
      <span
        {...getComponentAttrs({
          id: "status-bar-storage-path",
          label: "实际存储路径状态",
          type: "状态项",
          location: "底部状态栏",
          text: payload?.resolvedStoragePath || "尚未解析实际存储目录。",
        })}
      >
        {payload?.resolvedStoragePath || "尚未解析实际存储目录。"}
      </span>
      <span
        {...getComponentAttrs({
          id: "status-bar-inspect-hint",
          label: "组件检查提示",
          type: "状态项",
          location: "底部状态栏",
          text: "按住 Alt + 右键复制组件信息",
        })}
      >
        按住 Alt + 右键复制组件信息
      </span>
    </footer>
  );
}
