use std::collections::{BTreeMap, HashMap, HashSet};
use std::fs;
use std::io::{self, Read, Write};
use std::path::{Path, PathBuf};
use std::process::{Command, Stdio};
use std::sync::Mutex;
use std::time::{Duration, SystemTime, UNIX_EPOCH};

use notify::{recommended_watcher, RecommendedWatcher, RecursiveMode, Watcher};
use reqwest::header::{HeaderMap, HeaderValue, ACCEPT, AUTHORIZATION, USER_AGENT};
use reqwest::Client;
use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};
use tauri::{AppHandle, Emitter, State};
use tauri_plugin_store::StoreExt;
use walkdir::WalkDir;

const APP_DIR_NAME: &str = ".skill-marketplace";
const LEGACY_SETTINGS_FILE: &str = "desktop-settings.json";
const CACHE_FILE: &str = "marketplace-cache.json";
const LEGACY_CACHE_FILE: &str = "marketplace_cache.json";
const TRANSLATION_CACHE_FILE: &str = "translations-cache.json";
const METADATA_FILE: &str = ".metadata.json";
const APP_STORE_FILE: &str = "app-state.json";
const SETTINGS_STORE_KEY: &str = "settings.app";
const CACHE_TTL_SECS: u64 = 60 * 60 * 24;
const CACHE_VERSION: u8 = 2;
const USER_AGENT_VALUE: &str = "SkillMarketplaceDesktop/0.2.0";
const SKILL_SOURCES_JSON: &str = include_str!("../../resources/skill-sources.json");
const DEEPSEEK_API_URL: &str = "https://api.deepseek.com/v1/chat/completions";
const TRANSLATION_BATCH_SIZE: usize = 10;
const STORAGE_CHANGED_EVENT: &str = "skill-storage-changed";
const OPERATION_PROGRESS_EVENT: &str = "skill-operation-progress";

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
enum InstallMode {
    Copy,
    Reference,
}

impl Default for InstallMode {
    fn default() -> Self {
        Self::Reference
    }
}

impl InstallMode {
    fn as_str(self) -> &'static str {
        match self {
            Self::Copy => "copy",
            Self::Reference => "reference",
        }
    }

    fn from_settings(value: &str) -> Self {
        match value {
            "copy" => Self::Copy,
            _ => Self::Reference,
        }
    }
}

#[derive(Default)]
pub struct WatchState {
    inner: Mutex<WatchRegistration>,
}

#[derive(Default)]
struct WatchRegistration {
    watchers: Vec<RecommendedWatcher>,
    watched_paths: Vec<PathBuf>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(default, rename_all = "camelCase")]
pub struct AppSettings {
    pub agent_type: String,
    pub install_scope: String,
    pub project_root: String,
    pub github_token: String,
    pub deepseek_api_key: String,
    pub language: String,
    pub show_ai_categories: bool,
    pub accent_color: String,
    pub install_mode: String,
    pub storage_root: String,
}

impl Default for AppSettings {
    fn default() -> Self {
        Self {
            agent_type: "gemini".to_string(),
            install_scope: "global".to_string(),
            project_root: String::new(),
            github_token: String::new(),
            deepseek_api_key: String::new(),
            language: String::new(),
            show_ai_categories: true,
            accent_color: "#1f7aec".to_string(),
            install_mode: InstallMode::default().as_str().to_string(),
            storage_root: String::new(),
        }
    }
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Skill {
    pub id: String,
    pub name: String,
    pub desc: String,
    pub category: String,
    pub icon: String,
    pub colors: [String; 2],
    pub is_featured: bool,
    pub repo_link: Option<String>,
    pub is_installed: Option<bool>,
    pub repo_owner: Option<String>,
    pub repo_name: Option<String>,
    pub skill_path: Option<String>,
    pub source: Option<String>,
    pub branch: Option<String>,
    pub translated_desc: Option<String>,
    pub ai_category: Option<String>,
    pub commit_sha: Option<String>,
    pub last_updated: Option<u64>,
    pub has_update: Option<bool>,
    pub installed_version: Option<String>,
    pub is_local_modified: Option<bool>,
    pub install_mode: Option<String>,
    pub install_path: Option<String>,
    pub actual_path: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SkillDetail {
    pub markdown: String,
    pub source_url: String,
    pub local_path: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct MarketplacePayload {
    pub settings: AppSettings,
    pub source_configs: Vec<SkillSourceConfig>,
    pub source_statuses: Vec<SourceStatus>,
    pub skills: Vec<Skill>,
    pub resolved_install_path: String,
    pub resolved_storage_path: String,
    pub warning: Option<String>,
    pub from_cache: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct OperationResult {
    pub message: String,
    pub warning: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
struct SkillSourcesFile {
    sources: Vec<SkillSourceConfig>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SkillSourceConfig {
    pub id: String,
    pub display_name: String,
    pub owner: String,
    pub repo: String,
    pub branch: String,
    pub skills_path: SkillPathConfig,
    pub path_type: String,
    #[serde(default)]
    pub exclude_dirs: Vec<String>,
    pub icon: String,
    pub colors: [String; 2],
    pub icon_url: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(untagged)]
pub enum SkillPathConfig {
    One(String),
    Many(Vec<String>),
}

impl SkillPathConfig {
    fn values(&self) -> Vec<String> {
        match self {
            SkillPathConfig::One(value) => vec![value.clone()],
            SkillPathConfig::Many(values) => values.clone(),
        }
    }
}

fn build_source_signature(config: &SkillSourceConfig) -> String {
    let skills_path = config.skills_path.values().join("|");
    let exclude_dirs = config.exclude_dirs.join("|");
    format!(
        "{}:{}/{}/{}:{}:{}:{}",
        config.id,
        config.owner,
        config.repo,
        config.branch,
        config.path_type,
        skills_path,
        exclude_dirs
    )
}

fn current_source_signatures(source_configs: &[SkillSourceConfig]) -> Vec<String> {
    source_configs.iter().map(build_source_signature).collect()
}

#[derive(Debug, Clone, Serialize, Deserialize)]
struct CacheFile {
    #[serde(default)]
    version: u8,
    saved_at: u64,
    #[serde(default)]
    etag: Option<String>,
    #[serde(default)]
    source_signatures: Vec<String>,
    #[serde(default)]
    complete: bool,
    #[serde(default)]
    source_statuses: Vec<SourceStatus>,
    skills: Vec<Skill>,
}

#[derive(Debug, Clone, Deserialize)]
struct LegacyCacheFile {
    #[serde(default)]
    last_update: u64,
    #[serde(default)]
    etag: Option<String>,
    #[serde(default, alias = "sourceSignatures")]
    source_signatures: Vec<String>,
    skills: Vec<Skill>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
struct OperationProgress {
    skill_id: String,
    skill_name: String,
    operation: String,
    message: String,
    current: usize,
    total: usize,
    finished: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SourceStatus {
    pub id: String,
    pub display_name: String,
    pub status: String,
    pub skill_count: usize,
    pub error: Option<String>,
    #[serde(default)]
    pub matched_readme_count: Option<usize>,
    #[serde(default)]
    pub parsed_skill_count: Option<usize>,
    #[serde(default)]
    pub request_mode: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
struct TranslationCache {
    version: u8,
    translations: HashMap<String, TranslationCacheEntry>,
}

impl Default for TranslationCache {
    fn default() -> Self {
        Self {
            version: 1,
            translations: HashMap::new(),
        }
    }
}

#[derive(Debug, Clone, Serialize, Deserialize)]
struct TranslationCacheEntry {
    original: String,
    translated: String,
    category: String,
    timestamp: u64,
}

#[derive(Debug, Clone, Deserialize)]
struct DeepSeekResponse {
    choices: Vec<DeepSeekChoice>,
}

#[derive(Debug, Clone, Deserialize)]
struct DeepSeekChoice {
    message: DeepSeekMessage,
}

#[derive(Debug, Clone, Deserialize)]
struct DeepSeekMessage {
    content: String,
}

#[derive(Debug, Clone, Deserialize)]
struct DeepSeekTranslationEnvelope {
    translations: Vec<DeepSeekTranslationItem>,
}

#[derive(Debug, Clone, Deserialize)]
struct DeepSeekTranslationItem {
    id: String,
    translated: String,
    category: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
struct SkillMetadata {
    skill_id: String,
    installed_version: String,
    installed_at: u64,
    source: String,
    repo_owner: String,
    repo_name: String,
    skill_path: String,
    branch: String,
    #[serde(default)]
    manifest: BTreeMap<String, String>,
    #[serde(default)]
    install_mode: Option<String>,
    #[serde(default)]
    install_path: Option<String>,
    #[serde(default)]
    actual_path: Option<String>,
}

#[derive(Debug, Clone)]
struct InstalledSkillInfo {
    metadata: Option<SkillMetadata>,
    is_local_modified: bool,
    install_mode: InstallMode,
    install_path: PathBuf,
    actual_path: PathBuf,
}

#[derive(Debug, Clone, Deserialize)]
struct GithubContentItem {
    path: String,
    #[serde(rename = "type")]
    item_type: String,
}

#[derive(Debug, Clone, Deserialize)]
struct GithubTreeResponse {
    tree: Vec<GithubTreeItem>,
    truncated: bool,
}

#[derive(Debug, Clone, Deserialize)]
struct GithubTreeItem {
    path: String,
    #[serde(rename = "type")]
    item_type: String,
}

#[derive(Debug, Clone, Deserialize)]
struct GithubCommitItem {
    sha: String,
    commit: GithubCommitPayload,
}

#[derive(Debug, Clone, Deserialize)]
struct GithubCommitPayload {
    author: GithubCommitAuthor,
}

#[derive(Debug, Clone, Deserialize)]
struct GithubCommitAuthor {
    date: String,
}

#[derive(Debug, Clone)]
struct RepoFile {
    path: String,
    relative_path: String,
}

fn now_unix_secs() -> u64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .unwrap_or(Duration::from_secs(0))
        .as_secs()
}

fn app_base_dir() -> Result<PathBuf, String> {
    let home = dirs::home_dir().ok_or_else(|| "无法获取用户主目录".to_string())?;
    let base_dir = home.join(APP_DIR_NAME);
    fs::create_dir_all(&base_dir).map_err(|err| err.to_string())?;
    Ok(base_dir)
}

fn cache_dir() -> Result<PathBuf, String> {
    let dir = app_base_dir()?.join("cache");
    fs::create_dir_all(&dir).map_err(|err| err.to_string())?;
    Ok(dir)
}

fn legacy_settings_path() -> Result<PathBuf, String> {
    Ok(app_base_dir()?.join(LEGACY_SETTINGS_FILE))
}

fn cache_path() -> Result<PathBuf, String> {
    Ok(cache_dir()?.join(CACHE_FILE))
}

fn legacy_cache_path() -> Result<PathBuf, String> {
    Ok(cache_dir()?.join(LEGACY_CACHE_FILE))
}

fn translation_cache_path() -> Result<PathBuf, String> {
    Ok(cache_dir()?.join(TRANSLATION_CACHE_FILE))
}

fn merge_warnings(existing: Option<String>, next: Option<String>) -> Option<String> {
    match (existing, next) {
        (Some(left), Some(right)) => Some(format!("{left}\n{right}")),
        (Some(left), None) => Some(left),
        (None, Some(right)) => Some(right),
        (None, None) => None,
    }
}

fn emit_console_line(message: &str) {
    let mut stdout = io::stdout().lock();
    let _ = stdout.write_all(message.as_bytes());
    let _ = stdout.write_all(b"\n");
    let _ = stdout.flush();
}

fn emit_source_notice(source_id: &str, message: &str) {
    emit_console_line(&format!("[source:{source_id}] {message}"));
}

fn format_network_error(error: reqwest::Error) -> String {
    if error.is_timeout() {
        return "网络请求超时，请稍后重试".to_string();
    }

    if error.is_connect() {
        return "网络连接失败，请检查网络、代理或 GitHub 访问状态".to_string();
    }

    let mut details = error.to_string();
    if let Some(url) = error.url() {
        let url_text = url.as_str();
        details = details.replace(url_text, "").trim().trim_matches(':').trim().to_string();
    }

    if details.is_empty() || details == "error sending request" {
        "网络请求失败，请检查网络、代理或 GitHub 访问状态".to_string()
    } else {
        format!("网络请求失败: {details}")
    }
}

fn is_mostly_chinese(text: &str) -> bool {
    if text.is_empty() {
        return false;
    }

    let total = text.chars().count();
    let chinese = text
        .chars()
        .filter(|ch| matches!(*ch, '\u{4e00}'..='\u{9fff}'))
        .count();
    chinese * 10 >= total * 3
}

fn load_settings(app: &AppHandle) -> Result<AppSettings, String> {
    let store = app
        .store(APP_STORE_FILE)
        .map_err(|err| format!("无法打开应用 Store：{err}"))?;

    if let Some(value) = store.get(SETTINGS_STORE_KEY) {
        return serde_json::from_value(value.clone())
            .map_err(|err| format!("无法解析已保存设置：{err}"));
    }

    let legacy_path = legacy_settings_path()?;
    if legacy_path.exists() {
        let content = fs::read_to_string(legacy_path).map_err(|err| err.to_string())?;
        let settings: AppSettings = serde_json::from_str(&content).map_err(|err| err.to_string())?;
        save_settings_to_store(app, &settings)?;
        return Ok(settings);
    }

    let settings = AppSettings::default();
    save_settings_to_store(app, &settings)?;
    Ok(settings)
}

fn save_settings_to_store(app: &AppHandle, settings: &AppSettings) -> Result<(), String> {
    let store = app
        .store(APP_STORE_FILE)
        .map_err(|err| format!("无法打开应用 Store：{err}"))?;
    let value = serde_json::to_value(settings).map_err(|err| err.to_string())?;
    store.set(SETTINGS_STORE_KEY, value);
    store
        .save()
        .map_err(|err| format!("无法保存应用设置：{err}"))
}

fn load_source_configs() -> Result<Vec<SkillSourceConfig>, String> {
    let config: SkillSourcesFile =
        serde_json::from_str(SKILL_SOURCES_JSON).map_err(|err| err.to_string())?;
    Ok(config.sources)
}

fn resolve_install_path(settings: &AppSettings) -> Result<PathBuf, String> {
    let base_path = if settings.install_scope == "project" {
        let root = settings.project_root.trim();
        if root.is_empty() {
            return Err("项目安装模式需要先选择一个项目目录".to_string());
        }
        PathBuf::from(root)
    } else {
        dirs::home_dir().ok_or_else(|| "无法获取用户主目录".to_string())?
    };

    let install_path = match settings.agent_type.as_str() {
        "antigravity" => {
            if settings.install_scope == "project" {
                base_path.join(".agent").join("skills")
            } else {
                base_path
                    .join(".gemini")
                    .join("antigravity")
                    .join("global_skills")
            }
        }
        "gemini" => base_path.join(".gemini").join("skills"),
        "claude" => base_path.join(".claude").join("skills"),
        "codex" => base_path.join(".codex").join("skills"),
        "opencode" => {
            if settings.install_scope == "project" {
                base_path.join(".opencode").join("skill")
            } else {
                base_path.join(".config").join("opencode").join("skill")
            }
        }
        _ => return Err(format!("不支持的 Agent 类型: {}", settings.agent_type)),
    };

    Ok(install_path)
}

fn ensure_install_dir(settings: &AppSettings) -> Result<PathBuf, String> {
    let path = resolve_install_path(settings)?;
    fs::create_dir_all(&path).map_err(|err| err.to_string())?;
    Ok(path)
}

fn preferred_storage_root() -> Result<PathBuf, String> {
    let home = dirs::home_dir().ok_or_else(|| "无法获取用户主目录".to_string())?;
    Ok(home.join(".skill-marketplace").join("skills"))
}

fn fallback_storage_root() -> Result<PathBuf, String> {
    if let Some(local) = dirs::data_local_dir() {
        return Ok(local.join("skill-marketplace").join("skills"));
    }

    Ok(app_base_dir()?.join("skills"))
}

fn resolve_storage_root(settings: &AppSettings) -> Result<PathBuf, String> {
    let configured = settings.storage_root.trim();
    if !configured.is_empty() {
        return Ok(PathBuf::from(configured));
    }

    preferred_storage_root()
}

fn ensure_storage_root(settings: &AppSettings) -> Result<PathBuf, String> {
    let path = resolve_storage_root(settings)?;
    if fs::create_dir_all(&path).is_ok() {
        return Ok(path);
    }

    if settings.storage_root.trim().is_empty() {
        let fallback = fallback_storage_root()?;
        fs::create_dir_all(&fallback).map_err(|err| err.to_string())?;
        return Ok(fallback);
    }

    fs::create_dir_all(&path).map_err(|err| err.to_string())?;
    Ok(path)
}

fn metadata_install_mode(metadata: Option<&SkillMetadata>, visible_path: &Path) -> InstallMode {
    if let Some(mode) = metadata
        .and_then(|value| value.install_mode.as_deref())
        .map(InstallMode::from_settings)
    {
        return mode;
    }

    if metadata
        .and_then(|value| value.actual_path.as_deref())
        .map(PathBuf::from)
        .map(|path| path != visible_path)
        .unwrap_or(false)
    {
        return InstallMode::Reference;
    }

    if fs::symlink_metadata(visible_path)
        .map(|value| value.file_type().is_symlink())
        .unwrap_or(false)
    {
        return InstallMode::Reference;
    }

    InstallMode::Copy
}

fn metadata_install_path(metadata: Option<&SkillMetadata>, fallback: &Path) -> PathBuf {
    metadata
        .and_then(|value| value.install_path.as_deref())
        .map(PathBuf::from)
        .unwrap_or_else(|| fallback.to_path_buf())
}

fn metadata_actual_path(metadata: Option<&SkillMetadata>, fallback: &Path) -> PathBuf {
    metadata
        .and_then(|value| value.actual_path.as_deref())
        .map(PathBuf::from)
        .unwrap_or_else(|| fallback.to_path_buf())
}

fn safe_dir_name(skill_id: &str) -> String {
    skill_id.replace(':', "--")
}

fn reverse_safe_dir_name(dir_name: &str) -> String {
    dir_name.replace("--", ":")
}

fn command_succeeded(program: &str, args: &[&str], current_dir: Option<&Path>) -> bool {
    let mut command = Command::new(program);
    command.args(args);
    if let Some(path) = current_dir {
        command.current_dir(path);
    }

    command.stdout(Stdio::null());
    command.stderr(Stdio::null());
    command.status().map(|status| status.success()).unwrap_or(false)
}

fn git_available() -> bool {
    command_succeeded("git", &["--version"], None)
}

fn initialize_git_repo(skill_dir: &Path) {
    if !git_available() {
        return;
    }

    let _ = command_succeeded("git", &["init"], Some(skill_dir));
    let _ = command_succeeded("git", &["config", "user.name", "Skill Marketplace"], Some(skill_dir));
    let _ = command_succeeded(
        "git",
        &["config", "user.email", "marketplace@local"],
        Some(skill_dir),
    );
    let _ = command_succeeded("git", &["add", "-A"], Some(skill_dir));
    let _ = command_succeeded(
        "git",
        &["commit", "--no-gpg-sign", "-m", "Initial install from marketplace"],
        Some(skill_dir),
    );
}

fn git_has_local_changes(skill_dir: &Path) -> Option<bool> {
    if !skill_dir.join(".git").exists() || !git_available() {
        return None;
    }

    let output = Command::new("git")
        .args(["status", "--porcelain"])
        .current_dir(skill_dir)
        .output()
        .ok()?;
    if !output.status.success() {
        return None;
    }

    Some(!String::from_utf8_lossy(&output.stdout).trim().is_empty())
}

fn restore_from_git(skill_dir: &Path) -> bool {
    if !skill_dir.join(".git").exists() || !git_available() {
        return false;
    }

    command_succeeded("git", &["checkout", "."], Some(skill_dir))
        && command_succeeded("git", &["clean", "-fd"], Some(skill_dir))
}

fn remove_link_path(path: &Path) -> Result<(), String> {
    if !path.exists() {
        return Ok(());
    }

    let metadata = fs::symlink_metadata(path).map_err(|err| err.to_string())?;
    if metadata.file_type().is_symlink() {
        #[cfg(target_family = "windows")]
        {
            fs::remove_dir(path).map_err(|err| err.to_string())
        }
        #[cfg(not(target_family = "windows"))]
        {
            fs::remove_file(path).map_err(|err| err.to_string())
        }
    } else if metadata.is_dir() {
        fs::remove_dir_all(path).map_err(|err| err.to_string())
    } else {
        fs::remove_file(path).map_err(|err| err.to_string())
    }
}

fn copy_dir_recursive(source: &Path, target: &Path) -> Result<(), String> {
    if target.exists() {
        fs::remove_dir_all(target).map_err(|err| err.to_string())?;
    }

    for entry in WalkDir::new(source).into_iter().filter_map(Result::ok) {
        let path = entry.path();
        let relative = path.strip_prefix(source).map_err(|err| err.to_string())?;
        let destination = target.join(relative);

        if entry.file_type().is_dir() {
            fs::create_dir_all(&destination).map_err(|err| err.to_string())?;
        } else if entry.file_type().is_file() {
            if let Some(parent) = destination.parent() {
                fs::create_dir_all(parent).map_err(|err| err.to_string())?;
            }
            fs::copy(path, &destination).map_err(|err| err.to_string())?;
        }
    }

    Ok(())
}

fn move_dir_recursive(source: &Path, target: &Path) -> Result<(), String> {
    if source == target {
        return Ok(());
    }

    if let Some(parent) = target.parent() {
        fs::create_dir_all(parent).map_err(|err| err.to_string())?;
    }

    match fs::rename(source, target) {
        Ok(()) => Ok(()),
        Err(_) => {
            copy_dir_recursive(source, target)?;
            fs::remove_dir_all(source).map_err(|err| err.to_string())
        }
    }
}

fn create_reference_link(source: &Path, target: &Path) -> Result<(), String> {
    if target.exists() {
        remove_link_path(target)?;
    }

    #[cfg(target_family = "windows")]
    {
        let command = format!(r#"mklink /J "{}" "{}""#, target.display(), source.display());
        let status = Command::new("cmd")
            .args(["/C", &command])
            .stdout(Stdio::null())
            .stderr(Stdio::null())
            .status()
            .map_err(|err| err.to_string())?;
        if !status.success() {
            return Err("创建目录引用失败".to_string());
        }
    }

    #[cfg(not(target_family = "windows"))]
    {
        std::os::unix::fs::symlink(source, target).map_err(|err| err.to_string())?;
    }

    Ok(())
}

fn parse_skill_frontmatter(content: &str) -> HashMap<String, String> {
    let mut map = HashMap::new();
    let mut lines = content.lines();
    if lines.next() != Some("---") {
        return map;
    }

    for line in lines {
        if line == "---" {
            break;
        }

        if let Some((key, value)) = line.split_once(':') {
            map.insert(
                key.trim().to_string(),
                value
                    .trim()
                    .trim_matches('"')
                    .trim_matches('\'')
                    .to_string(),
            );
        }
    }

    map
}

fn guess_category(name: &str, description: &str) -> String {
    let text = format!("{} {}", name, description).to_lowercase();
    if text.contains("code")
        || text.contains("debug")
        || text.contains("script")
        || text.contains("api")
        || text.contains("git")
        || text.contains("python")
        || text.contains("rust")
        || text.contains("javascript")
    {
        return "编程".to_string();
    }

    if text.contains("document")
        || text.contains("excel")
        || text.contains("sheet")
        || text.contains("meeting")
        || text.contains("mail")
        || text.contains("report")
    {
        return "办公".to_string();
    }

    if text.contains("image")
        || text.contains("design")
        || text.contains("draw")
        || text.contains("music")
        || text.contains("video")
        || text.contains("creative")
    {
        return "创意".to_string();
    }

    if text.contains("data")
        || text.contains("research")
        || text.contains("math")
        || text.contains("science")
        || text.contains("analy")
        || text.contains("chart")
    {
        return "分析".to_string();
    }

    if text.contains("travel")
        || text.contains("recipe")
        || text.contains("weather")
        || text.contains("health")
        || text.contains("social")
    {
        return "生活".to_string();
    }

    "其它".to_string()
}

fn create_http_client(token: &str) -> Result<Client, String> {
    let mut headers = HeaderMap::new();
    headers.insert(USER_AGENT, HeaderValue::from_static(USER_AGENT_VALUE));
    headers.insert(
        ACCEPT,
        HeaderValue::from_static("application/vnd.github.v3+json"),
    );

    if !token.trim().is_empty() {
        let value = format!("Bearer {}", token.trim());
        let header = HeaderValue::from_str(&value).map_err(|err| err.to_string())?;
        headers.insert(AUTHORIZATION, header);
    }

    Client::builder()
        .default_headers(headers)
        .build()
        .map_err(|err| err.to_string())
}

async fn fetch_github_contents(
    client: &Client,
    owner: &str,
    repo: &str,
    path: &str,
) -> Result<Vec<GithubContentItem>, String> {
    let url = if path.is_empty() {
        format!("https://api.github.com/repos/{owner}/{repo}/contents")
    } else {
        format!("https://api.github.com/repos/{owner}/{repo}/contents/{path}")
    };

    let response = client
        .get(url)
        .send()
        .await
        .map_err(format_network_error)?;
    if !response.status().is_success() {
        return Err(format!("GitHub API 请求失败: {}", response.status()));
    }

    response
        .json::<Vec<GithubContentItem>>()
        .await
        .map_err(|err| err.to_string())
}

async fn fetch_raw_text(
    client: &Client,
    owner: &str,
    repo: &str,
    branch: &str,
    path: &str,
) -> Result<String, String> {
    let url = format!("https://raw.githubusercontent.com/{owner}/{repo}/{branch}/{path}");
    let response = client
        .get(url)
        .send()
        .await
        .map_err(format_network_error)?;
    if !response.status().is_success() {
        return Err(format!("获取文件失败: {}", response.status()));
    }

    response.text().await.map_err(|err| err.to_string())
}

async fn fetch_github_tree(
    client: &Client,
    owner: &str,
    repo: &str,
    branch: &str,
) -> Result<GithubTreeResponse, String> {
    let url = format!("https://api.github.com/repos/{owner}/{repo}/git/trees/{branch}?recursive=1");
    let response = client
        .get(url)
        .send()
        .await
        .map_err(format_network_error)?;
    if !response.status().is_success() {
        return Err(format!("GitHub Trees API 请求失败: {}", response.status()));
    }

    let tree = response
        .json::<GithubTreeResponse>()
        .await
        .map_err(|err| err.to_string())?;
    if tree.truncated {
        return Err("GitHub Trees API 返回了被截断的目录树".to_string());
    }

    Ok(tree)
}

async fn fetch_latest_commit(
    client: &Client,
    owner: &str,
    repo: &str,
    branch: &str,
    path: &str,
) -> Result<Option<(String, u64)>, String> {
    let encoded_path = urlencoding::encode(path);
    let url = format!(
        "https://api.github.com/repos/{owner}/{repo}/commits?path={encoded_path}&sha={branch}&per_page=1"
    );
    let response = client
        .get(url)
        .send()
        .await
        .map_err(format_network_error)?;
    if !response.status().is_success() {
        return Ok(None);
    }

    let commits = response
        .json::<Vec<GithubCommitItem>>()
        .await
        .map_err(|err| err.to_string())?;
    let Some(commit) = commits.first() else {
        return Ok(None);
    };

    let timestamp = commit
        .commit
        .author
        .date
        .parse::<chrono::DateTime<chrono::Utc>>()
        .map(|value| value.timestamp().max(0) as u64)
        .unwrap_or(0);

    Ok(Some((commit.sha.chars().take(7).collect(), timestamp)))
}

fn merge_unique_messages(messages: Vec<String>) -> Option<String> {
    let mut unique = Vec::new();
    for message in messages {
        if !unique.contains(&message) {
            unique.push(message);
        }
    }

    if unique.is_empty() {
        None
    } else {
        Some(unique.join("；"))
    }
}

fn build_source_status(
    source: &SkillSourceConfig,
    matched_readme_count: usize,
    parsed_skill_count: usize,
    errors: Vec<String>,
) -> SourceStatus {
    let error = merge_unique_messages(errors);
    let status = if parsed_skill_count > 0 {
        "ok"
    } else if error.is_some() {
        "error"
    } else {
        "empty"
    };

    SourceStatus {
        id: source.id.clone(),
        display_name: source.display_name.clone(),
        status: status.to_string(),
        skill_count: parsed_skill_count,
        error,
        matched_readme_count: Some(matched_readme_count),
        parsed_skill_count: Some(parsed_skill_count),
        request_mode: Some("tree-scan".to_string()),
    }
}

fn dedupe_skills(skills: &[Skill]) -> Vec<Skill> {
    let mut seen = HashSet::new();
    let mut deduped = Vec::new();

    for skill in skills {
        if seen.insert(skill.id.clone()) {
            deduped.push(skill.clone());
        }
    }

    deduped
}

fn emit_operation_progress(
    app: &AppHandle,
    skill_id: &str,
    skill_name: &str,
    operation: &str,
    message: String,
    current: usize,
    total: usize,
    finished: bool,
) {
    let _ = app.emit(
        OPERATION_PROGRESS_EVENT,
        OperationProgress {
            skill_id: skill_id.to_string(),
            skill_name: skill_name.to_string(),
            operation: operation.to_string(),
            message,
            current,
            total,
            finished,
        },
    );
}

async fn fetch_remote_skills(
    settings: &AppSettings,
    source_configs: &[SkillSourceConfig],
) -> Result<(Vec<Skill>, Vec<SourceStatus>, Option<String>), String> {
    let client = create_http_client(&settings.github_token)?;
    let mut skills = Vec::new();
    let mut source_statuses = Vec::new();
    let mut warning_messages = Vec::new();

    for source in source_configs {
        let source_start_count = skills.len();
        let mut source_errors = Vec::new();
        let mut seen_source_skill_ids = HashSet::new();
        let tree = match fetch_github_tree(&client, &source.owner, &source.repo, &source.branch).await {
            Ok(value) => value,
            Err(error) => {
                source_errors.push(error);
                let source_status = build_source_status(source, 0, 0, source_errors);
                if let Some(error) = &source_status.error {
                    emit_source_notice(&source.id, error);
                }
                warning_messages.push(format!("{} 加载失败", source.display_name));
                source_statuses.push(source_status);
                continue;
            }
        };

        let mut readme_candidates = Vec::<(String, String)>::new();
        let mut seen_paths = HashSet::new();
        for configured_path in source.skills_path.values() {
            let path = configured_path.trim_matches('/');

            for item in tree.tree.iter().filter(|entry| entry.item_type == "blob") {
                if !item.path.ends_with("/SKILL.md") {
                    continue;
                }

                let maybe_skill_base_path = if source.path_type == "root" || path.is_empty() {
                    let parts = item.path.split('/').collect::<Vec<_>>();
                    if parts.len() == 2 && parts[1] == "SKILL.md" {
                        Some(parts[0].to_string())
                    } else {
                        None
                    }
                } else {
                    let prefix = format!("{path}/");
                    if let Some(relative) = item.path.strip_prefix(&prefix) {
                        let parts = relative.split('/').collect::<Vec<_>>();
                        if parts.len() == 2 && parts[1] == "SKILL.md" {
                            Some(format!("{path}/{}", parts[0]))
                        } else {
                            None
                        }
                    } else {
                        None
                    }
                };

                let Some(skill_base_path) = maybe_skill_base_path else {
                    continue;
                };

                let Some(skill_dir_name) = skill_base_path.rsplit('/').next() else {
                    continue;
                };
                if source.exclude_dirs.iter().any(|name| name == skill_dir_name) {
                    continue;
                }

                if seen_paths.insert(skill_base_path.clone()) {
                    readme_candidates.push((skill_dir_name.to_string(), skill_base_path));
                }
            }
        }

        readme_candidates.sort_by(|left, right| left.1.cmp(&right.1));

        for (skill_dir_name, skill_base_path) in &readme_candidates {
            let readme_path = format!("{skill_base_path}/SKILL.md");
            let content = match fetch_raw_text(
                &client,
                &source.owner,
                &source.repo,
                &source.branch,
                &readme_path,
            )
            .await
            {
                Ok(value) => value,
                Err(error) => {
                    source_errors.push(format!("{} 的 SKILL.md 获取失败: {}", skill_dir_name, error));
                    continue;
                }
            };

            let metadata = parse_skill_frontmatter(&content);
            let Some(name) = metadata.get("name").cloned() else {
                source_errors.push(format!("{} 缺少 name 元数据", skill_dir_name));
                continue;
            };
            let Some(description) = metadata.get("description").cloned() else {
                source_errors.push(format!("{} 缺少 description 元数据", skill_dir_name));
                continue;
            };

            let category = metadata
                .get("category")
                .cloned()
                .unwrap_or_else(|| guess_category(&name, &description));

            let skill_id = format!("{}:{}", source.id, skill_dir_name);
            if !seen_source_skill_ids.insert(skill_id.clone()) {
                continue;
            }

            skills.push(Skill {
                id: skill_id,
                name,
                desc: description,
                category: category.clone(),
                icon: source.icon.clone(),
                colors: source.colors.clone(),
                is_featured: true,
                repo_link: Some(format!(
                    "https://github.com/{}/{}/tree/{}/{}",
                    source.owner, source.repo, source.branch, skill_base_path
                )),
                is_installed: Some(false),
                repo_owner: Some(source.owner.clone()),
                repo_name: Some(source.repo.clone()),
                skill_path: Some(skill_base_path.clone()),
                source: Some(source.id.clone()),
                branch: Some(source.branch.clone()),
                translated_desc: None,
                ai_category: Some(category.clone()),
                commit_sha: None,
                last_updated: None,
                has_update: Some(false),
                installed_version: None,
                is_local_modified: Some(false),
                install_mode: None,
                install_path: None,
                actual_path: None,
            });
        }

        let matched_readme_count = readme_candidates.len();
        let parsed_skill_count = skills.len().saturating_sub(source_start_count);
        let source_status = build_source_status(
            source,
            matched_readme_count,
            parsed_skill_count,
            source_errors,
        );
        if source_status.status == "error" {
            if let Some(error) = &source_status.error {
                emit_source_notice(&source.id, error);
            }
            warning_messages.push(format!("{} 加载失败", source.display_name));
        }
        source_statuses.push(source_status);
    }

    let mut deduped_skills = dedupe_skills(&skills);
    deduped_skills.sort_by(|left, right| left.name.cmp(&right.name));
    let warning = if warning_messages.is_empty() {
        None
    } else {
        Some(format!("以下来源加载失败: {}", warning_messages.join("、")))
    };

    Ok((deduped_skills, source_statuses, warning))
}

fn normalize_cache(
    mut cache: CacheFile,
    source_configs: &[SkillSourceConfig],
    fallback_complete: bool,
) -> CacheFile {
    cache.skills = dedupe_skills(&cache.skills);
    if cache.source_signatures.is_empty() {
        cache.source_signatures = current_source_signatures(source_configs);
    }
    if cache.source_statuses.is_empty() {
        cache.source_statuses = synthesize_source_statuses(source_configs, &cache.skills);
    }
    if cache.version == 0 {
        cache.version = CACHE_VERSION;
    }
    if !cache.complete {
        cache.complete = fallback_complete;
    }
    cache
}

fn load_new_cache(source_configs: &[SkillSourceConfig]) -> Result<Option<CacheFile>, String> {
    let path = cache_path()?;
    if !path.exists() {
        return Ok(None);
    }

    let content = fs::read_to_string(path).map_err(|err| err.to_string())?;
    let cache = serde_json::from_str::<CacheFile>(&content).map_err(|err| err.to_string())?;
    Ok(Some(normalize_cache(cache, source_configs, false)))
}

fn load_legacy_cache(source_configs: &[SkillSourceConfig]) -> Result<Option<CacheFile>, String> {
    let path = legacy_cache_path()?;
    if !path.exists() {
        return Ok(None);
    }

    let content = fs::read_to_string(path).map_err(|err| err.to_string())?;
    let legacy =
        serde_json::from_str::<LegacyCacheFile>(&content).map_err(|err| err.to_string())?;
    Ok(Some(normalize_cache(
        CacheFile {
            version: CACHE_VERSION,
            saved_at: if legacy.last_update > 1_000_000_000_000 {
                legacy.last_update / 1000
            } else {
                legacy.last_update
            },
            etag: legacy.etag,
            source_signatures: legacy.source_signatures,
            complete: !legacy.skills.is_empty(),
            source_statuses: Vec::new(),
            skills: legacy.skills,
        },
        source_configs,
        true,
    )))
}

fn choose_better_cache(primary: Option<CacheFile>, secondary: Option<CacheFile>) -> Option<CacheFile> {
    match (primary, secondary) {
        (Some(left), Some(right)) => {
            let left_score = (
                left.complete as u8,
                left.source_statuses.len(),
                left.skills.len(),
                left.saved_at,
            );
            let right_score = (
                right.complete as u8,
                right.source_statuses.len(),
                right.skills.len(),
                right.saved_at,
            );
            if right_score > left_score {
                Some(right)
            } else {
                Some(left)
            }
        }
        (Some(cache), None) | (None, Some(cache)) => Some(cache),
        (None, None) => None,
    }
}

fn load_cached_skills(source_configs: &[SkillSourceConfig]) -> Result<Option<CacheFile>, String> {
    let new_cache = load_new_cache(source_configs)?;
    let legacy_cache = load_legacy_cache(source_configs)?;
    Ok(choose_better_cache(new_cache, legacy_cache))
}

fn save_cached_skills(
    skills: &[Skill],
    source_statuses: &[SourceStatus],
    source_signatures: &[String],
    etag: Option<String>,
    complete: bool,
) -> Result<(), String> {
    let cache = CacheFile {
        version: CACHE_VERSION,
        saved_at: now_unix_secs(),
        etag,
        source_signatures: source_signatures.to_vec(),
        complete,
        source_statuses: source_statuses.to_vec(),
        skills: skills.to_vec(),
    };
    let content = serde_json::to_string_pretty(&cache).map_err(|err| err.to_string())?;
    fs::write(cache_path()?, content).map_err(|err| err.to_string())
}

fn cache_is_fresh(cache: &CacheFile) -> bool {
    now_unix_secs().saturating_sub(cache.saved_at) < CACHE_TTL_SECS
}

fn cache_matches_sources(cache: &CacheFile, source_signatures: &[String]) -> bool {
    !cache.source_signatures.is_empty() && cache.source_signatures == source_signatures
}

fn source_fetch_complete(source_statuses: &[SourceStatus]) -> bool {
    source_statuses.iter().all(|status| status.status != "error")
}

fn first_source_commit_url(source_configs: &[SkillSourceConfig]) -> Option<String> {
    let first = source_configs.first()?;
    Some(format!(
        "https://api.github.com/repos/{}/{}/commits?sha={}&per_page=1",
        first.owner, first.repo, first.branch
    ))
}

async fn check_cache_validity(
    client: &Client,
    source_configs: &[SkillSourceConfig],
    etag: &str,
) -> Result<(bool, Option<String>), String> {
    let Some(url) = first_source_commit_url(source_configs) else {
        return Ok((false, None));
    };

    let response = client
        .get(url)
        .header("If-None-Match", etag)
        .send()
        .await
        .map_err(format_network_error)?;

    if response.status() == reqwest::StatusCode::NOT_MODIFIED {
        return Ok((true, None));
    }

    if response.status().is_success() {
        let new_etag = response
            .headers()
            .get("etag")
            .and_then(|value| value.to_str().ok())
            .map(|value| value.to_string());
        return Ok((false, new_etag));
    }

    Ok((false, None))
}

async fn fetch_repo_etag(
    client: &Client,
    source_configs: &[SkillSourceConfig],
) -> Result<Option<String>, String> {
    let Some(url) = first_source_commit_url(source_configs) else {
        return Ok(None);
    };

    let response = client
        .get(url)
        .send()
        .await
        .map_err(format_network_error)?;

    if !response.status().is_success() {
        return Ok(None);
    }

    Ok(response
        .headers()
        .get("etag")
        .and_then(|value| value.to_str().ok())
        .map(|value| value.to_string()))
}

fn synthesize_source_statuses(
    source_configs: &[SkillSourceConfig],
    skills: &[Skill],
) -> Vec<SourceStatus> {
    source_configs
        .iter()
        .map(|source| {
            let count = skills
                .iter()
                .filter(|skill| skill.source.as_deref() == Some(source.id.as_str()))
                .count();
            SourceStatus {
                id: source.id.clone(),
                display_name: source.display_name.clone(),
                status: if count > 0 { "ok" } else { "empty" }.to_string(),
                skill_count: count,
                error: None,
                matched_readme_count: Some(count),
                parsed_skill_count: Some(count),
                request_mode: Some("cache".to_string()),
            }
        })
        .collect()
}

fn load_translation_cache() -> Result<TranslationCache, String> {
    let path = translation_cache_path()?;
    if !path.exists() {
        return Ok(TranslationCache::default());
    }

    let content = fs::read_to_string(path).map_err(|err| err.to_string())?;
    serde_json::from_str::<TranslationCache>(&content).map_err(|err| err.to_string())
}

fn save_translation_cache(cache: &TranslationCache) -> Result<(), String> {
    let content = serde_json::to_string_pretty(cache).map_err(|err| err.to_string())?;
    fs::write(translation_cache_path()?, content).map_err(|err| err.to_string())
}

async fn translate_batch_with_deepseek(
    api_key: &str,
    batch: &[(String, String)],
) -> Result<Vec<DeepSeekTranslationItem>, String> {
    let request_items = batch
        .iter()
        .map(|(id, text)| serde_json::json!({ "id": id, "text": text }))
        .collect::<Vec<_>>();
    let body = serde_json::json!({
        "model": "deepseek-chat",
        "messages": [
            {
                "role": "system",
                "content": "你是一个专业的助手。请将用户提供的技能描述翻译为简洁中文，并为每条内容归类为以下分类之一：编程、办公、创意、分析、生活。如果没有合适分类则返回空字符串。严格输出 JSON 对象，格式为 {\"translations\":[{\"id\":\"skill-id\",\"translated\":\"中文翻译\",\"category\":\"分类名称\"}] }。"
            },
            {
                "role": "user",
                "content": serde_json::to_string(&request_items).map_err(|err| err.to_string())?
            }
        ],
        "temperature": 0.2,
        "max_tokens": 2000,
        "response_format": { "type": "json_object" }
    });

    let response = reqwest::Client::new()
        .post(DEEPSEEK_API_URL)
        .bearer_auth(api_key.trim())
        .json(&body)
        .send()
        .await
        .map_err(format_network_error)?;
    if !response.status().is_success() {
        return Err(format!("DeepSeek 请求失败: {}", response.status()));
    }

    let parsed = response
        .json::<DeepSeekResponse>()
        .await
        .map_err(|err| err.to_string())?;
    let content = parsed
        .choices
        .first()
        .map(|choice| choice.message.content.clone())
        .ok_or_else(|| "DeepSeek 响应为空".to_string())?;
    let translations = serde_json::from_str::<DeepSeekTranslationEnvelope>(&content)
        .map_err(|err| err.to_string())?;

    Ok(translations.translations)
}

async fn hydrate_translations(
    settings: &AppSettings,
    skills: &mut [Skill],
) -> Result<Option<String>, String> {
    let mut cache = load_translation_cache()?;
    let mut pending = Vec::<(String, String)>::new();

    for skill in skills.iter_mut() {
        if is_mostly_chinese(&skill.desc) {
            skill.translated_desc = Some(skill.desc.clone());
            skill.ai_category = Some(
                skill
                    .ai_category
                    .clone()
                    .unwrap_or_else(|| skill.category.clone()),
            );
            continue;
        }

        if let Some(entry) = cache.translations.get(&skill.id) {
            if entry.original == skill.desc {
                skill.translated_desc = Some(entry.translated.clone());
                if !entry.category.is_empty() {
                    skill.ai_category = Some(entry.category.clone());
                }
                continue;
            }
        }

        pending.push((skill.id.clone(), skill.desc.clone()));
    }

    let wants_translation = settings.language == "zh-CN" || settings.show_ai_categories;
    if !wants_translation {
        return Ok(None);
    }

    if settings.deepseek_api_key.trim().is_empty() {
        if settings.language == "zh-CN" {
            return Ok(Some(
                "未配置 DeepSeek API Key，当前中文描述仅显示已缓存结果。".to_string(),
            ));
        }
        return Ok(None);
    }

    if pending.is_empty() {
        return Ok(None);
    }

    for batch in pending.chunks(TRANSLATION_BATCH_SIZE) {
        let translated =
            match translate_batch_with_deepseek(&settings.deepseek_api_key, batch).await {
                Ok(items) => items,
                Err(error) => {
                    return Ok(Some(format!("DeepSeek 翻译失败，已保留原文: {error}")));
                }
            };

        for item in translated {
            if let Some(skill) = skills.iter_mut().find(|skill| skill.id == item.id) {
                let translated_desc = if item.translated.trim().is_empty() {
                    skill.desc.clone()
                } else {
                    item.translated.clone()
                };
                let category = item.category.trim().to_string();

                skill.translated_desc = Some(translated_desc.clone());
                if !category.is_empty() {
                    skill.ai_category = Some(category.clone());
                }

                cache.translations.insert(
                    item.id,
                    TranslationCacheEntry {
                        original: skill.desc.clone(),
                        translated: translated_desc,
                        category,
                        timestamp: now_unix_secs(),
                    },
                );
            }
        }
    }

    save_translation_cache(&cache)?;
    Ok(None)
}

async fn get_skills_with_cache(
    settings: &AppSettings,
    source_configs: &[SkillSourceConfig],
    force_refresh: bool,
) -> Result<(Vec<Skill>, Vec<SourceStatus>, bool, Option<String>), String> {
    let current_signatures = current_source_signatures(source_configs);
    let cached = load_cached_skills(source_configs)?;
    let client = create_http_client(&settings.github_token)?;
    if !force_refresh {
        if let Some(cache) = cached.clone() {
            if cache_matches_sources(&cache, &current_signatures) && cache_is_fresh(&cache) {
                let source_statuses = if cache.source_statuses.is_empty() {
                    synthesize_source_statuses(source_configs, &cache.skills)
                } else {
                    cache.source_statuses
                };
                return Ok((cache.skills, source_statuses, true, None));
            }

            if cache_matches_sources(&cache, &current_signatures)
                && cache.complete
                && !cache.skills.is_empty()
                && cache.etag.is_some()
            {
                let (not_modified, _new_etag) =
                    check_cache_validity(&client, source_configs, cache.etag.as_deref().unwrap_or("")).await?;
                if not_modified {
                    return Ok((cache.skills, cache.source_statuses, true, None));
                }
            }
        }
    }

    match fetch_remote_skills(settings, source_configs).await {
        Ok((skills, source_statuses, warning)) => {
            let complete = source_fetch_complete(&source_statuses);
            let etag = if complete {
                fetch_repo_etag(&client, source_configs).await?
            } else {
                cached.as_ref().and_then(|cache| cache.etag.clone())
            };

            if complete {
                save_cached_skills(&skills, &source_statuses, &current_signatures, etag, true)?;
                return Ok((skills, source_statuses, false, warning));
            }

            if let Some(cache) = cached.clone() {
                if cache.complete
                    && cache_matches_sources(&cache, &current_signatures)
                    && !cache.skills.is_empty()
                {
                    let warning = merge_warnings(
                        warning,
                        Some("本次刷新未完整完成，继续显示上次完整缓存。".to_string()),
                    );
                    return Ok((cache.skills, cache.source_statuses, true, warning));
                }
            }

            save_cached_skills(&skills, &source_statuses, &current_signatures, etag, false)?;
            Ok((skills, source_statuses, false, warning))
        }
        Err(error) => {
            if let Some(cache) = cached {
                let source_statuses = if cache.source_statuses.is_empty() {
                    synthesize_source_statuses(source_configs, &cache.skills)
                } else {
                    cache.source_statuses
                };
                return Ok((
                    cache.skills,
                    source_statuses,
                    true,
                    Some(format!("GitHub 拉取失败，已回退到缓存: {error}")),
                ));
            }

            Err(error)
        }
    }
}

fn read_metadata(skill_dir: &Path) -> Result<Option<SkillMetadata>, String> {
    let path = skill_dir.join(METADATA_FILE);
    if !path.exists() {
        return Ok(None);
    }

    let content = fs::read_to_string(path).map_err(|err| err.to_string())?;
    let metadata =
        serde_json::from_str::<SkillMetadata>(&content).map_err(|err| err.to_string())?;
    Ok(Some(metadata))
}

fn write_metadata(skill_dir: &Path, metadata: &SkillMetadata) -> Result<(), String> {
    let content = serde_json::to_string_pretty(metadata).map_err(|err| err.to_string())?;
    fs::write(skill_dir.join(METADATA_FILE), content).map_err(|err| err.to_string())
}

fn hash_file(path: &Path) -> Result<String, String> {
    let mut file = fs::File::open(path).map_err(|err| err.to_string())?;
    let mut hasher = Sha256::new();
    let mut buffer = [0_u8; 8192];

    loop {
        let read = file.read(&mut buffer).map_err(|err| err.to_string())?;
        if read == 0 {
            break;
        }

        hasher.update(&buffer[..read]);
    }

    Ok(format!("{:x}", hasher.finalize()))
}

fn should_skip_manifest_entry(skill_dir: &Path, path: &Path) -> bool {
    if path.file_name().and_then(|name| name.to_str()) == Some(METADATA_FILE) {
        return true;
    }

    path.strip_prefix(skill_dir)
        .ok()
        .map(|relative| {
            relative
                .components()
                .any(|component| component.as_os_str().to_string_lossy() == ".git")
        })
        .unwrap_or(false)
}

fn build_manifest(skill_dir: &Path) -> Result<BTreeMap<String, String>, String> {
    let mut manifest = BTreeMap::new();
    if !skill_dir.exists() {
        return Ok(manifest);
    }

    for entry in WalkDir::new(skill_dir).into_iter().filter_map(Result::ok) {
        if !entry.file_type().is_file() {
            continue;
        }

        let path = entry.path();
        if should_skip_manifest_entry(skill_dir, path) {
            continue;
        }

        let relative = path
            .strip_prefix(skill_dir)
            .map_err(|err| err.to_string())?
            .to_string_lossy()
            .replace('\\', "/");
        manifest.insert(relative, hash_file(path)?);
    }

    Ok(manifest)
}

fn detect_local_modified(skill_dir: &Path, metadata: Option<&SkillMetadata>) -> Result<bool, String> {
    if let Some(changed) = git_has_local_changes(skill_dir) {
        return Ok(changed);
    }

    let current_manifest = build_manifest(skill_dir)?;
    Ok(metadata
        .map(|value| value.manifest != current_manifest)
        .unwrap_or(false))
}

fn watchable_paths(settings: &AppSettings) -> Vec<PathBuf> {
    let mut paths = Vec::new();
    if let Ok(path) = resolve_install_path(settings) {
        paths.push(path);
    }
    if let Ok(path) = resolve_storage_root(settings) {
        paths.push(path);
    }

    paths.sort();
    paths.dedup();
    paths
}

fn configure_storage_watchers(
    app: &AppHandle,
    watch_state: &State<'_, WatchState>,
    settings: &AppSettings,
) -> Result<(), String> {
    let paths = watchable_paths(settings);
    let mut guard = watch_state.inner.lock().map_err(|_| "无法锁定监听状态".to_string())?;

    if guard.watched_paths == paths {
        return Ok(());
    }

    guard.watchers.clear();
    guard.watched_paths.clear();

    for path in paths {
        fs::create_dir_all(&path).map_err(|err| err.to_string())?;
        let watched_path = path.clone();
        let app_handle = app.clone();
        let mut watcher = recommended_watcher(move |result: Result<notify::Event, notify::Error>| {
            if let Ok(event) = result {
                let changed_path = event
                    .paths
                    .first()
                    .map(|value| value.to_string_lossy().to_string())
                    .unwrap_or_else(|| watched_path.to_string_lossy().to_string());
                let _ = app_handle.emit(STORAGE_CHANGED_EVENT, changed_path);
            }
        })
        .map_err(|err| err.to_string())?;

        watcher
            .watch(&path, RecursiveMode::Recursive)
            .map_err(|err| err.to_string())?;

        guard.watched_paths.push(path);
        guard.watchers.push(watcher);
    }

    Ok(())
}

fn scan_installed_skills(
    settings: &AppSettings,
) -> Result<HashMap<String, InstalledSkillInfo>, String> {
    let install_path = match resolve_install_path(settings) {
        Ok(path) => path,
        Err(_) => return Ok(HashMap::new()),
    };
    if !install_path.exists() {
        return Ok(HashMap::new());
    }

    let mut result = HashMap::new();
    for entry in fs::read_dir(&install_path).map_err(|err| err.to_string())? {
        let entry = entry.map_err(|err| err.to_string())?;
        let path = entry.path();
        if !path.is_dir() {
            continue;
        }

        if !path.join("SKILL.md").exists() {
            continue;
        }

        let metadata = read_metadata(&path)?;
        let install_mode = metadata_install_mode(metadata.as_ref(), &path);
        let actual_path = metadata_actual_path(metadata.as_ref(), &path);
        let install_path = metadata_install_path(metadata.as_ref(), &path);
        let skill_id = metadata
            .as_ref()
            .map(|value| value.skill_id.clone())
            .unwrap_or_else(|| reverse_safe_dir_name(&entry.file_name().to_string_lossy()));
        let is_local_modified = detect_local_modified(&actual_path, metadata.as_ref())?;

        result.insert(
            skill_id,
            InstalledSkillInfo {
                metadata,
                is_local_modified,
                install_mode,
                install_path,
                actual_path,
            },
        );
    }

    Ok(result)
}

fn get_visible_skill_dir(settings: &AppSettings, skill_id: &str) -> Result<PathBuf, String> {
    Ok(resolve_install_path(settings)?.join(safe_dir_name(skill_id)))
}

fn get_existing_install_info(
    settings: &AppSettings,
    skill_id: &str,
) -> Result<Option<InstalledSkillInfo>, String> {
    Ok(scan_installed_skills(settings)?.remove(skill_id))
}

fn remove_installed_skill_paths(visible_path: &Path, actual_path: &Path) -> Result<(), String> {
    if visible_path.exists() {
        if visible_path != actual_path {
            #[cfg(target_family = "windows")]
            {
                let command = format!(r#"rmdir "{}""#, visible_path.display());
                let status = Command::new("cmd")
                    .args(["/C", &command])
                    .stdout(Stdio::null())
                    .stderr(Stdio::null())
                    .status()
                    .map_err(|err| err.to_string())?;
                if !status.success() {
                    return Err("删除目录引用失败".to_string());
                }
            }
            #[cfg(not(target_family = "windows"))]
            {
                fs::remove_file(visible_path).map_err(|err| err.to_string())?;
            }
        } else {
            remove_link_path(visible_path)?;
        }
    }

    if actual_path != visible_path && actual_path.exists() {
        fs::remove_dir_all(actual_path).map_err(|err| err.to_string())?;
    }

    Ok(())
}

fn resolve_skill_target_paths(
    settings: &AppSettings,
    skill_id: &str,
    preferred_mode: InstallMode,
    existing: Option<&InstalledSkillInfo>,
) -> Result<(PathBuf, PathBuf, InstallMode), String> {
    let visible_path = existing
        .map(|info| info.install_path.clone())
        .unwrap_or_else(|| get_visible_skill_dir(settings, skill_id).unwrap_or_default());

    let resolved_visible_path = if visible_path.as_os_str().is_empty() {
        get_visible_skill_dir(settings, skill_id)?
    } else {
        visible_path
    };

    let mode = existing
        .map(|info| info.install_mode)
        .unwrap_or(preferred_mode);

    let actual_path = if let Some(info) = existing {
        info.actual_path.clone()
    } else if mode == InstallMode::Reference {
        ensure_storage_root(settings)?.join(safe_dir_name(skill_id))
    } else {
        resolved_visible_path.clone()
    };

    Ok((resolved_visible_path, actual_path, mode))
}

fn settings_require_install_migration(previous: &AppSettings, next: &AppSettings) -> bool {
    previous.agent_type != next.agent_type
        || previous.install_scope != next.install_scope
        || previous.project_root != next.project_root
        || previous.storage_root != next.storage_root
        || previous.install_mode != next.install_mode
}

fn path_is_within(child: &Path, root: &Path) -> bool {
    child.starts_with(root)
}

fn migrate_installed_skills(previous: &AppSettings, next: &AppSettings) -> Result<(), String> {
    if !settings_require_install_migration(previous, next) {
        return Ok(());
    }

    let installed = scan_installed_skills(previous)?;
    if installed.is_empty() {
        return Ok(());
    }

    let old_storage_root = ensure_storage_root(previous).ok();
    let new_storage_root = ensure_storage_root(next).ok();
    let new_install_root = ensure_install_dir(next)?;

    for (skill_id, info) in installed {
        let old_visible = info.install_path;
        let old_actual = info.actual_path;
        let install_mode = info.install_mode;
        let new_visible = new_install_root.join(safe_dir_name(&skill_id));

        let mut new_actual = if install_mode == InstallMode::Reference {
            if let Some(root) = &new_storage_root {
                root.join(safe_dir_name(&skill_id))
            } else {
                old_actual.clone()
            }
        } else {
            new_visible.clone()
        };

        if install_mode == InstallMode::Reference {
            if let (Some(old_root), Some(new_root)) = (&old_storage_root, &new_storage_root) {
                if path_is_within(&old_actual, old_root) && old_root != new_root {
                    if old_actual.exists() {
                        move_dir_recursive(&old_actual, &new_actual)?;
                    }
                } else {
                    new_actual = old_actual.clone();
                }
            } else {
                new_actual = old_actual.clone();
            }

            if old_visible.exists() && old_visible != new_visible {
                if old_visible != old_actual {
                    #[cfg(target_family = "windows")]
                    {
                        let command = format!(r#"rmdir "{}""#, old_visible.display());
                        let status = Command::new("cmd")
                            .args(["/C", &command])
                            .stdout(Stdio::null())
                            .stderr(Stdio::null())
                            .status()
                            .map_err(|err| err.to_string())?;
                        if !status.success() {
                            return Err("删除旧目录引用失败".to_string());
                        }
                    }
                    #[cfg(not(target_family = "windows"))]
                    {
                        fs::remove_file(&old_visible).map_err(|err| err.to_string())?;
                    }
                } else {
                    remove_link_path(&old_visible)?;
                }
            }
            if let Some(parent) = new_visible.parent() {
                fs::create_dir_all(parent).map_err(|err| err.to_string())?;
            }
            create_reference_link(&new_actual, &new_visible)?;
        } else {
            if old_actual.exists() && old_actual != new_actual {
                move_dir_recursive(&old_actual, &new_actual)?;
            }
            if old_visible.exists() && old_visible != old_actual && old_visible != new_visible {
                remove_link_path(&old_visible)?;
            }
        }

        let metadata_target = if install_mode == InstallMode::Reference {
            &new_actual
        } else {
            &new_visible
        };
        if let Some(mut metadata) = read_metadata(metadata_target)? {
            metadata.install_mode = Some(install_mode.as_str().to_string());
            metadata.install_path = Some(new_visible.to_string_lossy().to_string());
            metadata.actual_path = Some(new_actual.to_string_lossy().to_string());
            write_metadata(metadata_target, &metadata)?;
        }
    }

    Ok(())
}

async fn attach_installation_state(
    settings: &AppSettings,
    skills: &mut [Skill],
) -> Result<(), String> {
    let installed = scan_installed_skills(settings)?;
    let client = create_http_client(&settings.github_token)?;

    for skill in skills.iter_mut() {
        let Some(info) = installed.get(&skill.id) else {
            continue;
        };

        skill.is_installed = Some(true);
        skill.is_local_modified = Some(info.is_local_modified);
        skill.install_mode = Some(info.install_mode.as_str().to_string());
        skill.install_path = Some(info.install_path.to_string_lossy().to_string());
        skill.actual_path = Some(info.actual_path.to_string_lossy().to_string());
        if let Some(metadata) = &info.metadata {
            skill.installed_version = Some(metadata.installed_version.clone());
            if !info.is_local_modified {
                if let Ok(Some((sha, timestamp))) = fetch_latest_commit(
                    &client,
                    &metadata.repo_owner,
                    &metadata.repo_name,
                    &metadata.branch,
                    &metadata.skill_path,
                )
                .await
                {
                    skill.commit_sha = Some(sha.clone());
                    skill.last_updated = Some(timestamp);
                    skill.has_update = Some(metadata.installed_version != sha);
                }
            }
        }
    }

    Ok(())
}

async fn fetch_skill_files_recursive(
    client: &Client,
    owner: &str,
    repo: &str,
    path: &str,
    base_path: &str,
) -> Result<Vec<RepoFile>, String> {
    let mut files = Vec::new();
    let mut pending_paths = vec![path.to_string()];

    while let Some(current_path) = pending_paths.pop() {
        let items = fetch_github_contents(client, owner, repo, &current_path).await?;

        for item in items {
            if item.item_type == "file" {
                let relative_path = item
                    .path
                    .strip_prefix(base_path)
                    .unwrap_or(&item.path)
                    .trim_start_matches('/')
                    .to_string();
                files.push(RepoFile {
                    path: item.path,
                    relative_path,
                });
            } else if item.item_type == "dir" {
                pending_paths.push(item.path);
            }
        }
    }

    Ok(files)
}

async fn install_skill_internal(
    app: Option<&AppHandle>,
    settings: &AppSettings,
    skill: &Skill,
    operation: &str,
    preferred_mode: InstallMode,
    existing: Option<&InstalledSkillInfo>,
) -> Result<Option<String>, String> {
    let owner = skill
        .repo_owner
        .as_deref()
        .ok_or_else(|| "技能缺少 repoOwner".to_string())?;
    let repo = skill
        .repo_name
        .as_deref()
        .ok_or_else(|| "技能缺少 repoName".to_string())?;
    let branch = skill
        .branch
        .as_deref()
        .ok_or_else(|| "技能缺少 branch".to_string())?;
    let skill_path = skill
        .skill_path
        .as_deref()
        .ok_or_else(|| "技能缺少 skillPath".to_string())?;

    let _ = ensure_install_dir(settings)?;
    let (visible_path, actual_path, mode) =
        resolve_skill_target_paths(settings, &skill.id, preferred_mode, existing)?;
    remove_installed_skill_paths(&visible_path, &actual_path)?;
    fs::create_dir_all(&actual_path).map_err(|err| err.to_string())?;

    let result = async {
        let client = create_http_client(&settings.github_token)?;
        let files =
            fetch_skill_files_recursive(&client, owner, repo, skill_path, skill_path).await?;
        if files.is_empty() {
            return Err("没有找到可安装的文件".to_string());
        }

        if let Some(app_handle) = app {
            emit_operation_progress(
                app_handle,
                &skill.id,
                &skill.name,
                operation,
                format!("正在同步 {} 的文件...", skill.name),
                0,
                files.len(),
                false,
            );
        }

        let total = files.len();
        let mut completed = 0;
        for file in files {
            let target_path = actual_path.join(&file.relative_path);
            if let Some(parent) = target_path.parent() {
                fs::create_dir_all(parent).map_err(|err| err.to_string())?;
            }

            let content = fetch_raw_text(&client, owner, repo, branch, &file.path).await?;
            fs::write(&target_path, content).map_err(|err| err.to_string())?;
            completed += 1;
            if let Some(app_handle) = app {
                emit_operation_progress(
                    app_handle,
                    &skill.id,
                    &skill.name,
                    operation,
                    format!("正在同步文件 {completed}/{total}"),
                    completed,
                    total,
                    false,
                );
            }
        }

        let manifest = build_manifest(&actual_path)?;
        let installed_version = fetch_latest_commit(&client, owner, repo, branch, skill_path)
            .await?
            .map(|value| value.0)
            .unwrap_or_else(|| "unknown".to_string());

        initialize_git_repo(&actual_path);

        let mut install_mode = mode;
        let mut warning = None;
        if mode == InstallMode::Reference {
            match create_reference_link(&actual_path, &visible_path) {
                Ok(()) => {}
                Err(error) => {
                    copy_dir_recursive(&actual_path, &visible_path)?;
                    fs::remove_dir_all(&actual_path).map_err(|err| err.to_string())?;
                    install_mode = InstallMode::Copy;
                    warning = Some(format!("目录引用创建失败，已回退为复制安装: {error}"));
                }
            }
        }

        let metadata = SkillMetadata {
            skill_id: skill.id.clone(),
            installed_version,
            installed_at: now_unix_secs(),
            source: skill.source.clone().unwrap_or_default(),
            repo_owner: owner.to_string(),
            repo_name: repo.to_string(),
            skill_path: skill_path.to_string(),
            branch: branch.to_string(),
            manifest,
            install_mode: Some(install_mode.as_str().to_string()),
            install_path: Some(visible_path.to_string_lossy().to_string()),
            actual_path: Some(if install_mode == InstallMode::Reference {
                actual_path.to_string_lossy().to_string()
            } else {
                visible_path.to_string_lossy().to_string()
            }),
        };
        let metadata_target = if install_mode == InstallMode::Reference {
            &actual_path
        } else {
            &visible_path
        };
        write_metadata(metadata_target, &metadata)?;
        if let Some(app_handle) = app {
            emit_operation_progress(
                app_handle,
                &skill.id,
                &skill.name,
                operation,
                format!("{} 已完成", skill.name),
                total,
                total,
                true,
            );
        }
        Ok(warning)
    }
    .await;

    if result.is_err() {
        let _ = remove_installed_skill_paths(&visible_path, &actual_path);
    }

    result
}

fn resolve_installed_skill_paths(
    settings: &AppSettings,
    skill_id: &str,
) -> Result<(PathBuf, PathBuf, InstallMode), String> {
    if let Some(existing) = get_existing_install_info(settings, skill_id)? {
        return Ok((existing.install_path, existing.actual_path, existing.install_mode));
    }

    let visible_path = get_visible_skill_dir(settings, skill_id)?;
    Ok((visible_path.clone(), visible_path, InstallMode::Copy))
}

#[tauri::command]
pub async fn load_marketplace(
    app: AppHandle,
    watch_state: State<'_, WatchState>,
    force_refresh: bool,
) -> Result<MarketplacePayload, String> {
    let settings = load_settings(&app)?;
    configure_storage_watchers(&app, &watch_state, &settings)?;
    let source_configs = load_source_configs()?;
    let (mut skills, source_statuses, from_cache, warning) =
        get_skills_with_cache(&settings, &source_configs, force_refresh).await?;
    attach_installation_state(&settings, &mut skills).await?;
    let warning = merge_warnings(warning, hydrate_translations(&settings, &mut skills).await?);

    let resolved_install_path = resolve_install_path(&settings)
        .map(|path| path.to_string_lossy().to_string())
        .unwrap_or_default();
    let resolved_storage_path = ensure_storage_root(&settings)
        .map(|path| path.to_string_lossy().to_string())
        .unwrap_or_default();

    Ok(MarketplacePayload {
        settings,
        source_configs,
        source_statuses,
        skills,
        resolved_install_path,
        resolved_storage_path,
        warning,
        from_cache,
    })
}

#[tauri::command]
pub async fn save_settings(
    app: AppHandle,
    watch_state: State<'_, WatchState>,
    settings: AppSettings,
) -> Result<AppSettings, String> {
    let previous = load_settings(&app).unwrap_or_default();
    migrate_installed_skills(&previous, &settings)?;
    save_settings_to_store(&app, &settings)?;
    configure_storage_watchers(&app, &watch_state, &settings)?;
    Ok(settings)
}

#[tauri::command]
pub async fn install_skill(app: AppHandle, skill: Skill) -> Result<OperationResult, String> {
    let settings = load_settings(&app)?;
    let warning = match install_skill_internal(
        Some(&app),
        &settings,
        &skill,
        "install",
        InstallMode::from_settings(&settings.install_mode),
        None,
    )
    .await
    {
        Ok(value) => value,
        Err(error) => {
            emit_operation_progress(
                &app,
                &skill.id,
                &skill.name,
                "install",
                error.clone(),
                1,
                1,
                true,
            );
            return Err(error);
        }
    };
    Ok(OperationResult {
        message: format!("已安装 {}", skill.name),
        warning,
    })
}

#[tauri::command]
pub async fn update_skill(app: AppHandle, skill: Skill) -> Result<OperationResult, String> {
    let settings = load_settings(&app)?;
    let existing = get_existing_install_info(&settings, &skill.id)?;
    let preferred_mode = existing
        .as_ref()
        .map(|value| value.install_mode)
        .unwrap_or_else(|| InstallMode::from_settings(&settings.install_mode));
    let warning = match install_skill_internal(
        Some(&app),
        &settings,
        &skill,
        "update",
        preferred_mode,
        existing.as_ref(),
    )
    .await
    {
        Ok(value) => value,
        Err(error) => {
            emit_operation_progress(
                &app,
                &skill.id,
                &skill.name,
                "update",
                error.clone(),
                1,
                1,
                true,
            );
            return Err(error);
        }
    };
    Ok(OperationResult {
        message: format!("已更新 {}", skill.name),
        warning,
    })
}

#[tauri::command]
pub async fn restore_skill(app: AppHandle, skill: Skill) -> Result<OperationResult, String> {
    let settings = load_settings(&app)?;
    let existing = get_existing_install_info(&settings, &skill.id)?;
    let mut warning = None;

    if let Some(info) = existing.as_ref() {
        emit_operation_progress(
            &app,
            &skill.id,
            &skill.name,
            "restore",
            format!("正在恢复 {} 的官方版本...", skill.name),
            0,
            1,
            false,
        );
        if restore_from_git(&info.actual_path) {
            emit_operation_progress(
                &app,
                &skill.id,
                &skill.name,
                "restore",
                format!("{} 已恢复完成", skill.name),
                1,
                1,
                true,
            );
            return Ok(OperationResult {
                message: format!("已恢复 {} 的官方版本", skill.name),
                warning: None,
            });
        }

        warning = Some("本地 Git 基线不可用，已改为重新下载安装官方版本。".to_string());
    }

    let preferred_mode = existing
        .as_ref()
        .map(|value| value.install_mode)
        .unwrap_or_else(|| InstallMode::from_settings(&settings.install_mode));
    let reinstall_warning = install_skill_internal(
        Some(&app),
        &settings,
        &skill,
        "restore",
        preferred_mode,
        existing.as_ref(),
    )
    .await
    .map_err(|error| {
        emit_operation_progress(
            &app,
            &skill.id,
            &skill.name,
            "restore",
            error.clone(),
            1,
            1,
            true,
        );
        error
    })?;
    let warning = match (warning, reinstall_warning) {
        (Some(left), Some(right)) => Some(format!("{left}\n{right}")),
        (Some(left), None) => Some(left),
        (None, Some(right)) => Some(right),
        (None, None) => None,
    };
    Ok(OperationResult {
        message: format!("已恢复 {} 的官方版本", skill.name),
        warning,
    })
}

#[tauri::command]
pub fn uninstall_skill(app: AppHandle, skill_id: String) -> Result<OperationResult, String> {
    let settings = load_settings(&app)?;
    emit_operation_progress(
        &app,
        &skill_id,
        &skill_id,
        "uninstall",
        "正在删除技能...".to_string(),
        0,
        1,
        false,
    );
    let (visible_path, actual_path, _) = resolve_installed_skill_paths(&settings, &skill_id)?;
    if let Err(error) = remove_installed_skill_paths(&visible_path, &actual_path) {
        emit_operation_progress(
            &app,
            &skill_id,
            &skill_id,
            "uninstall",
            error.clone(),
            1,
            1,
            true,
        );
        return Err(error);
    }
    emit_operation_progress(
        &app,
        &skill_id,
        &skill_id,
        "uninstall",
        "技能已删除".to_string(),
        1,
        1,
        true,
    );

    Ok(OperationResult {
        message: "技能已删除".to_string(),
        warning: None,
    })
}

#[tauri::command]
pub fn save_skill_readme(
    app: AppHandle,
    skill_id: String,
    markdown: String,
) -> Result<OperationResult, String> {
    let settings = load_settings(&app)?;
    let (_, actual_path, install_mode) = resolve_installed_skill_paths(&settings, &skill_id)?;
    let readme_path = actual_path.join("SKILL.md");
    if !readme_path.exists() {
        return Err("未找到本地 SKILL.md".to_string());
    }

    fs::write(&readme_path, markdown).map_err(|err| err.to_string())?;

    let metadata_target = if install_mode == InstallMode::Reference {
        actual_path.clone()
    } else {
        get_visible_skill_dir(&settings, &skill_id)?
    };
    if let Some(mut metadata) = read_metadata(&metadata_target)? {
        metadata.manifest = build_manifest(&metadata_target)?;
        write_metadata(&metadata_target, &metadata)?;
    }

    Ok(OperationResult {
        message: "本地 README 已保存".to_string(),
        warning: None,
    })
}

#[tauri::command]
pub async fn get_skill_detail(app: AppHandle, skill: Skill) -> Result<SkillDetail, String> {
    let settings = load_settings(&app)?;
    if let Ok((_, actual_path, _)) = resolve_installed_skill_paths(&settings, &skill.id) {
        if actual_path.exists() {
            let readme_path = actual_path.join("SKILL.md");
            if readme_path.exists() {
                let markdown = fs::read_to_string(&readme_path).map_err(|err| err.to_string())?;
                return Ok(SkillDetail {
                    markdown,
                    source_url: skill.repo_link.unwrap_or_default(),
                    local_path: Some(readme_path.to_string_lossy().to_string()),
                });
            }
        }
    }

    let owner = skill
        .repo_owner
        .as_deref()
        .ok_or_else(|| "技能缺少 repoOwner".to_string())?;
    let repo = skill
        .repo_name
        .as_deref()
        .ok_or_else(|| "技能缺少 repoName".to_string())?;
    let branch = skill
        .branch
        .as_deref()
        .ok_or_else(|| "技能缺少 branch".to_string())?;
    let skill_path = skill
        .skill_path
        .as_deref()
        .ok_or_else(|| "技能缺少 skillPath".to_string())?;

    let client = create_http_client(&settings.github_token)?;
    let markdown = fetch_raw_text(
        &client,
        owner,
        repo,
        branch,
        &format!("{skill_path}/SKILL.md"),
    )
    .await?;

    Ok(SkillDetail {
        markdown,
        source_url: skill.repo_link.unwrap_or_default(),
        local_path: None,
    })
}
