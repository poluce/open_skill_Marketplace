$ErrorActionPreference = "Stop"

function Write-Color([string]$text, [ConsoleColor]$color) {
    Write-Host $text -ForegroundColor $color
}

Write-Color "📦 开始打包 VS Code 插件..." Cyan

# 检查 package.json 是否存在
if (-not (Test-Path "package.json")) {
    Write-Color "❌ 错误: 当前目录下未找到 package.json 文件。" Red
    exit 1
}

# 检查 repository 字段 (常见错误)
$packageJson = Get-Content "package.json" | ConvertFrom-Json
if (-not $packageJson.repository) {
    Write-Color "⚠️  警告: package.json 缺少 'repository' 字段，这可能导致打包挂起。" Yellow
    Write-Color "   建议手动添加 repository 字段或使用 --no-git-tag-version --allow-missing-repository 参数。" Yellow
}

Write-Color "⏳ 正在运行 npx @vscode/vsce package..." Gray

# 执行打包命令
# 使用 cmd /c 是为了更可靠地处理 npx 在不同 shell 环境下的退出代码
cmd /c "npx @vscode/vsce package"

if ($LASTEXITCODE -eq 0) {
    $vsixFiles = Get-ChildItem *.vsix | Sort-Object LastWriteTime -Descending | Select-Object -First 1
    if ($vsixFiles) {
        Write-Color "`n✅ 打包成功！" Green
        Write-Color "   生成文件: $($vsixFiles.Name)" Green
        Write-Color "   文件大小: $([math]::Round($vsixFiles.Length / 1KB, 2)) KB" Green
    } else {
        Write-Color "`n✅ 命令执行成功，但未检测到生成的 .vsix 文件。" Yellow
    }
} else {
    Write-Color "`n❌ 打包失败！" Red
    Write-Color "   退出代码: $LASTEXITCODE" Red
    Write-Color "   请检查上方的错误输出以获取详细原因。" Red
    
    # 常见错误提示
    if ($LASTEXITCODE -eq 1) {
        Write-Color "   常见原因：" Gray
        Write-Color "   1. 编译错误 (TypeScript/ESLint 检查未通过)" Gray
        Write-Color "   2. 缺少必要文件 (README.md, LICENSE 等)" Gray
        Write-Color "   3. 版本号已存在 (如果发布到市场)" Gray
    }
}
