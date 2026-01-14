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

# 执行打包命令（静默模式，只在出错时显示详细输出）
$output = npx -y @vscode/vsce package 2>&1
$exitCode = $LASTEXITCODE

if ($exitCode -eq 0) {
    $vsixFiles = Get-ChildItem *.vsix | Sort-Object LastWriteTime -Descending | Select-Object -First 1
    if ($vsixFiles) {
        Write-Color "✅ 打包成功！" Green
        Write-Color "   文件: $($vsixFiles.Name) ($([math]::Round($vsixFiles.Length / 1KB, 2)) KB)" Green
    }
    else {
        Write-Color "✅ 命令执行成功，但未检测到 .vsix 文件。" Yellow
    }
}
else {
    Write-Color "❌ 打包失败！" Red
    Write-Host $output  # 只在失败时显示详细输出
}
