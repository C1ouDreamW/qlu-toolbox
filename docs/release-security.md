# Android 签名规则与恢复发布

状态：2026-11-07，PR 演练安全修复、三渠道更新与独立发布任务已提交并推送；长期 Alpha key、真实安装验收和生产桥接尚待完成，未执行正式签名或公开发布。按维护人决定，继续使用现有 GitHub 仓库 Secrets，取消 Environment 迁移、环境审批及其配置要求。现有正式 Secret 保持原样，后续实现不以 Environment 或密码找回为前置条件。

## 当前代码行为

- `ci.yml` 和 `release-rehearsal.yml` 不请求任何长期 Secret，使用只读权限，不持久保存 checkout 凭据。
- Android PR 演练改用 SDK Debug key 和固定独立 `.debug` 应用 ID，验证实际 APK 的包名、版本、可调试标记、Web 元数据及 Debug 证书。三端 Debug 使用独立应用名与数据命名空间，默认关闭更新、公告和统计；worker 与桌面端核验同一份构建身份。
- 演练产物继续标记 `purpose=rehearsal`、`deployable=false`，发布器拒绝推广。
- `release-android.yml` 分为无 Secret 的 unsigned 构建、仅签名任务和独立发布任务。签名任务使用现有四项仓库 Secrets，不运行 npm / Gradle，不持有 Release 写权限；所有 Action 固定完整 SHA。
- 发布入口要求平台标签 push，核对标签 / workflow SHA / checkout 完整 commit、主线祖先关系和原有生产切换开关。unsigned 构件绑定同一 run / attempt 及构建任务输出摘要；签名后再次核验最终字节和证书。
- 旧组合发布的 Android job 仍主动失败，等待后续桌面桥接入口替换；不会恢复 PR 正式签名。
- Windows / macOS 的独立发布基础保留；现有本地修复尚未推送，不代表远端工作流已经变更。

独立 Android 发布代码已经恢复为分离任务，但原有 `independentPublishingEnabled=false` / 桥接门槛保持不变，不会因本轮实现自动发版。Alpha 已使用独立凭据选择步骤与关闭的独立门禁；旧组合发布不恢复。无需配置 Environment 或找回原正式密码。

## 仓库 Secrets 使用规则

Stable 沿用以下四项，保持当前值和作用域，不删除、替换或迁移：

```text
ANDROID_KEYSTORE_BASE64
ANDROID_KEYSTORE_PASSWORD
ANDROID_KEY_ALIAS
ANDROID_KEY_PASSWORD
```

Alpha 使用独立固定密钥，后续新增以下仓库 Secrets，不复用正式密钥：

```text
ANDROID_ALPHA_KEYSTORE_BASE64
ANDROID_ALPHA_KEYSTORE_PASSWORD
ANDROID_ALPHA_KEY_ALIAS
ANDROID_ALPHA_KEY_PASSWORD
```

仓库写权限人员继续属于仓库 Secret 的信任范围。项目通过工作流约束、源码审查与发布输入校验防止误用，不宣称具有 Environment 审批隔离。[GitHub 安全使用说明](https://docs.github.com/en/actions/reference/security/secure-use)

项目配置的 fork / 同仓库 PR 工作流均不引用长期签名 Secret；日常 Debug 使用自动生成的 Debug key。发布工作流只在已核验的平台 / 渠道标签、完整 commit 与主线来源符合要求时签名；手动入口如保留，也不能绕过相同校验。Secret 只注入实际签名步骤，不提供给 npm / Gradle 构建、测试或构件内脚本。

## 开发材料与维护人协助

1. 日常开发、单元测试、Debug、桌面打包和 Alpha 代码开发不需要原正式 keystore 或明文密码，不要求把它们放到新 Mac。
2. 现有正式 Secret 有效时，CI 可以继续使用，无需维护人重新输入密码。原 Windows 材料找回与独立加密备份作为维护事项并行跟进，不作为开发或现有 CI 签名的前置条件。
3. 首次公开 Android Alpha 前，再单独完成 Alpha key 生成、备份、公开指纹登记和对应仓库 Secrets 配置；未准备好只影响 Alpha 签名发布。
4. 不向聊天、Issue 或日志提供私钥和密码；所需状态只记录是否就绪及公开证书指纹。仓库 Secret 不作为独立备份的替代。
5. 实际遇到签名凭据缺失 / 无效、仓库操作权限或测试设备不足时，明确报告并暂停对应步骤，继续不依赖它的工作。

## 独立正式发布任务

1. 无 Secret job 构建 unsigned Release APK，记录来源 run / 完整 commit、目标、渠道、版本及 unsigned SHA-256。
2. 校验发布工作流、可信签名脚本与源码来源，输出输入摘要和测试结果。签名 job 使用全新 runner，不执行 PR 的 npm、Gradle、测试或构件内脚本；不新增 Environment 人工审批步骤。
3. 签名步骤按渠道读取仓库 Secrets，执行 zipalign / apksigner，并验证真实 APK 的应用 ID、版本、不可调试状态和预期证书。
4. 对最终已签名文件重新计算 SHA-256，使用独立、仅该 job 有 Release 写权限的发布任务，核验完整构件后再公开。
5. 清理临时密钥，确认失败路径、cache、日志和 artifact 不包含私钥。加入失败边界测试，替换当前“禁止旧签名引用”的临时回归检查。
6. 当前只接受平台标签 push，不提供任意分支手动签名入口。正式签名演练、标签、Release 和部署仍按具体发布阶段授权执行，不因本轮实现自动触发。

## 验证与记录要求

- 项目的 PR 工作流只构建 Debug，不注入 Alpha / Stable 长期签名 Secret；任意分支手动触发不能绕过发布来源检查。
- 错来源构件、错证书 / ID / 渠道或实际缺失 / 无效的凭据阻塞对应签名发布；未使用 Environment、现有仓库 Secret 保持原样和本地密码暂未找回不构成失败条件。
- 保存 workflow commit、来源核验结果、构件哈希和签名结果；不以日志掩码或演练标记替代输入 / 输出验证。
- 既有演练的脱敏审计和已签名 artifact 处置另行跟进。现有证据未确认密钥外泄，不因本次流程改造直接轮换正式 key；任何处置先评估已有 APK 升级链的影响。
- main / 历史 tag 可能仍包含旧工作流；本分支修复未推送前，不重跑原正式签名 PR 演练。此处不再要求合并前迁移 Secret 作用域。

## 本地验证记录

2026-11-07：发布相关 44 项测试与 actionlint 通过；真实 unsigned Release APK 使用一次性测试 key 完成 zipalign、签名、证书 / 原生 / Web / 最终哈希核验，测试 key 与签名产物随后清理。普通本地 Release 在无签名配置时仍失败，显式 unsigned 构建收到签名配置时也被拒绝。未使用正式或 Alpha 长期密钥，未推送或触发 GitHub 发布。

## Alpha 与 Stable 的独立签名入口

三端独立工作流分别接收本平台 Stable / Alpha 标签，从不可变 tag commit 解析渠道、版本和门禁后才开始构建。Windows / macOS 构建 job 仅有 contents:read，独立 Ubuntu 发布 job 重新核验来源并下载同次 run / attempt 的 bundle；该 job 才有 contents:write，且不执行 npm、Gradle 或 Python 构建。

Android 无密钥构建后，签名 job 使用两个条件互斥的步骤：

| 渠道 | 注入签名步骤的仓库 Secrets |
|---|---|
| Stable | 现有 `ANDROID_KEYSTORE_BASE64`、`ANDROID_KEYSTORE_PASSWORD`、`ANDROID_KEY_ALIAS`、`ANDROID_KEY_PASSWORD` |
| Alpha | 新增 `ANDROID_ALPHA_KEYSTORE_BASE64`、`ANDROID_ALPHA_KEYSTORE_PASSWORD`、`ANDROID_ALPHA_KEY_ALIAS`、`ANDROID_ALPHA_KEY_PASSWORD` |

两个步骤分别显式映射，不使用 Secret 的 `alpha && ... || stable` 回退表达式。Alpha Secret 缺失即签名失败，预期 Alpha 证书还必须与已登记正式证书不同。现有正式 Secret 不迁移、不修改；Alpha 长期 key 尚未建立，公开指纹为 null、Alpha 发布开关仍为 false。

备用清单按渠道选择文件：Stable 使用 `updates/android.json`，Alpha 使用 `updates/android-alpha.json`。脚本在最新 main 的独立 worktree 中检查单调性，只写当前渠道文件后创建 automation 分支，不修改 main；仍需创建并通过检查后合并该分支的 PR。首次 Alpha 可以没有旧 Alpha 文件，但不能借此绕过已有 Stable 文件的检查。

本机已实际构建 `io.github.c1oudreamw.lumatile.alpha` 的非 debuggable Release APK，用一次性测试 key 验证无密钥 APK → zipalign → apksigner → 原生 / Web / 证书 / 最终摘要核验。该 key 和测试签名包已删除，不是长期 Alpha 身份，也没有公开发布。工作流结构与分渠道备用清单已纳入发布回归测试（58 项）。

## 建立和恢复长期 Alpha 密钥

以下是维护人操作步骤，尚未执行。只为 Android Alpha 新建密钥，不修改正式 key 或现有四项 Secret。Android Studio 也可完成生成，参考 [Android 官方签名说明](https://developer.android.com/studio/publish/app-signing#generate-key)；命令行参数参考 [JDK keytool](https://docs.oracle.com/en/java/javase/21/docs/specs/man/keytool.html)。

1. 先选择仓库外的私有目录，以及独立的加密备份位置。用密码管理器保存 store password、key password、alias、用途与备份位置；密码不写入命令行、Git、聊天或日志。
2. 在本机交互终端执行下面的命令，将路径替换为选定位置。省略密码参数，由 keytool 隐藏提示输入；如目录已有同名密钥，先核对用途，不能重新生成后覆盖。JKS 用于保存独立的 store / key password，alias 固定为 `lumatile-alpha`。证书 DN 只使用项目标识，无需填写个人资料。

   ```text
   keytool -genkeypair -storetype JKS -keystore <仓库外目录>/lumatile-alpha.jks -alias lumatile-alpha -keyalg RSA -keysize 4096 -validity 10000 -dname "CN=LumaTile Alpha,O=LumaTile,C=CN"
   ```

3. Mac 对目录 / key 分别设置 700 / 600；Windows 使用仅自己账户可读取的目录权限。把 key 加密备份到独立介质或密码管理器附件，并从备份恢复到另一个私有目录，使用 `keytool -list -v -keystore <恢复的文件> -alias lumatile-alpha` 验证 store password 与公开证书 SHA-256。
4. 由维护人登记公开指纹到 `androidAlphaSigningSha256`（去冒号、小写 64 位），与正式指纹对照。key password 还须通过实际测试签名验证；“能列出证书”不能证明私钥口令正确。首次长期签名候选与后续公开发布分别授权，验证恢复后的签名与登记指纹一致后才标记保管完成。
5. 只新增本仓库的四项 `ANDROID_ALPHA_*` Secrets。base64 是密钥的可逆编码，不是加密。维护人可以在本机把编码复制到剪贴板后直接粘贴 GitHub Secret，不把它打印到终端或聊天：

   ```bash
   # macOS；路径改为仓库外密钥文件
   base64 < /private/key-directory/lumatile-alpha.jks | pbcopy
   ```

   ```powershell
   # Windows；路径改为仓库外密钥文件
   [Convert]::ToBase64String([IO.File]::ReadAllBytes('D:\private-key-directory\lumatile-alpha.jks')) | Set-Clipboard
   ```

   对应关系：编码 → `ANDROID_ALPHA_KEYSTORE_BASE64`；store password → `ANDROID_ALPHA_KEYSTORE_PASSWORD`；`lumatile-alpha` → `ANDROID_ALPHA_KEY_ALIAS`；key password → `ANDROID_ALPHA_KEY_PASSWORD`。完成后清空剪贴板，按所用剪贴板管理器的方式清除敏感历史。不要把 GitHub Secret 当作唯一备份。
6. 维护人反馈只需“已备份 / 已验证恢复 / 四项 Alpha Secret 已配置”和公开证书指纹。缺少权限或恢复验证时保持 Alpha 门禁关闭；不要用正式 Secret 补齐，也不要把临时测试 key 登记为长期 Alpha key。

首次 Alpha 还需要登记测试设备、测试者与反馈入口，并做第二版本同证书覆盖安装；首包能安装不等于升级链已验收。
