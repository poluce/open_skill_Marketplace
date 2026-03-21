Set-StrictMode -Version Latest
$ErrorActionPreference = "Stop"

$repoRoot = Split-Path -Parent $MyInvocation.MyCommand.Path
Set-Location $repoRoot

$tauriConfigPath = Join-Path $repoRoot "src-tauri\tauri.conf.json"
$tauriConfig = Get-Content -Path $tauriConfigPath -Raw | ConvertFrom-Json
$appVersion = $tauriConfig.version

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

function Invoke-Step {
    param(
        [Parameter(Mandatory = $true)]
        [string]$Title,
        [Parameter(Mandatory = $true)]
        [scriptblock]$Action
    )

    Write-Host ""
    Write-Host "== $Title =="
    & $Action
}

Import-MsvcEnvironment

Invoke-Step -Title "前端编译" -Action {
    & npm.cmd run compile
    if ($LASTEXITCODE -ne 0) {
        throw "npm run compile 失败。"
    }
}

Invoke-Step -Title "桌面打包" -Action {
    & npm.cmd run tauri:build
    if ($LASTEXITCODE -ne 0) {
        throw "npm run tauri:build 失败。"
    }
}

$bundleRoot = Join-Path $repoRoot "src-tauri\target\release\bundle"
$msiPath = Join-Path $bundleRoot ("msi\Skill Marketplace_{0}_x64_en-US.msi" -f $appVersion)
$nsisPath = Join-Path $bundleRoot ("nsis\Skill Marketplace_{0}_x64-setup.exe" -f $appVersion)

Write-Host ""
Write-Host "打包完成。"
if (Test-Path $msiPath) {
    Write-Host "MSI : $msiPath"
}
if (Test-Path $nsisPath) {
    Write-Host "NSIS: $nsisPath"
}
