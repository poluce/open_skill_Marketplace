// 初始化 UI 状态
document.getElementById("langSelect").value = currentLanguage;
document.getElementById("aiCategoriesToggle").checked = showAiCategories;
document.getElementById("agentTypeSelect").value = currentAgentType || "antigravity";
document.getElementById("scopeSelect").value = currentScope || "global";
updateAiCategoriesVisibility();

function onAgentTypeChange() {
    currentAgentType = document.getElementById("agentTypeSelect").value;
    vscode.postMessage({ command: "setAgentType", agentType: currentAgentType });
    saveState();
}

function onScopeChange() {
    currentScope = document.getElementById("scopeSelect").value;
    vscode.postMessage({ command: "setScope", scope: currentScope });
    saveState();
}

function saveState() {
    vscode.setState({
        category: currentCategory,
        source: currentSourceFilter,
        tab: currentTab,
        language: currentLanguage,
        showAiCategories: showAiCategories,
        agentType: currentAgentType,
        scope: currentScope
    });
}

function onToggleAiCategories() {
    showAiCategories = document.getElementById("aiCategoriesToggle").checked;
    vscode.postMessage({
        command: "setShowAiCategories",
        show: showAiCategories,
    });
    updateAiCategoriesVisibility();

    // 如果当前正好选中了被隐藏的 AI 分类，自动切回“全部”
    const aiCategories = ["编程", "办公", "创意", "分析", "生活"];
    if (!showAiCategories && aiCategories.includes(currentCategory)) {
        setCategory("全部");
    } else {
        updateUI();
    }
    saveState();
}

function updateAiCategoriesVisibility() {
    const chips = document.querySelectorAll(".ai-category");
    chips.forEach((chip) => {
        chip.style.display = showAiCategories ? "block" : "none";
    });
}

function configureToken() {
    vscode.postMessage({ command: "configureToken" });
}

function onLangChange() {
    currentLanguage = document.getElementById("langSelect").value;
    vscode.postMessage({ command: "setLanguage", lang: currentLanguage });
    updateUI();
    saveState();
}

function updateUI() {
    const query = document.getElementById("searchInput").value.toLowerCase();
    const list = document.getElementById("skillList");

    // 只有在有数据或明确显示为空时才清空，避免加载中闪烁
    const loader = document.getElementById("loader");
    if (skills.length > 0 || (loader && loader.style.display === "none")) {
        list.innerHTML = "";
    } else if (loader) {
        return; // 还在加载中且无数据
    }

    const filtered = skills.filter((s) => {
        const matchesQuery =
            s.name.toLowerCase().includes(query) ||
            s.desc.toLowerCase().includes(query);

        // 分类逻辑重构：如果开启了 AI 分类且存在 aiCategory，则优先使用它
        const actualCategory =
            showAiCategories && s.aiCategory ? s.aiCategory : s.category;

        // 过滤逻辑：如果选中“高赞”，展示所有 isFeatured 技能；否则匹配选中分类
        const matchesCategory =
            currentCategory === "全部" ||
            (currentCategory === "高赞"
                ? s.isFeatured
                : actualCategory === currentCategory);

        const matchesSource =
            currentCategory !== "高赞" ||
            currentSourceFilter === "全部" ||
            s.source === currentSourceFilter;
        return matchesQuery && matchesCategory && matchesSource;
    });

    // 分离并更新 Tab 计数
    const installed = filtered.filter((s) => s.isInstalled);
    const available = filtered.filter((s) => !s.isInstalled);

    document.getElementById("countAvailable").innerText = available.length;
    document.getElementById("countInstalled").innerText = installed.length;

    // 'available' Tab 显示全量技能（方便安装后直接管理），'installed' 只显示已安装
    const displayList = currentTab === "installed" ? installed : filtered;

    if (displayList.length === 0) {
        list.innerHTML = `<div style="text-align:center; padding: 40px; opacity:0.5;">
                ${currentTab === "installed" ? "暂无已安装技能" : "未发现匹配的技能"}
            </div>`;
        return;
    }

    displayList.forEach((s) => list.appendChild(createSkillCard(s)));
}

function createSkillCard(s) {
    const card = document.createElement("div");
    card.className = s.isFeatured ? "skill-card featured" : "skill-card";
    if (s.isInstalled) {
        card.className += " installed";
    }

    const sourceMap = {
        anthropic: "Anthropic",
        openai: "OpenAI",
        huggingface: "HuggingFace",
        superpowers: "Superpowers",
        composio: "Composio",
    };
    const sourceDisplayName = sourceMap[s.source] || (s.source ? s.source.charAt(0).toUpperCase() + s.source.slice(1) : "");
    const featuredTag = s.isFeatured ? `<span class="featured-tag">赞</span>` : "";

    const repoBtn = s.isFeatured && s.repoLink
        ? `<button class="btn-outline" onclick="openRepo('${s.repoLink}')">查看</button>`
        : "";

    const actionBtn = s.isInstalled
        ? `<button class="btn-uninstall" onclick="uninstallSkill('${s.id}', '${s.name}')">删除</button>`
        : `<button class="btn-install" onclick="installSkill('${s.id}', '${s.name}')">安装</button>`;

    const openaiIcon = `<svg fill="#10a37f" viewBox="0 0 24 24" xmlns="http://www.w3.org/2000/svg" width="100%" height="100%"><rect width="24" height="24" fill="#ffffff" rx="10"/><path d="M22.2819 9.8211a5.9847 5.9847 0 0 0-.5157-4.9108 6.0462 6.0462 0 0 0-6.5098-2.9A6.0651 6.0651 0 0 0 4.9807 4.1818a5.9847 5.9847 0 0 0-3.9977 2.9 6.0462 6.0462 0 0 0 .7427 7.0966 5.98 5.98 0 0 0 .511 4.9107 6.051 6.051 0 0 0 6.5146 2.9001A5.9847 5.9847 0 0 0 13.2599 24a6.0557 6.0557 0 0 0 5.7718-4.2058 5.9894 5.9894 0 0 0 3.9977-2.9001 6.0557 6.0557 0 0 0-.7475-7.0729zm-9.022 12.6081a4.4755 4.4755 0 0 1-2.8764-1.0408l.1419-.0804 4.7783-2.7582a.7948.7948 0 0 0 .3927-.6813v-6.7369l2.02 1.1686a.071.071 0 0 1 .038.052v5.5826a4.504 4.504 0 0 1-4.4945 4.4944zm-9.6607-4.1254a4.4708 4.4708 0 0 1-.5346-3.0137l.142.0852 4.783 2.7582a.7712.7712 0 0 0 .7806 0l5.8428-3.3685v2.3324a.0804.0804 0 0 1-.0332.0615L9.74 19.9502a4.4992 4.4992 0 0 1-6.1408-1.6464zM2.3408 7.8956a4.485 4.485 0 0 1 2.3655-1.9728V11.6a.7664.7664 0 0 0 .3879.6765l5.8144 3.3543-2.0201 1.1685a.0757.0757 0 0 1-.071 0l-4.8303-2.7865A4.504 4.504 0 0 1 2.3408 7.872zm16.5963 3.8558L13.1038 8.364 15.1192 7.2a.0757.0757 0 0 1 .071 0l4.8303 2.7913a4.4944 4.4944 0 0 1-.6765 8.1042v-5.6772a.79.79 0 0 0-.407-.667zm2.0107-3.0231l-.142-.0852-4.7735-2.7818a.7759.7759 0 0 0-.7854 0L9.409 9.2297V6.8974a.0662.0662 0 0 1 .0284-.0615l4.8303-2.7866a4.4992 4.4992 0 0 1 6.6802 4.66zM8.3065 12.863l-2.02-1.1638a.0804.0804 0 0 1-.038-.0567V6.0742a4.4992 4.4992 0 0 1 7.3757-3.4537l-.142.0805L8.704 5.459a.7948.7948 0 0 0-.3927.6813zm1.0976-2.3654l2.602-1.4998 2.6069 1.4998v2.9994l-2.5974 1.4997-2.6067-1.4997Z"/></svg>`;
    const anthropicIcon = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100" width="100%" height="100%"><rect width="100" height="100" fill="#D7764F" rx="10"/><g fill="#000"><path d="M40,25 L20,75 L28,75 L48,25 Z"/><path d="M48,25 L68,75 L60,75 L40,25 Z"/><path d="M28,58 L52,58 L54,63 L30,63 Z"/><path d="M62,25 L70,25 L90,75 L82,75 Z"/></g></svg>`;

    const isAnthropic = s.repoLink && s.repoLink.includes("anthropics/skills");
    const isOpenAI = s.repoLink && s.repoLink.includes("openai/skills");

    let iconContent = s.icon;
    let bgStyle = `background: linear-gradient(135deg, ${s.colors[0]}, ${s.colors[1]})`;

    if (isAnthropic) {
        iconContent = anthropicIcon;
        bgStyle = "background: none; box-shadow: none;";
    } else if (isOpenAI) {
        iconContent = openaiIcon;
        bgStyle = "background: none; box-shadow: none;";
    }

    card.innerHTML = `
        <div class="skill-card-content">
            <div class="skill-icon" style="${bgStyle}">${iconContent}</div>
            <div class="skill-info">
                <div class="skill-header">
                    <div class="skill-name">${s.name}</div>
                </div>
                <div class="skill-desc">${
                    currentLanguage === "zh-CN" && s.translatedDesc
                        ? s.translatedDesc
                        : s.desc
                }</div>
            </div>
            <div class="btn-group">
                ${repoBtn}
                ${actionBtn}
            </div>
        </div>
    `;
    return card;
}

function setCategory(cat) {
    currentCategory = cat;
    saveState();
    document.querySelectorAll(".category-chip").forEach((chip) => {
        const baseText = chip.innerText.replace("✓ ", "").trim();
        chip.classList.toggle("active", baseText === cat);
    });
    // 显示/隐藏二级筛选器
    const sourceContainer = document.getElementById("sourceFilterContainer");
    if (cat === "高赞") {
        sourceContainer.classList.add("visible");
    } else {
        sourceContainer.classList.remove("visible");
        currentSourceFilter = "全部";
        saveState();
        // 重置二级筛选器选中状态
        document.querySelectorAll(".sub-filter-chip").forEach((chip, i) => {
            chip.classList.toggle("active", i === 0);
        });
    }
    updateUI();
}

function setSourceFilter(source) {
    currentSourceFilter = source;
    saveState();
    document.querySelectorAll(".sub-filter-chip").forEach((chip) => {
        const chipSource = chip.getAttribute("data-source");
        chip.classList.toggle("active", chipSource === source);
    });
    updateUI();
}

function setTab(tab) {
    currentTab = tab;
    saveState();
    document.getElementById("tabAvailable").classList.toggle("active", tab === "available");
    document.getElementById("tabInstalled").classList.toggle("active", tab === "installed");
    updateUI();
}

function installSkill(id, name) {
    vscode.postMessage({
        command: "install",
        skillId: id,
        skillName: name,
    });
}

function uninstallSkill(id, name) {
    vscode.postMessage({
        command: "uninstall",
        skillId: id,
        skillName: name,
    });
}

function openRepo(url) {
    vscode.postMessage({ command: "openRepo", url: url });
}

updateUI();
setCategory(currentCategory);
setTab(currentTab);
updateUI();

// 通知插件 WebView 已就绪，请求全量数据同步
vscode.postMessage({ command: "ready" });

let lastMouseX = 0;
let lastMouseY = 0;

document.addEventListener('mousemove', (e) => {
    lastMouseX = e.clientX;
    lastMouseY = e.clientY;
    if (currentHoveredCard) {
        updateHoverState();
    }
});

let scrollTimeout = null;
const skillList = document.getElementById('skillList');
let currentHoveredCard = null;

function updateHoverState() {
    const elementUnderMouse = document.elementFromPoint(lastMouseX, lastMouseY);
    if (!elementUnderMouse) {
        if (currentHoveredCard) {
            currentHoveredCard.classList.remove('hovered');
            currentHoveredCard = null;
        }
        return;
    }

    const skillCard = elementUnderMouse.closest('.skill-card');
    if (skillCard === currentHoveredCard) {
        return;
    }

    if (currentHoveredCard) {
        currentHoveredCard.classList.remove('hovered');
    }

    if (skillCard) {
        skillCard.classList.add('hovered');
    }
    currentHoveredCard = skillCard;
}

function onScroll() {
    skillList.classList.add('scrolling');

    if (scrollTimeout) {
        clearTimeout(scrollTimeout);
    }

    updateHoverState();

    scrollTimeout = setTimeout(() => {
        skillList.classList.remove('scrolling');
    }, 80);
}

document.addEventListener('wheel', onScroll, { passive: true });
document.addEventListener('scroll', onScroll, { passive: true, capture: true });

skillList.addEventListener('mouseleave', () => {
    skillList.classList.remove('scrolling');
    if (currentHoveredCard) {
        currentHoveredCard.classList.remove('hovered');
        currentHoveredCard = null;
    }
});

window.addEventListener("message", (event) => {
    const message = event.data;
    switch (message.command) {
        case "updateSkills":
            skills = message.skills;
            const loader = document.getElementById("loader");
            if (loader) {
                loader.style.display = "none";
            }

            const banner = document.getElementById("warningBanner");
            if (banner) {
                banner.style.display = message.isRateLimited ? "flex" : "none";
            }

            updateUI();
            break;
        case "updateAccentColor":
            document.documentElement.style.setProperty("--accent-color", message.color);
            const glowColor = message.color.replace("rgb", "rgba").replace(")", ", 0.3)");
            document.documentElement.style.setProperty("--accent-glow", glowColor);
            break;
        case "resetLang":
            document.getElementById("langSelect").value = "";
            break;
        case "translationProgress":
            const progressContainer = document.getElementById("translationProgress");
            const progressFill = document.getElementById("progressFill");
            const progressPercent = document.getElementById("progressPercent");

            if (progressContainer && progressFill && progressPercent) {
                progressContainer.style.display = "block";
                progressFill.style.width = message.progress + "%";
                progressPercent.innerText = message.progress + "%";

                if (message.finished) {
                    setTimeout(() => {
                        progressContainer.style.opacity = "0";
                        setTimeout(() => {
                            progressContainer.style.display = "none";
                            progressContainer.style.opacity = "1";
                        }, 300);
                    }, 1000);
                }
            }
            break;
    }
});
