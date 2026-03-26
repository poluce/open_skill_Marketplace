export type SurfaceKey = "market" | "install" | "settings";
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
