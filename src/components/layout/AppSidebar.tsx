import type { SurfaceKey, TabKey } from "../../app/types";
import { createStateList, getComponentAttrs } from "../../features/inspect";

interface AppSidebarProps {
  currentTab: TabKey;
  installedTabCount: number;
  onExpandSidebar: () => void;
  onSurfaceChange: (surface: SurfaceKey) => void;
  onTabChange: (tab: TabKey) => void;
  onToggleSidebar: () => void;
  sidebarCollapsed: boolean;
  surface: SurfaceKey;
}

export function AppSidebar({
  currentTab,
  installedTabCount,
  onExpandSidebar,
  onSurfaceChange,
  onTabChange,
  onToggleSidebar,
  sidebarCollapsed,
  surface,
}: AppSidebarProps) {
  return (
    <aside
      className="desktop-sidebar"
      {...getComponentAttrs({
        id: "sidebar",
        label: "左侧导航栏",
        type: "导航区域",
        location: "左侧导航",
        text: "技能市场 桌面工作区",
        state: createStateList(sidebarCollapsed ? "已收起" : "已展开"),
      })}
    >
      <div
        className="sidebar-brand"
        {...getComponentAttrs({
          id: "sidebar-brand",
          label: "应用品牌区",
          type: "品牌区",
          location: "左侧导航",
          text: "技能市场 桌面工作区",
          state: createStateList(sidebarCollapsed ? "已收起" : "已展开"),
        })}
      >
        <div className="brand-mark">S</div>
        <div className="sidebar-brand-copy">
          <strong>技能市场</strong>
          <p>桌面工作区</p>
        </div>
        <button
          type="button"
          className="sidebar-toggle-button"
          aria-label={sidebarCollapsed ? "展开侧边栏" : "收起侧边栏"}
          title={sidebarCollapsed ? "展开侧边栏" : "收起侧边栏"}
          onClick={onToggleSidebar}
          {...getComponentAttrs({
            id: "sidebar-toggle",
            label: "侧边栏切换按钮",
            type: "按钮",
            location: "左侧导航",
            text: sidebarCollapsed ? "展开侧边栏" : "收起侧边栏",
            state: createStateList(sidebarCollapsed ? "当前为收缩态" : "当前为展开态"),
          })}
        >
          {sidebarCollapsed ? ">" : "<"}
        </button>
      </div>

      <nav
        className="sidebar-nav"
        {...getComponentAttrs({
          id: "sidebar-nav",
          label: "主导航分组",
          type: "导航组",
          location: "左侧导航",
        })}
      >
        <button
          type="button"
          className={`nav-item ${surface === "market" && currentTab === "available" ? "active" : ""}`}
          onClick={() => {
            onSurfaceChange("market");
            onTabChange("available");
          }}
          title={sidebarCollapsed ? "技能市场" : undefined}
          {...getComponentAttrs({
            id: "nav-market-available",
            label: "技能市场导航按钮",
            type: "导航按钮",
            location: "左侧导航",
            text: "技能市场",
            state: createStateList(
              surface === "market" && currentTab === "available" ? "已激活" : undefined,
            ),
          })}
        >
          <span className="nav-label">技能市场</span>
        </button>

        <button
          type="button"
          className={`nav-item ${surface === "market" && currentTab === "installed" ? "active" : ""}`}
          onClick={() => {
            onSurfaceChange("market");
            onTabChange("installed");
          }}
          title={sidebarCollapsed ? "已安装" : undefined}
          {...getComponentAttrs({
            id: "nav-market-installed",
            label: "已安装导航按钮",
            type: "导航按钮",
            location: "左侧导航",
            text: "已安装",
            state: createStateList(
              surface === "market" && currentTab === "installed" ? "已激活" : undefined,
            ),
            context: { "已安装数量": installedTabCount },
          })}
        >
          <span className="nav-label">已安装</span>
          <strong>{installedTabCount}</strong>
        </button>
      </nav>

      {sidebarCollapsed ? (
        <button
          type="button"
          className="sidebar-rail-hit-area"
          onMouseEnter={onExpandSidebar}
          onFocus={onExpandSidebar}
          {...getComponentAttrs({
            id: "sidebar-rail-expand",
            label: "侧边栏边缘展开区",
            type: "命中区域",
            location: "左侧导航外侧边缘",
            text: "展开侧边栏",
          })}
        />
      ) : null}

      <div
        className="sidebar-footer"
        {...getComponentAttrs({
          id: "sidebar-footer",
          label: "导航底部区域",
          type: "导航组",
          location: "左侧导航底部",
        })}
      >
        <button
          type="button"
          className={`nav-item ${surface === "settings" ? "active" : ""}`}
          onClick={() => onSurfaceChange("settings")}
          title={sidebarCollapsed ? "设置" : undefined}
          {...getComponentAttrs({
            id: "nav-settings",
            label: "设置导航按钮",
            type: "导航按钮",
            location: "左侧导航底部",
            text: "设置",
            state: createStateList(surface === "settings" ? "已激活" : undefined),
          })}
        >
          <span className="nav-label">设置</span>
        </button>
      </div>
    </aside>
  );
}
