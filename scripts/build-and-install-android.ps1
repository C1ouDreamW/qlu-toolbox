#Requires -Version 5.1
# 一键构建最新 Android 代码(Debug 包)并安装到 adb 连接的设备上(Windows PowerShell 5.1 可用)
#
# 用法(仓库根目录的 PowerShell 中):
#   powershell -ExecutionPolicy Bypass -File scripts\build-and-install-android.ps1
#
# 流程:
#   1. 找到 adb 与目标设备(只有一台在线时自动选中,多台设备用 -Serial 指定);
#   2. 读设备上已装包名:若已有正式版 io.github.c1oudreamw.lumatile,
#      自动改用共存测试包(包名后缀 .test),避开 INSTALL_FAILED_UPDATE_INCOMPATIBLE;
#   3. 调 scripts\build-mobile.ps1 构建:npm run mobile:build -> mobile:sync -> Gradle 单测 + assembleDebug;
#   4. adb install -r 安装,并回读设备上的包名/版本号做验证。
#
# 参数:
#   -Serial <serial>        指定设备(adb devices 的序列号);只有一台可用设备时可省略
#   -AppIdSuffix .test      自定义包名后缀(默认在检测到同包名应用时使用 .test)
#   -AppLabel "一格有光（联调）"  共存测试包的显示名
#   -NoCoexist              强制原包名 Debug 包(与已装正式版签名不一致时通常装不上)
#   -SkipTests              跳过 testDebugUnitTest,只出包(本地快速迭代)
#   -Launch                 安装成功后启动应用
#   -DryRun                 只做前置检查并打印将要执行的命令,不构建、不安装
#
# 红线:本脚本永远不会卸载正式版 io.github.c1oudreamw.lumatile,也不清理设备数据。
# 构建与签名背景见 apps/mobile/README.md,共存测试包完整流程见 .agents/skills/lumatile-test-apk/SKILL.md。

param(
    [string]$Serial = "",
    [string]$AppIdSuffix = "",
    [string]$AppLabel = "",
    [switch]$NoCoexist,
    [switch]$SkipTests,
    [switch]$Launch,
    [switch]$DryRun
)

$ErrorActionPreference = "Stop"

$RepoRoot     = Split-Path -Parent $PSScriptRoot
$BuildScript  = Join-Path $PSScriptRoot "build-mobile.ps1"
$ApkPath      = Join-Path $RepoRoot "apps\mobile\android\app\build\outputs\apk\debug\app-debug.apk"
$ReleaseAppId = "io.github.c1oudreamw.lumatile"
# 启动组件用 namespace(不随 applicationId 后缀变化),因此共存测试包也能这样启动。
$MainActivity = "io.github.c1oudreamw.lumatile.MainActivity"

function Write-Head([string]$Text) { Write-Host ""; Write-Host "==> $Text" -ForegroundColor Cyan }
function Write-Ok([string]$Text) { Write-Host "[通过] $Text" -ForegroundColor Green }
function Write-Note([string]$Text) { Write-Host "[提示] $Text" -ForegroundColor Yellow }
function Fail([string]$Text) {
    Write-Host ""
    Write-Host "[失败] $Text" -ForegroundColor Red
    exit 1
}

# 捕获原生命令(adb / git)的 stdout:stderr 原样透传到控制台。
# 不把 stderr 并入捕获流:PowerShell 5.1 会把被重定向的 stderr 包装成带
# "At line:..." 装饰的 NativeCommandError 文本,污染后续解析。
function Invoke-Capture([string]$Exe, [string[]]$Arguments) {
    $previous = $ErrorActionPreference
    $ErrorActionPreference = "Continue"
    try {
        $out = (& $Exe @Arguments | Out-String)
        $code = $LASTEXITCODE
    } finally {
        $ErrorActionPreference = $previous
    }
    return [pscustomobject]@{ Code = $code; Output = $out.Trim() }
}

# ---------- adb ----------

function Resolve-Adb {
    $cmd = Get-Command adb -ErrorAction SilentlyContinue
    if ($cmd -and $cmd.CommandType -eq 'Application') { return $cmd.Source }
    $candidates = @()
    if ($env:ANDROID_HOME) { $candidates += (Join-Path $env:ANDROID_HOME "platform-tools\adb.exe") }
    if ($env:ANDROID_SDK_ROOT) { $candidates += (Join-Path $env:ANDROID_SDK_ROOT "platform-tools\adb.exe") }
    if ($env:LOCALAPPDATA) { $candidates += (Join-Path $env:LOCALAPPDATA "Android\Sdk\platform-tools\adb.exe") }
    foreach ($c in $candidates) {
        if ($c -and (Test-Path $c)) { return $c }
    }
    return $null
}

function Get-AdbDevices([string]$Adb) {
    $list = @()
    foreach ($line in ((Invoke-Capture $Adb @("devices")).Output -split "`r?`n")) {
        if ($line -match '^(\S+)\s+(device|unauthorized|offline|bootloader|recovery|sideload|no permissions)') {
            $list += [pscustomobject]@{ Serial = $Matches[1]; State = $Matches[2] }
        }
    }
    return $list
}

function Show-DeviceHints([object[]]$Devices) {
    $notReady = @($Devices | Where-Object { $_.State -ne 'device' })
    foreach ($d in $notReady) {
        if ($d.State -eq 'unauthorized') {
            Write-Note "设备 $($d.Serial) 未授权:请在手机上确认「允许 USB 调试」,必要时撤销 USB 调试授权后重新插拔。"
        } elseif ($d.State -eq 'offline') {
            Write-Note "设备 $($d.Serial) 状态为 offline:可执行 adb kill-server 后重新插拔数据线。"
        } else {
            Write-Note "设备 $($d.Serial) 状态为 $($d.State),当前不能安装。"
        }
    }
    if ($notReady.Count -eq 0) {
        Write-Note "没有检测到设备:请在手机上打开「开发者选项 - USB 调试」,插线后确认授权;无线调试可用 adb connect <ip:端口>。"
    }
}

function Get-ShellValue([string]$Adb, [string]$SerialValue, [string[]]$Command) {
    $result = Invoke-Capture $Adb (@("-s", $SerialValue) + $Command)
    return $result.Output
}

function Get-InstalledPackages([string]$Adb, [string]$SerialValue) {
    $out = Get-ShellValue $Adb $SerialValue @("shell", "pm", "list", "packages")
    $set = @{}
    foreach ($line in ($out -split "`r?`n")) {
        if ($line -match '^package:(.+?)\s*$') { $set[$Matches[1]] = $true }
    }
    return $set
}

function Get-InstalledVersion([string]$Adb, [string]$SerialValue, [string]$PackageId) {
    $out = Get-ShellValue $Adb $SerialValue @("shell", "dumpsys", "package", $PackageId)
    if ($out -match 'versionName=(\S+)') { return $Matches[1] }
    return ""
}

function Invoke-AdbInstall([string]$Adb, [string]$SerialValue, [string]$Apk, [string[]]$Extra = @()) {
    return Invoke-Capture $Adb (@("-s", $SerialValue, "install", "-r") + $Extra + @($Apk))
}

function Test-InstallSuccess([object]$Result) {
    return ($Result.Code -eq 0) -and ($Result.Output -match 'Success')
}

# ---------- 构建来源信息(仅用于日志,失败不影响流程) ----------

function Get-SourceInfo {
    if (-not (Get-Command git -ErrorAction SilentlyContinue)) { return "" }
    $sha = (Invoke-Capture "git" @("-C", $RepoRoot, "rev-parse", "--short", "HEAD")).Output
    if (-not $sha) { return "" }
    $dirty = (Invoke-Capture "git" @("-C", $RepoRoot, "status", "--porcelain")).Output
    if ($dirty) { return "$sha(含未提交改动)" }
    return $sha
}

# ---------- 1. 前置检查:adb 与设备 ----------

Write-Head "检查 adb 与设备"

$Adb = Resolve-Adb
if (-not $Adb) {
    Fail "未找到 adb。请安装 Android SDK Platform-Tools,或把 platform-tools 加入 PATH(常见位置:%LOCALAPPDATA%\Android\Sdk\platform-tools)。"
}
Write-Host "adb: $Adb"

$devices = @(Get-AdbDevices $Adb)
$ready = @($devices | Where-Object { $_.State -eq 'device' })

$Target = $null
if ($Serial) {
    $match = @($devices | Where-Object { $_.Serial -eq $Serial })
    if ($match.Count -eq 0) {
        Show-DeviceHints $devices
        $seen = @($devices | ForEach-Object { $_.Serial + '(' + $_.State + ')' }) -join ', '
        Fail "指定的设备 $Serial 未连接。当前检测到:$seen"
    }
    if ($match[0].State -ne 'device') {
        Show-DeviceHints $devices
        Fail "设备 $Serial 状态为 $($match[0].State),不能安装。"
    }
    $Target = $match[0]
} elseif ($ready.Count -eq 1) {
    $Target = $ready[0]
} elseif ($ready.Count -eq 0) {
    Show-DeviceHints $devices
    Fail "没有可用的 adb 设备,无法安装。"
} else {
    Write-Host "检测到多台可用设备,请选择目标(或用 -Serial 指定):"
    for ($i = 0; $i -lt $ready.Count; $i++) {
        Write-Host ("  [{0}] {1}" -f ($i + 1), $ready[$i].Serial)
    }
    try {
        $choice = Read-Host "输入序号(直接回车选 1)"
    } catch {
        Fail "当前会话无法交互选择设备,请用 -Serial <序列号> 指定。"
    }
    if (-not $choice) { $choice = "1" }
    $index = 0
    if (-not [int]::TryParse($choice, [ref]$index) -or $index -lt 1 -or $index -gt $ready.Count) {
        Fail "序号 $choice 无效。"
    }
    $Target = $ready[$index - 1]
}

$Serial = $Target.Serial
$model = (Get-ShellValue $Adb $Serial @("shell", "getprop", "ro.product.model"))
$androidRel = (Get-ShellValue $Adb $Serial @("shell", "getprop", "ro.build.version.release"))
Write-Ok "目标设备:$Serial($model,Android $androidRel)"

# ---------- 2. 决定包名:同包名冲突时自动切换共存测试包 ----------

Write-Head "检查设备上已安装的 LumaTile"

$packages = Get-InstalledPackages $Adb $Serial
$releaseInstalled = $packages.ContainsKey($ReleaseAppId)
$releaseVersionBefore = ""
if ($releaseInstalled) {
    $releaseVersionBefore = Get-InstalledVersion $Adb $Serial $ReleaseAppId
    Write-Host "已安装正式版:$ReleaseAppId $releaseVersionBefore"
} else {
    Write-Host "设备上没有正式版 $ReleaseAppId"
}

$suffix = $AppIdSuffix.Trim()
if ($suffix -and -not $suffix.StartsWith('.')) { $suffix = "." + $suffix }

if (-not $suffix -and $releaseInstalled -and -not $NoCoexist) {
    $suffix = ".test"
    Write-Note "正式版已在本机,而同包名的 Debug 包只在签名一致时才能覆盖安装,否则报 INSTALL_FAILED_UPDATE_INCOMPATIBLE。"
    Write-Note "已自动改用共存测试包(包名后缀 $suffix),正式版的登录状态、课表与学分要求都不受影响。"
    Write-Note "确实要装原包名 Debug 包时加 -NoCoexist;不要为了装包去卸载正式版,那样会丢数据。"
} elseif (-not $suffix -and $releaseInstalled -and $NoCoexist) {
    Write-Note "已指定 -NoCoexist:将构建原包名 Debug 包,若与已装正式版签名不一致,安装会失败。"
    Write-Note "脚本不会卸载正式版;失败后请改用共存测试包(去掉 -NoCoexist)。"
} elseif ($suffix -and -not $releaseInstalled) {
    Write-Note "设备上没有正式版,但已按参数使用包名后缀 $suffix。"
}

$targetAppId = $ReleaseAppId + $suffix
$coexist = [bool]$suffix
Write-Host "本次安装目标包名:$targetAppId"
if ($coexist -and $packages.ContainsKey($targetAppId)) {
    $existingTest = Get-InstalledVersion $Adb $Serial $targetAppId
    Write-Note "设备上已有同包名测试包($existingTest),将覆盖安装;若它是别的机器构建的(debug 密钥库不同),会报 INSTALL_FAILED_UPDATE_INCOMPATIBLE。"
}

# ---------- 3. 构建 ----------

$buildArgs = @()
if ($suffix) { $buildArgs += @("-AppIdSuffix", $suffix) }
if ($suffix -and $AppLabel) { $buildArgs += @("-AppLabel", $AppLabel) }
if ($SkipTests) { $buildArgs += "-SkipTests" }

$PowerShellExe = Join-Path $env:SystemRoot "System32\WindowsPowerShell\v1.0\powershell.exe"
if (-not (Test-Path $PowerShellExe)) { $PowerShellExe = "powershell.exe" }
$buildCommandText = "powershell -NoProfile -ExecutionPolicy Bypass -File scripts\build-mobile.ps1"
if ($buildArgs.Count -gt 0) { $buildCommandText += " " + ($buildArgs -join " ") }

Write-Head "构建 Debug 包"
$sourceInfo = Get-SourceInfo
if ($sourceInfo) { Write-Host "构建来源:$(Split-Path -Leaf $RepoRoot) @ $sourceInfo" }
Write-Host "构建命令:$buildCommandText"

if ($DryRun) {
    Write-Host "安装命令:adb -s $Serial install -r $ApkPath"
    if ($coexist) { Write-Host "安装后验证包名:$targetAppId(正式版 $ReleaseAppId 保持不动)" }
    Write-Host ""
    Write-Ok "预览结束(-DryRun),未构建、未安装。"
    exit 0
}

if (-not (Test-Path $BuildScript)) { Fail "找不到构建脚本 $BuildScript。" }

$buildStart = Get-Date
Push-Location $RepoRoot
try {
    & $PowerShellExe -NoProfile -ExecutionPolicy Bypass -File $BuildScript @buildArgs
    $buildExit = $LASTEXITCODE
} finally {
    Pop-Location
}
if ($buildExit -ne 0) {
    Fail "构建失败(退出码 $buildExit),已跳过安装。"
}

if (-not (Test-Path $ApkPath)) { Fail "构建结束但没找到 APK:$ApkPath" }
$apk = Get-Item $ApkPath
if ($apk.LastWriteTime -lt $buildStart) {
    Write-Note "Gradle 判定产物已是最新(assembleDebug UP-TO-DATE),本次没有重写 APK,时间戳:$($apk.LastWriteTime);需要强制重建时先删除 apps\mobile\android\app\build 再重跑。"
}
Write-Ok ("APK 已生成:{0}({1:N1} MiB,{2})" -f $apk.FullName, ($apk.Length / 1MB), $apk.LastWriteTime)

# ---------- 4. 安装 ----------

Write-Head "安装到 $Serial"

$result = Invoke-AdbInstall -Adb $Adb -SerialValue $Serial -Apk $ApkPath
if (-not (Test-InstallSuccess $result)) {
    if ($result.Output -match 'INSTALL_FAILED_TEST_ONLY') {
        Write-Note "APK 带 testOnly 标记,改用 adb install -t 重试。"
        $result = Invoke-AdbInstall -Adb $Adb -SerialValue $Serial -Apk $ApkPath -Extra @("-t")
    } elseif ($result.Output -match 'INSTALL_FAILED_VERSION_DOWNGRADE') {
        Write-Note "设备上版本号更高,改用 adb install -d 重试。"
        $result = Invoke-AdbInstall -Adb $Adb -SerialValue $Serial -Apk $ApkPath -Extra @("-d")
    }
}

if (-not (Test-InstallSuccess $result)) {
    if ($result.Output) { Write-Host $result.Output -ForegroundColor DarkGray }
    $hints = @()
    if ($result.Output -match 'INSTALL_FAILED_UPDATE_INCOMPATIBLE') {
        if ($coexist) {
            $hints += "设备上已有别处构建的同包名包 $targetAppId:debug 密钥库每台机器不同,无法覆盖。"
            $hints += "确认它是测试包后执行 adb -s $Serial uninstall $targetAppId,再重跑本脚本。"
        } else {
            $hints += "同包名的已装应用($ReleaseAppId)与 Debug 包签名不一致(正式版用正式密钥签名)。"
            $hints += "去掉 -NoCoexist 重跑,脚本会用共存测试包安装,不需要也不应该卸载正式版。"
        }
    }
    if ($result.Output -match 'INSTALL_FAILED_USER_RESTRICTED') {
        $hints += "设备(MIUI/HyperOS 等)限制了 USB 安装:请在开发者选项中打开「USB 调试(安全设置)」或「通过 USB 安装」后重试。"
    }
    if ($result.Output -match 'INSTALL_FAILED_INSUFFICIENT_STORAGE') {
        $hints += "设备存储不足,请清理空间后重试。"
    }
    if ($result.Output -match 'INSTALL_PARSE_FAILED') {
        $hints += "APK 解析失败,产物可能损坏,请重新构建。"
    }
    if ($result.Output -match 'INSTALL_FAILED_OLDER_SDK') {
        $hints += "设备 Android 版本低于 min SDK 24,无法安装。"
    }
    if ($result.Output -match 'no devices|device offline|device unauthorized|closed') {
        $hints += "adb 连接中断:重新插拔数据线,或 adb kill-server 后重试。"
    }
    if ($hints.Count -eq 0) {
        if ($result.Output) {
            $hints += "请按上面的 adb 原始输出排查;打包安装流程见 apps/mobile/README.md。"
        } else {
            $hints += "adb 没有返回可解析文本,请看上方 stderr 输出(如 device not found / unauthorized);打包安装流程见 apps/mobile/README.md。"
        }
    }
    Fail ("安装失败。" + ($hints -join "`n        "))
}

Write-Ok "adb install 返回:$($result.Output)"

# ---------- 5. 验证 ----------

Write-Head "验证安装结果"

$packagesAfter = Get-InstalledPackages $Adb $Serial
if (-not $packagesAfter.ContainsKey($targetAppId)) {
    Fail "安装命令成功,但设备上查不到 $targetAppId。请执行 adb -s $Serial shell pm list packages | Select-String lumatile 复核。"
}
$installedVersion = Get-InstalledVersion $Adb $Serial $targetAppId
Write-Ok "设备上已安装:$targetAppId $installedVersion"

if ($coexist -and $ReleaseAppId -ne $targetAppId) {
    if ($packagesAfter.ContainsKey($ReleaseAppId)) {
        $releaseVersionAfter = Get-InstalledVersion $Adb $Serial $ReleaseAppId
        if ($releaseVersionBefore -and $releaseVersionAfter -ne $releaseVersionBefore) {
            Write-Note "正式版版本从 $releaseVersionBefore 变成了 $releaseVersionAfter,请确认这不是本次操作造成的。"
        } elseif ($releaseVersionAfter) {
            Write-Ok "正式版 $ReleaseAppId $releaseVersionAfter 未被触碰。"
        } else {
            Write-Note "正式版 $ReleaseAppId 仍在设备上,但没能读到版本号。"
        }
    } else {
        Write-Note "设备上仍然没有正式版 $ReleaseAppId,本次只装了共存测试包。"
    }
}

if ($Launch) {
    Write-Head "启动应用"
    $startOut = (Get-ShellValue $Adb $Serial @("shell", "am", "start", "-n", "$targetAppId/$MainActivity"))
    if ($startOut -match 'Error|Exception') {
        Write-Note "启动命令返回:$startOut"
    } else {
        Write-Ok "已启动 $targetAppId"
    }
}

# ---------- 汇总 ----------

Write-Host ""
Write-Host "[完成] $targetAppId $installedVersion 已安装到 $Serial($model)" -ForegroundColor Green
Write-Host "       APK:$ApkPath"
if ($coexist) {
    Write-Host "       这是共存测试包:数据与正式版完全独立,教务登录/课表/学分要求需要在测试包里重新配置,包内「检查更新」会按设计拒绝非正式应用 ID。"
    Write-Host "       清理:adb -s $Serial uninstall $targetAppId"
}
Write-Host "       尚未验证:真实教务登录、桌面小组件与升级链路需要在手机上人工确认。"