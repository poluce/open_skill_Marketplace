import type { ContextMenuState } from "../../features/inspect";

interface InspectContextMenuProps {
  contextMenu: ContextMenuState | null;
  copyingComponentId: string | null;
  position: { x: number; y: number } | null;
  onCopy: (component: ContextMenuState["component"]) => void;
}

export function InspectContextMenu({
  contextMenu,
  copyingComponentId,
  position,
  onCopy,
}: InspectContextMenuProps) {
  if (!contextMenu || !position) {
    return null;
  }

  return (
    <div
      className="context-menu"
      role="menu"
      style={{
        left: `${position.x}px`,
        top: `${position.y}px`,
      }}
      onClick={(event) => event.stopPropagation()}
      onContextMenu={(event) => event.preventDefault()}
    >
      <button
        type="button"
        className="context-menu-item"
        disabled={copyingComponentId === contextMenu.component.id}
        onClick={() => void onCopy(contextMenu.component)}
      >
        {copyingComponentId === contextMenu.component.id
          ? "正在复制…"
          : "复制组件定位信息"}
      </button>
    </div>
  );
}
