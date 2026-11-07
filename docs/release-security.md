# Android 签名规则与恢复发布

状态：2026-11-07，PR 演练安全修复已在本地提交，正式签名流程仍待完成。按维护人决定，继续使用现有 GitHub 仓库 Secrets，取消 Environment 迁移、环境审批及其配置要求。本轮仅更新文档，不操作 Secret 或工作流。

## 当前代码行为

- `ci.yml` 和 `release-rehearsal.yml` 不请求任何长期 Secret，使用只读权限，不持久保存 checkout 凭据。
- Android PR 演练改用 SDK Debug key 和独立 `.test` 应用 ID，验证实际 APK 的包名、版本、可调试标记、Web 元数据及 Debug 证书。后续统一渠道实现会将默认 Debug 身份规范为 `.debug`。
- 演练产物继续标记 `purpose=rehearsal`、`deployable=false`，发布器拒绝推广。
- 原 `release-android.yml` 和旧组合发布的 Android job 已移除正式 Secret 引用，主动失败。旧组合发布依赖这个 job，因此也不会公开不完整的组合 Release。
- Windows / macOS 的独立发布基础保留；现有本地修复尚未推送，不代表远端工作流已经变更。

当前正式签名入口的临时封闭需在后续代码实施中解除：补齐发布来源校验、按渠道选择仓库 Secrets，并完成真实产物核验。本轮文档修改不会自动恢复这些入口，也不再要求先配置 Environment 或找回原正式密码。

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

## 恢复签名前的代码交付

1. 无 Secret job 构建 unsigned Release APK，记录来源 run / 完整 commit、目标、渠道、版本及 unsigned SHA-256。
2. 校验发布工作流、可信签名脚本与源码来源，输出输入摘要和测试结果。签名 job 使用全新 runner，不执行 PR 的 npm、Gradle、测试或构件内脚本；不新增 Environment 人工审批步骤。
3. 签名步骤按渠道读取仓库 Secrets，执行 zipalign / apksigner，并验证真实 APK 的应用 ID、版本、不可调试状态和预期证书。
4. 对最终已签名文件重新计算 SHA-256，使用独立、仅该 job 有 Release 写权限的发布任务，核验完整构件后再公开。
5. 清理临时密钥，确认失败路径、cache、日志和 artifact 不包含私钥。加入失败边界测试，替换当前“禁止旧签名引用”的临时回归检查。
6. 代码检查、发布来源校验及产物验证通过后恢复签名入口。正式签名演练、标签、Release 和部署仍按具体发布阶段授权执行，不因为本轮文档修改自动触发。

## 验证与记录要求

- 项目的 PR 工作流只构建 Debug，不注入 Alpha / Stable 长期签名 Secret；任意分支手动触发不能绕过发布来源检查。
- 错来源构件、错证书 / ID / 渠道或实际缺失 / 无效的凭据阻塞对应签名发布；未使用 Environment、现有仓库 Secret 保持原样和本地密码暂未找回不构成失败条件。
- 保存 workflow commit、来源核验结果、构件哈希和签名结果；不以日志掩码或演练标记替代输入 / 输出验证。
- 既有演练的脱敏审计和已签名 artifact 处置另行跟进。现有证据未确认密钥外泄，不因本次流程改造直接轮换正式 key；任何处置先评估已有 APK 升级链的影响。
- main / 历史 tag 可能仍包含旧工作流；本分支修复未推送前，不重跑原正式签名 PR 演练。此处不再要求合并前迁移 Secret 作用域。
