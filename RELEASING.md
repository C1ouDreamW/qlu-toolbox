# 开发、测试与发布

本指南面向维护人与测试者。当前三端公开 Stable 仍为 2.0.4；独立发布、Alpha 和新设备验收正在草稿 PR 中实施，发布开关关闭，桌面桥接 B 尚未选定。已实现的入口与尚待实际验收的步骤分别说明，不把候选包或配置中的版本当作已公开版本。

项目正式许可证尚未选定，README 的非商业用途说明继续有效。新增依赖需要保留其独立许可；生成清单不等于完成许可审查或取得新的授权。

## 日常开发与 PR

按 [贡献指南](CONTRIBUTING.md)安装锁定依赖并运行 `doctor`。日常使用 Debug，本地不需要正式或长期 Alpha key。PR CI、三端 Debug 演练均不接收长期签名 Secret，产物仅作为短期 Actions artifact 保留。

检查修改范围对应的测试及真实包内身份。提交前审查版本准备产生的可见 diff，保留业务或依赖修改，避免把生成的 Debug 版本载体误提交。源码版本由 `config/release-versions.json` 按平台、渠道分别维护。

## Alpha 候选

先完成候选代码审查、合入 main 和 CI，再由维护人选择当前 main 的完整 40 位 commit。在 GitHub Actions 中打开 **Build Alpha candidate (no release)**，选择 main、单个平台和该 commit。开始 Android 首次长期签名之前，明确确认本次使用独立 Alpha 仓库 Secret；不更改原四项正式 Secret，不需要在 Mac 保存长期 key。

入口只接受本仓库 main 手动调度；若 main 在构建期间前进，来源复核会停止，应重新选择明确的主线 commit。Windows / macOS 生成 Alpha 安装包；Android 先由无 Secret job 构建 unsigned APK，再由全新 runner 单独签名。候选不创建 tag、Release 或更新指针，也不受公开发布开关控制。

从指定 run 下载 `alpha-candidate-<platform>-<run>-<attempt>`。核对 run 成功、完整 commit、平台、Alpha 身份、`purpose=candidate`、`deployable=false` 和最终文件摘要。候选保留 7 天，验收需要的原始包与脱敏记录应由维护人及时另存。不要只凭“文件名相同”信任来源。

归档包括安装包、候选记录、`SHA256SUMS.txt` 以及五份材料：

- `dependency-inventory.cdx.json`：已解析的生产依赖输入与运行时厂商组件，包含明确的覆盖边界。
- `THIRD-PARTY-NOTICES.txt`：实际安装依赖携带的许可和通知原文。
- `PROJECT-TERMS.txt`：该源码 commit 的项目使用条款快照。
- `license-review.json`：项目许可待定、缺失声明与厂商内部覆盖待审查项。
- `build-provenance.json`：源码输入摘要、构建身份、允许的工具 / 工作流字段，以及材料摘要；它是未签名的记录。

在仓库根目录的 Bash 中，可用现有校验函数检查解压后的全量文件摘要：

```bash
node --input-type=module -e 'import { verifyReleaseFiles } from "./scripts/release-artifacts.mjs"; console.log(await verifyReleaseFiles(process.argv[1]))' /path/to/extracted-candidate
```

这项检查验证文件之间的摘要一致性；仍须核对可信 Actions run 和审查过的 commit。Android 签名 job 另外核对构建 job 独立登记的完整回执摘要、APK、清单和 run / attempt，最终证书应等于登记的 Alpha 公开指纹。备份恢复与私钥口令有效性按[签名恢复步骤](docs/release-security.md#建立和恢复长期-alpha-密钥)由维护人在私有终端验证，密码与私钥不进入验收记录。

## 真实设备验收

维护人已确认 Windows 和 Android 可用；macOS 在原生 arm64 机器验证。每个平台记录 OS / 架构、完整 commit、两个候选版本及原生构建值、run / attempt、最终文件哈希、测试者和时间。使用内置虚拟展示课表和独立测试目录，不用真实账号、Cookie 或成绩作为公开证据。

| 检查 | 操作与预期 |
|---|---|
| 首次安装 | 从指定 run 安装本平台 Alpha，名称和包内身份正确；Android 不可调试且证书符合登记值 |
| 三渠道共存 | 保留 Stable，另装 Alpha / Debug；分别打开，核对应用、快捷方式 / Dock、单实例与 Android 小组件互不串台 |
| 数据隔离 | 各渠道保存不同的虚拟课表和设置，重启后仍各自保留；不自动继承另一渠道登录或数据 |
| 连续升级 | 准备第二份 Alpha，递增 Alpha 序号及本渠道原生 buildNumber / versionCode；Android 仍用同一 Alpha 证书，覆盖安装后保留 Alpha 数据 |
| 卸载隔离 | 先备份合成测试数据，只卸载 Alpha / Debug；Stable 应用、课表、设置和快捷方式保持可用。Android 卸载通常删除被卸载应用的私有数据；Windows 默认保留用户数据，还须重装核对其策略 |
| 更新行为 | Debug 不访问在线更新；Alpha 只识别本平台 Alpha；Stable 不提示 Alpha，错 ID / 证书 / code / 摘要的 Android 包被拒绝 |
| 本地功能 | 首次启动、文件选择 / 保存、导入导出、课表编辑与重启恢复；真实学校登录等需要用户在设备上自行操作，公开记录脱敏 |

不同机器的 Android Debug key 可能不同。发生签名冲突时先核对应用 ID；只处理独立 Debug 的测试数据和安装，不卸载 Stable。首次候选没有公开更新源，无法完成“在线发现下一版”的真实链路；它要在后续经批准的公开 Alpha 中另行验收。

分发新的候选或公开 Alpha 时使用新的 Alpha 序号和原生构建值；同版本重试只复用已确认的同一字节包，不能用重新构建的不同包替换。当前没有填入任何“真实设备已通过”的验收结果。

## Alpha 公开与观察

实际设备检查通过后，维护人记录本端测试范围、已知问题、测试者、反馈入口和观察窗口，审查本端变更日志与不可变源码。再单独批准打开 `alphaPublishingEnabled`、创建本平台 Alpha 标签和公开 prerelease。标签与门禁均从同一发布 commit 读取，不能临时修改工作区绕过。

Alpha 公开后即可被 GitHub 兜底更新器发现，必须先完成发布级验收。更新 README 本端 Alpha 下载入口，保存公开安装包与材料；第一次安装走明确的 Alpha 下载入口，第二版开始验证在线发现、覆盖安装和数据保留。主源人工部署与 Android 备用清单 PR 分别核验，不自动写生产服务器。

观察期记录问题、修复、重测及实际起止时间。有业务代码、依赖或构建规则变化时重新 Alpha，不能仅因 CI 通过提前宣称稳定。反馈注明平台、渠道、版本、commit / run 与脱敏复现；安全问题按 [SECURITY.md](SECURITY.md)私下报告。

## Stable 晋级与桌面桥接

按 [晋级记录规范](config/promotions/README.md)填写本平台真实 Alpha 来源、观察记录和维护人结论；只读预检使用 `node scripts/check-stable-promotion.mjs <platform> [full-commit]`。模板不是批准，不填写虚构时间、测试者或通过结果。Stable 从已验收业务源码按自己的身份和证书重新构建，保留 Stable 用户升级链。

Android Stable 不依赖桌面 B，仍检查自身门禁、来源、正式证书和晋级证据。Windows / macOS 还须完成旧版 → 桥接 B → 本平台独立版本的真实链路，包括正式私有数据保留和主源断开后的 GitHub 兜底。B 尚未选定；桌面专用的只读构建 / 双端归档入口已实现，桥接公开与受控推广仍待接入，不能使用旧三端组合工作流附带发布 Android，也不能用 Alpha 身份代替 Stable 桥接验收。维护人已明确本轮不发布正式版；Stable / 桥接标签、公开 Release 和正式更新源推广都等后续功能集中完成后另行决定。

## 部署、失败与恢复

公开发布经批准后，从指定 run 下载该平台 / 渠道 update-source，核对完整 commit、证书、发布记录及全量摘要。先保存服务器上本平台 / 渠道的现有清单与关联构件，再上传新的不可变 release 目录并核验。最后使用 `scripts/promote-update-manifest.mjs` 切换指定平台和渠道；其锁、单调性检查和原子替换只作用于这个指针。Android 备用清单由单独的 automation 分支审查合入。

部署前在隔离目录演练缺文件、损坏摘要和较旧版本迟到等失败，确认其他五个平台 / 渠道指针未变化。HTTP 路由、MIME、缓存与 CORS 由 `scripts/check-update-source.sh` 在隔离容器验证；本地没有 Docker 时使用无 Secret CI 的结果，不连接生产服务做模拟故障。

上传失败且尚未公开的 draft 可在摘要一致时补齐；已公开版本不能覆盖、移动标签或替换不同字节。发现错误包时停止新签名或推广、保留 run / commit / 摘要及脱敏证据，再发布更高版本修复。现有推广器拒绝回退；确需恢复旧服务指针时由维护人另行审查影响并确定恢复步骤，不伪装为正常单调发布。Alpha key 恢复使用独立备份验证，不重新生成同名 key 替换已分发证书。

公开包、桥接路径和升级所需清单长期保留；CI artifact 到期不等于可以删除公开升级包。工程代码、设备验收、公开发布与生产推广分别留证，任何一步失败都不以其他步骤成功代替。
