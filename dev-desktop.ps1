param(
    [switch]$SkipInstall
)

Set-StrictMode -Version Latest
$ErrorActionPreference = "Stop"

$repoRoot = Split-Path -Parent $MyInvocation.MyCommand.Path
Set-Location $repoRoot

function Assert-Command {
    param(
        [Parameter(Mandatory = $true)]
        [string]$Name
    )

    if (-not (Get-Command $Name -ErrorAction SilentlyContinue)) {
        throw "缺少必要命令: $Name"
    }
}

function Get-VsDevCmdPath {
    $candidates = New-Object System.Collections.Generic.List[string]

    $vswhere = "C:\Program Files (x86)\Microsoft Visual Studio\Installer\vswhere.exe"
    if (Test-Path $vswhere) {
        $installPath = & $vswhere -latest -products * -requires Microsoft.VisualStudio.Component.VC.Tools.x86.x64 -property installationPath
        if ($installPath) {
            $candidates.Add((Join-Path $installPath "Common7\Tools\VsDevCmd.bat"))
        }
    }

    @(
        "C:\Program Files\Microsoft Visual Studio\18\Insiders\Common7\Tools\VsDevCmd.bat",
        "C:\Program Files\Microsoft Visual Studio\2022\BuildTools\Common7\Tools\VsDevCmd.bat",
        "C:\Program Files\Microsoft Visual Studio\2022\Community\Common7\Tools\VsDevCmd.bat",
        "C:\Program Files\Microsoft Visual Studio\2022\Professional\Common7\Tools\VsDevCmd.bat",
        "C:\Program Files\Microsoft Visual Studio\2022\Enterprise\Common7\Tools\VsDevCmd.bat"
    ) | ForEach-Object { $candidates.Add($_) }

    foreach ($candidate in $candidates) {
        if (Test-Path $candidate) {
            return $candidate
        }
    }

    throw "未找到 VsDevCmd.bat。请先安装 Visual Studio Build Tools，并包含 C++ 桌面构建工具。"
}

function Import-MsvcEnvironment {
    $linkPaths = & where.exe link 2>$null
    if ($LASTEXITCODE -eq 0 -and $linkPaths) {
        return
    }

    $vsDevCmd = Get-VsDevCmdPath
    Write-Host "载入 VS 开发环境: $vsDevCmd"

    $envOutput = & cmd.exe /d /c "`"$vsDevCmd`" -arch=x64 -host_arch=x64 >nul && set"
    if ($LASTEXITCODE -ne 0) {
        throw "VsDevCmd.bat 执行失败。"
    }

    foreach ($line in $envOutput) {
        if ($line -match "^(.*?)=(.*)$") {
            Set-Item -Path ("Env:" + $matches[1]) -Value $matches[2]
        }
    }

    $linkPaths = & where.exe link 2>$null
    if ($LASTEXITCODE -ne 0 -or -not $linkPaths) {
        throw "MSVC 链接器未生效，仍然找不到 link.exe。"
    }

    $firstLinkPath = @($linkPaths)[0]
    Write-Host "已启用 MSVC: $firstLinkPath"
}

function Clear-StaleDevServer {
    $connections = Get-NetTCPConnection -LocalPort 1420 -State Listen -ErrorAction SilentlyContinue
    if (-not $connections) {
        return
    }

    $processIds = $connections | Select-Object -ExpandProperty OwningProcess -Unique
    foreach ($processId in $processIds) {
        $process = Get-Process -Id $processId -ErrorAction SilentlyContinue
        if (-not $process) {
            continue
        }

        if ($process.ProcessName -in @("esbuild", "node")) {
            Write-Host "检测到残留开发服务器，占用 1420 端口，正在停止: $($process.ProcessName) ($processId)"
            Stop-Process -Id $processId -Force -ErrorAction SilentlyContinue
        }
        else {
            throw "1420 端口已被其他进程占用: $($process.ProcessName) ($processId)。请先手动关闭后再运行。"
        }
    }

    Start-Sleep -Seconds 1
}

Assert-Command -Name "node"
Assert-Command -Name "npm"
Assert-Command -Name "cargo"

$nodeModulesDir = Join-Path $repoRoot "node_modules"
if (-not $SkipInstall -and -not (Test-Path -LiteralPath $nodeModulesDir -PathType Container)) {
    Write-Host "未检测到 node_modules，正在执行 npm install..."
    & npm.cmd install
    if ($LASTEXITCODE -ne 0) {
        throw "npm install 失败。"
    }
}

Import-MsvcEnvironment
Clear-StaleDevServer

Write-Host ""
Write-Host "启动桌面热更新开发环境..."
Write-Host "请保持这个终端窗口开启。"
Write-Host "修改 src/ 或 src-tauri/ 下的文件后，桌面应用会自动重新编译。"
Write-Host "按 Ctrl+C 可以停止开发环境。"
Write-Host ""

& npm.cmd run tauri:dev
if ($LASTEXITCODE -ne 0) {
    throw "npm run tauri:dev 失败。"
}
