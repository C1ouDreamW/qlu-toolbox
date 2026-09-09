# 一键构建移动端:自动选择 JDK 21 -> npm run mobile:build -> npm run mobile:sync -> Gradle 单元测试 + assembleDebug
#
# 用法(仓库根目录的 PowerShell 中):
#   powershell -ExecutionPolicy Bypass -File scripts\build-mobile.ps1
#
# 说明:JAVA_HOME 只在本次脚本会话内生效,不修改系统环境变量。
# 项目要求 JDK 21(见 apps/mobile/README.md);Gradle 8.14 最高支持 Java 24,
# 用 JDK 25 会报 "Unsupported class file major version 69"。

$ErrorActionPreference = "Stop"
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

Push-Location $RepoRoot
try {
    Invoke-Step "npm run mobile:build(Web 构建)" { npm run mobile:build }
    Invoke-Step "npm run mobile:sync(Capacitor 同步)" { npm run mobile:sync }

    Set-Location (Join-Path $RepoRoot "apps\mobile\android")
    Invoke-Step "gradlew testDebugUnitTest assembleDebug(单测 + Debug 包)" {
        & .\gradlew.bat testDebugUnitTest assembleDebug
    }
} finally {
    Pop-Location
}

Write-Host ""
Write-Host "[完成] 全部通过。APK 输出目录:apps/mobile/android/app/build/outputs/apk/debug/" -ForegroundColor Green
