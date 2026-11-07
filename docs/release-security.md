# Android 签名安全整改与恢复发布

状态：2026-11-07，阶段 0 代码整改中。仓库外 Environment、Secret 作用域和审核设置尚未核验，不能标记安全整改完成。

## 当前代码行为

- `ci.yml` 和 `release-rehearsal.yml` 不请求任何长期 Secret，使用只读权限，不持久保存 checkout 凭据。
- Android PR 演练改用 SDK Debug key 和独立 `.test` 应用 ID，验证实际 APK 的包名、版本、可调试标记、Web 元数据及 Debug 证书。后续统一渠道实现会将默认 Debug 身份规范为 `.debug`。
- 演练产物继续标记 `purpose=rehearsal`、`deployable=false`，发布器拒绝推广。
- 原 `release-android.yml` 和旧组合发布的 Android job 已移除正式 Secret 引用，主动失败。旧组合发布依赖这个 job，因此也不会公开不完整的组合 Release。
- Windows / macOS 的独立发布基础保留；此整改不创建标签或公开 Release。

这是临时封闭，不是新的正式签名实现。不得仅移除失败步骤、恢复旧 Secret 引用或把整个 Gradle job 绑定 Environment 后就宣布迁移完成。

## 为什么还需要仓库外操作

GitHub 仓库 Secret 仍属于仓库写权限的信任范围；修改一个 PR 工作流不能撤销历史 ref 或其他工作流对全局 Secret 的访问。日志掩码和演练标记也不能限制签名能力。[GitHub 安全使用说明](https://docs.github.com/en/actions/reference/security/secure-use)

Environment 可以在批准前限制任务接触环境 Secret，但必须实际配置保护规则。仅声明名字会有自动创建未保护环境的风险；保留仓库级副本也会保留旧访问路径。[GitHub Environment 管理说明](https://docs.github.com/en/actions/how-tos/deploy/configure-and-manage-deployments/manage-environments)

## 维护人准备与配置清单

这些步骤需要仓库管理员处理或核验。只报告是否完成和公开证书指纹，不把私钥、Secret 值或密码发到聊天 / Issue。

1. 确认原 Windows 上的正式 keystore、alias、store password、key password 可用，并有独立加密备份；GitHub Secret 无法作为可取回的密钥备份。先确认恢复材料，再移除旧作用域副本。
2. 在仓库 Settings → Environments 创建 `android-stable-signing`，启用 Required reviewers，关闭管理员绕过；确认当前仓库计划支持这些规则。个人维护时明确可执行的批准人安排，不在只有一人的情况下盲目开启禁止自审。
3. 将部署 ref 限制为选定的 tag 规则：`android-v*`；迁移期如需旧 `v*` 标签，另行审核后添加。不要允许任意分支。标签模式只是触发限制，新工作流仍需检查完整 commit 和受保护主线来源。
4. 在该环境中配置四个 Secret：`ANDROID_KEYSTORE_BASE64`、`ANDROID_KEYSTORE_PASSWORD`、`ANDROID_KEY_ALIAS`、`ANDROID_KEY_PASSWORD`。核验备份和环境配置后，移除仓库 / 组织层对此仓库仍生效的相同正式凭据副本。
5. 检查 main 必需检查、工作流 / 签名脚本审查、tag 创建权限以及管理员例外，记录实际设置与维护人。单人维护可采用显式人工审核，但不能声称已经具备独立双人审查。
6. 保留相关演练的脱敏审计记录，评估已签名 artifact 的处置。尚无确认密钥外泄的证据，正式 key 是否轮换需另行判断其对已有 APK 升级链的影响。

Alpha 后续单独创建 `android-alpha-signing`，只允许 `android-alpha-v*` 标签，使用相同审批原则和独立 Alpha key。现在不要求把正式 key 放到 Mac，也不要求提前生成 Alpha key；普通 Debug 开发无需这两把长期密钥。

## 恢复签名前的代码交付

1. 无 Secret job 构建 unsigned Release APK，记录来源 run / 完整 commit、目标、渠道、版本及 unsigned SHA-256。
2. 审核 job 来自可信、已审查的工作流与签名脚本 commit；展示输入摘要和测试结果。签名 job 使用全新 runner，不执行 PR 的 npm、Gradle、测试或构件内脚本。
3. 通过已核验的受保护 Environment 取得对应渠道 Secret，执行 zipalign / apksigner，并验证真实 APK 的应用 ID、版本、不可调试状态和预期证书。
4. 对最终已签名文件重新计算 SHA-256，使用独立、仅该 job 有 Release 写权限的发布任务，核验完整构件后再公开。
5. 清理临时密钥，确认失败路径、cache、日志和 artifact 不包含私钥。加入失败边界测试，替换当前“禁止旧签名引用”的临时回归检查。
6. 管理员设置核验与代码检查均通过后，才重新启用签名；正式签名演练、标签、Release、部署仍按对应阶段授权执行。

## 验证与记录要求

- fork / 同仓库 PR 都只能构建 Debug；任意分支手动触发不能绕过来源检查或环境审批。
- 未保护环境、全局旧 Secret 副本、错来源构件、错证书 / ID / 渠道均阻塞签名或发布。
- 保存实际设置核验时间、检查人、workflow commit、构件哈希及受控签名结果。没有读取权限时记录“未核验”，不推定已配置。
- 旧式 workflow 的历史版本可能仍存在于 main / tag；本分支修复不表示它们已生效。合并前完成凭据作用域迁移，并禁止重跑旧的正式签名 PR 演练。
