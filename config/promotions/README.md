# Alpha 晋级 Stable 的审查记录

每个平台的 Stable 候选在源码中提供 `config/promotions/<platform>-<Stable版本>.json`。记录由维护人按实际验收填写并经代码审查，不自动生成“已通过”的结论。本目录当前没有实际晋级批准；正式和 Alpha 发布开关仍关闭。

示例结构（占位 commit 必须替换；时间、测试和批准人不能照抄）：

```json
{
  "schemaVersion": 1,
  "mode": "alpha",
  "platform": "android",
  "stableVersion": "2.1.0",
  "alpha": {
    "tag": "android-alpha-v2.1.0-alpha.2",
    "commit": "<完整的40位Alpha源码commit>"
  },
  "review": {
    "approvedBy": "<审查人GitHub用户名>",
    "observationStartedAt": "<实际观察开始时间，ISO UTC>",
    "observationEndedAt": "<实际观察结束时间，ISO UTC>",
    "approvedAt": "<实际批准时间，ISO UTC>",
    "summary": "<测试范围、支持设备、已知问题和晋级结论>",
    "tests": [
      { "name": "<验收项目>", "result": "passed", "evidence": "<可核对的脱敏验收记录地址或编号>" }
    ]
  }
}
```

把真实记录和 Stable 版本 / 发布说明提交到候选分支后，执行只读预检，无需创建标签、打开门禁或配置签名密钥：

```bash
node scripts/check-stable-promotion.mjs android
# 也可以检查指定的完整 commit；未提交的工作区修改不参与预检。
node scripts/check-stable-promotion.mjs android <完整40位Stable候选commit>
```

预检从 Git 对象读取审查记录和配置，核对 Alpha 标签与 commit、Alpha 是 Stable 源码祖先、基础版本和观察 / 批准时序，再比较完整提交差异。只允许本平台 Stable 版本字段、精确的构建身份输出、对应日志及本次审查记录等元数据变化。不会忽略整个 package.json、lockfile 或 build 配置；依赖变化、工作流变化、业务代码和其他目标配置变化都要求重新 Alpha。

正常模式要求 Alpha 的基础版本等于 Stable 版本。例如 `2.1.0-alpha.2` 晋级 `2.1.0`。Stable 使用自己的应用 ID、数据目录、正式证书和原生构建号重新构建，并核验最终包；不是重命名 Alpha 构件。

紧急修复仍绑定一个已公开的 Alpha 基线，使用 `"mode": "emergency"`，额外提供：

```json
{
  "emergency": {
    "reason": "<为什么不能等待完整的新Alpha周期、风险和补充验证>",
    "approvedChangedPaths": ["src/example.ts"]
  }
}
```

`approvedChangedPaths` 必须与预检识别的非元数据差异路径完全一致、排序且无重复；不接受通配符或目录放行。review 仍须填写实际补充测试和批准，不能通过 emergency 模式省略审查。未经过 Alpha 的首次紧急发布不在此自动入口内。

发布工作流在接触长期签名 Secret 之前，还检查 Alpha 已公开、prerelease=true、标签未移动、本目标清单与安装包资产完整且来源一致；发布器在上传前和公开前重查。私有 / draft / 已撤销的 Alpha、缺包、网络错误与限流均不能作为已验证来源。

`release-record.json` 归档 Alpha 标签 / commit、Stable commit、完整差异路径、审查和紧急例外（适用时）。记录是一份公开、可审核的维护人声明，不能代替实际设备测试、源码审核、发布授权或供应链签名证明。不要写入密码、key 路径、账号数据或未脱敏日志。
