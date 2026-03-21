export type SurfaceKey = "market" | "settings";
export type TabKey = "available" | "installed";
export type StatusTone = "info" | "success" | "warning" | "error";

export interface StatusState {
  tone: StatusTone;
  text: string;
}

export interface OperationProgressState {
  skillId: string;
  skillName: string;
  operation: string;
  message: string;
  current: number;
  total: number;
  finished: boolean;
}
