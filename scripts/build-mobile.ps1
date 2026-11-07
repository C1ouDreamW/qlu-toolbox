# 一键构建移动端:自动选择 JDK 21 -> npm run mobile:build -> npm run mobile:sync -> Gradle 单元测试 + assembleDebug
#
# 用法(仓库根目录的 PowerShell 中):
#   powershell -ExecutionPolicy Bypass -File scripts\build-mobile.ps1
#
# 默认固定构建独立 Debug 包 io.github.c1oudreamw.lumatile.debug，不读取正式签名。
# 可选 -SkipTests 跳过单测；旧 -AppIdSuffix / -AppLabel 仅保留用于明确提示迁移。
# JAVA_HOME 与 LUMATILE_BUILD_CHANNEL 只在本次脚本中使用。

param(
    [string]$AppIdSuffix = "",
    [string]$AppLabel = "",
    [switch]$SkipTests
)

$ErrorActionPreference = "Stop"
if ($AppIdSuffix -and $AppIdSuffix -notin @('.debug', 'debug')) {
    throw 'Debug 包固定使用 .debug，不再支持其他 AppIdSuffix。请移除旧参数。'
}
if ($AppLabel) { throw 'Debug 包固定显示为 LumaTile Debug，请移除旧 AppLabel 参数。' }
$RepoRoot = Split-Path -Parent $PSScriptRoot

function Get-JavaMajorVersion([string]$JdkHome) {
    # 返回 java 主版本号,不可用时返回 -1
    $ErrorActionPreference = "Continue"
    try {
        $out = & (Join-Path $JdkHome "bin\java.exe") -version 2>&1 | Out-String
    } catch {
        return -1
    }
    if ($out -match 'version "(\d+)\.') { return [int]$Matches[1] }
    return -1
}

# 1. 选择 JDK 21:优先沿用已配置的 JAVA_HOME,其次 Android Studio 自带 JBR,再退回常见安装目录
$candidates = @()
if ($env:JAVA_HOME) { $candidates += $env:JAVA_HOME }
$candidates += "C:\Program Files\Android\Android Studio\jbr"
foreach ($dir in @("C:\Program Files\Java", "C:\Program Files\Eclipse Adoptium", "C:\Program Files\Microsoft")) {
    $candidates += Get-ChildItem $dir -Directory -Filter "jdk-21*" -ErrorAction SilentlyContinue |
        ForEach-Object { $_.FullName }
}

$Jdk = $null
foreach ($c in $candidates) {
    if ($c -and (Test-Path (Join-Path $c "bin\java.exe")) -and ((Get-JavaMajorVersion $c) -eq 21)) {
        $Jdk = $c
        break
    }
}
if (-not $Jdk) {
    Write-Host "[失败] 未找到可用的 JDK 21。Gradle 8.14 不支持当前较新的 JDK(如 25)。" -ForegroundColor Red
    Write-Host "       请安装 JDK 21,或将 JAVA_HOME 指向 JDK 21 后重试。"
    exit 1
}
$env:JAVA_HOME = $Jdk
$env:PATH = (Join-Path $Jdk "bin") + ";" + $env:PATH
Write-Host "[环境] JAVA_HOME = $Jdk(Java $(Get-JavaMajorVersion $Jdk))"

function Invoke-Step([string]$Name, [scriptblock]$Block) {
    Write-Host ""
    Write-Host "==> $Name" -ForegroundColor Cyan
    & $Block
    if ($LASTEXITCODE -ne 0) {
        Write-Host "[失败] $Name(退出码 $LASTEXITCODE),已停止后续步骤。" -ForegroundColor Red
        exit $LASTEXITCODE
    }
}

$previousChannel = $env:LUMATILE_BUILD_CHANNEL
$env:LUMATILE_BUILD_CHANNEL = "debug"
Push-Location $RepoRoot
try {
    Invoke-Step "npm run mobile:build(Web 构建)" { npm run mobile:build }
    Invoke-Step "npm run mobile:sync(Capacitor 同步)" { npm run mobile:sync }

    $gradleTasks = @()
    if (-not $SkipTests) { $gradleTasks += "testDebugUnitTest" }
    $gradleTasks += "assembleDebug"

    Set-Location (Join-Path $RepoRoot "apps\mobile\android")
    Invoke-Step ("gradlew " + ($gradleTasks -join " ")) {
        & .\gradlew.bat @gradleTasks
    }
} finally {
    Pop-Location
    $env:LUMATILE_BUILD_CHANNEL = $previousChannel
}

Write-Host ""
Write-Host "[完成] 全部通过。APK 输出目录:apps/mobile/android/app/build/outputs/apk/debug/" -ForegroundColor Green
