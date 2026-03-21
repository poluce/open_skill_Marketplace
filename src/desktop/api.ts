import { invoke } from "@tauri-apps/api/core";
import type {
  AppSettings,
  MarketplacePayload,
  OperationResult,
  Skill,
  SkillDetail,
} from "./types";

export function loadMarketplace(forceRefresh = false) {
  return invoke<MarketplacePayload>("load_marketplace", { forceRefresh });
}

export function saveSettings(settings: AppSettings) {
  return invoke<AppSettings>("save_settings", { settings });
}

export function installSkill(skill: Skill) {
  return invoke<OperationResult>("install_skill", { skill });
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

export function getSkillDetail(skill: Skill) {
  return invoke<SkillDetail>("get_skill_detail", { skill });
}

export function saveSkillReadme(skillId: string, markdown: string) {
  return invoke<OperationResult>("save_skill_readme", { skillId, markdown });
}
