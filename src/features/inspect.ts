import type { HTMLAttributes } from "react";

export type ComponentContextValue = string | number | boolean | null | undefined;

export interface ComponentSnapshot {
  id: string;
  label: string;
  type: string;
  location: string;
  surface: string;
  path: string;
  visibleText: string;
  state: string;
  relatedContext: string;
}

export interface ContextMenuState {
  x: number;
  y: number;
  component: ComponentSnapshot;
}

interface InspectableComponentConfig {
  id: string;
  label: string;
  type: string;
  location?: string;
  text?: string;
  value?: string;
  state?: string[];
  context?: Record<string, ComponentContextValue>;
}

function normalizeInlineText(value?: string | null, fallback = "无明显文本") {
  const normalized = (value ?? "").replace(/\s+/g, " ").trim();
  if (!normalized) {
    return fallback;
  }

  return normalized.length > 180 ? `${normalized.slice(0, 177)}...` : normalized;
}

export function createStateList(...states: Array<string | null | undefined | false>) {
  return states.filter((state): state is string => Boolean(state));
}

function formatContextValue(value: ComponentContextValue) {
  if (typeof value === "boolean") {
    return value ? "是" : "否";
  }

  return String(value);
}

function serializeContext(context?: Record<string, ComponentContextValue>) {
  if (!context) {
    return undefined;
  }

  const entries = Object.entries(context)
    .filter(([, value]) => value !== undefined && value !== null && value !== "")
    .map(([key, value]) => [key, formatContextValue(value)]);
  if (!entries.length) {
    return undefined;
  }

  return JSON.stringify(Object.fromEntries(entries));
}

export function getComponentAttrs(
  config: InspectableComponentConfig,
): HTMLAttributes<HTMLElement> {
  const attrs: Record<string, string | undefined> = {
    "data-component-id": config.id,
    "data-component-label": config.label,
    "data-component-type": config.type,
    "data-component-location": config.location,
  };

  if (config.text) {
    attrs["data-component-text"] = normalizeInlineText(config.text);
  }

  if (config.value !== undefined) {
    attrs["data-component-value"] = normalizeInlineText(config.value, "未设置");
  }

  if (config.state?.length) {
    attrs["data-component-state"] = createStateList(...config.state).join("；");
  }

  const serializedContext = serializeContext(config.context);
  if (serializedContext) {
    attrs["data-component-context"] = serializedContext;
  }

  return attrs;
}

function parseContextData(value?: string) {
  if (!value) {
    return {};
  }

  try {
    const parsed = JSON.parse(value) as Record<string, string>;
    return parsed;
  } catch {
    return {};
  }
}

function collectComponentChain(element: HTMLElement) {
  const chain: HTMLElement[] = [];
  let current = element.closest("[data-component-id]") as HTMLElement | null;

  while (current) {
    chain.push(current);
    current = current.parentElement?.closest("[data-component-id]") as HTMLElement | null;
  }

  return chain;
}

function extractVisibleText(element: HTMLElement) {
  const textFromAttr = element.dataset.componentText;
  if (textFromAttr) {
    return textFromAttr;
  }

  const inputValue = element.dataset.componentValue;
  if (inputValue) {
    return inputValue;
  }

  const text = normalizeInlineText(element.innerText, "无明显文本");
  return text;
}

function extractComponentState(element: HTMLElement) {
  const directState = element.dataset.componentState;
  if (directState) {
    return directState;
  }

  const stateParts = createStateList(
    element.getAttribute("aria-disabled") === "true" ? "禁用" : undefined,
    element.getAttribute("aria-expanded") === "true" ? "已展开" : undefined,
    element.getAttribute("aria-expanded") === "false" ? "已收起" : undefined,
    element.getAttribute("aria-selected") === "true" ? "已选中" : undefined,
    element.getAttribute("aria-checked") === "true" ? "已勾选" : undefined,
    element.getAttribute("aria-pressed") === "true" ? "已按下" : undefined,
  );

  return stateParts.length ? stateParts.join("；") : "无特殊状态";
}

function formatMergedContext(chain: HTMLElement[]) {
  const merged = Object.assign(
    {},
    ...chain
      .map((element) => parseContextData(element.dataset.componentContext))
      .reverse(),
  );

  const entries = Object.entries(merged);
  if (!entries.length) {
    return "无";
  }

  return entries.map(([key, value]) => `${key}: ${value}`).join("；");
}

export function resolveComponentSnapshot(target: EventTarget | null, surface: string) {
  if (!(target instanceof HTMLElement)) {
    return null;
  }

  const componentElement = target.closest("[data-component-id]") as HTMLElement | null;
  if (!componentElement) {
    return null;
  }

  const chain = collectComponentChain(componentElement);
  const path = chain
    .slice()
    .reverse()
    .map((element) => element.dataset.componentLabel || element.dataset.componentId || "未命名组件")
    .join(" > ");

  return {
    id: componentElement.dataset.componentId || "unknown-component",
    label: componentElement.dataset.componentLabel || "未命名组件",
    type: componentElement.dataset.componentType || "未知类型",
    location: componentElement.dataset.componentLocation || "未知位置",
    surface,
    path,
    visibleText: extractVisibleText(componentElement),
    state: extractComponentState(componentElement),
    relatedContext: formatMergedContext(chain),
  } satisfies ComponentSnapshot;
}

export function buildComponentClipboardText(component: ComponentSnapshot) {
  return [
    `页面：${component.surface}`,
    `组件名称：${component.label}`,
    `组件标识：${component.id}`,
    `类型：${component.type}`,
    `位置：${component.location}`,
    `层级路径：${component.path}`,
    `显示文本：${component.visibleText}`,
    `当前状态：${component.state}`,
    `关联对象：${component.relatedContext}`,
    "我的需求/问题：",
  ].join("\n");
}

export function clampContextMenuPosition(x: number, y: number) {
  if (typeof window === "undefined") {
    return { x, y };
  }

  const menuWidth = 260;
  const menuHeight = 52;
  const padding = 12;

  return {
    x: Math.max(padding, Math.min(x, window.innerWidth - menuWidth - padding)),
    y: Math.max(padding, Math.min(y, window.innerHeight - menuHeight - padding)),
  };
}
