# 安全与隐私问题报告

## 支持范围

按 Windows x64、macOS arm64 和 Android 分别维护最新公开 Stable，实际版本和下载入口见 [README](README.md#支持平台)。各平台可以独立更新，不以仓库的单个 latest Release 判断支持版本。旧版本的修复通常随本平台后续版本提供，不承诺为所有历史版本回补。

Alpha 是独立的测试渠道；公开后优先在后续 Alpha 中修复，不能代替 Stable 的安全修复。Debug 和 PR 构件仅供开发验证，不作为普通用户的更新来源。尚未公开的版本、候选签名成功和 CI 通过均不表示已经受支持或完成设备验收。

## 私下报告

如果问题涉及账号安全、Cookie、会话状态、成绩数据、个人信息泄露或可被滥用的安全缺陷，请不要创建公开 Issue。

请发送邮件至：`cloud_aaa@163.com`

邮件建议包含：

- 受影响的平台、架构、版本和渠道（Stable / Alpha / Debug），以及可提供的构建 commit 或公开 Release 链接；
- 问题描述和复现条件；
- 可能影响；
- 已经脱敏的截图或错误信息。

请勿发送真实密码、验证码、完整 Cookie、未经脱敏的成绩文件或其他无关个人信息。维护者确认并完成必要处理前，请避免公开可直接利用的细节。

签名问题只提供包名、公开证书 SHA-256、构件哈希、工作流 run 链接和脱敏错误。不要发送 keystore、Base64、store / key password 或仓库 Secret。发现可疑的签名任务时保留 run、来源 commit 和现有证据，暂停相关签名或推广；是否处置历史 artifact、吊销凭据或更换 Android key，由维护人结合升级兼容性决定。

普通功能故障和不涉及敏感信息的问题，请使用 [GitHub Issues](https://github.com/C1ouDreamW/qlu-toolbox/issues/new/choose)。
