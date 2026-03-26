import { invoke } from "@tauri-apps/api/core";
import type {
  AppSettings,
  InstallDownloadedSkillRequest,
  MarketplacePayload,
  OperationResult,
  Skill,
  SkillDetail,
  UninstallSkillTargetRequest,
} from "./types";

export function loadMarketplace(forceRefresh = false) {
  return invoke<MarketplacePayload>("load_marketplace", { forceRefresh });
}

export function saveSettings(settings: AppSettings) {
  return invoke<AppSettings>("save_settings", { settings });
}

export function downloadSkill(skill: Skill) {
  return invoke<OperationResult>("download_skill", { skill });
}

export function installSkill(skill: Skill) {
  return invoke<OperationResult>("install_skill", { skill });
}

export function installDownloadedSkill(request: InstallDownloadedSkillRequest) {
  return invoke<OperationResult>("install_downloaded_skill", { request });
}

export function updateSkill(skill: Skill) {
  return invoke<OperationResult>("update_skill", { skill });
}

export function restoreSkill(skill: Skill) {
  return invoke<OperationResult>("restore_skill", { skill });
}

export function uninstallSkill(skillId: string) {
  return invoke<OperationResult>("uninstall_skill", { skillId });
}

export function uninstallSkillTarget(request: UninstallSkillTargetRequest) {
  return invoke<OperationResult>("uninstall_skill_target", { request });
}

export function deleteDownloadedSkill(skillId: string) {
  return invoke<OperationResult>("delete_downloaded_skill", { skillId });
}

export function getSkillDetail(skill: Skill) {
  return invoke<SkillDetail>("get_skill_detail", { skill });
}

export function saveSkillReadme(skillId: string, markdown: string) {
  return invoke<OperationResult>("save_skill_readme", { skillId, markdown });
}
