# 网络电台调整项目规则

本项目继承 `/Volumes/wisely data/Projects/DEVELOPMENT_GOVERNANCE.md`。开发前按任务读取 `/Volumes/wisely data/Projects/_company-standards/` 中的核心、前端或全栈规范，并以项目现有文档和测试为准。

## GitHub 使用规范（2026.09）

本项目继承 `/Volumes/wisely data/Projects/DEVELOPMENT_GOVERNANCE.md` 与 `/Volumes/wisely data/Projects/_company-standards/standards/github/GITHUB_USAGE_STANDARD.md`。

涉及 GitHub 仓库、Actions、Runner、Artifact、Cache、Release、Package、Secrets、Environments、分支保护、规则集或部署时，先读取中央 GitHub 使用规范；概念、保留期、账单或存储边界不明确时，再读取 `/Volumes/wisely data/Projects/_company-standards/docs/GITHUB_CONCEPTS_AND_ACTIONS_GUIDE.md`。仓库可见性按数据与安全分类决定，Actions 默认最小权限（通常为 `contents: read`），必须设置必要的超时、并发和保留期；Artifact 仅存临时运行产物，Cache 仅存可再生加速数据，正式版本使用 Release，凭据只放 Secrets/Environment，禁止写入代码、日志、文档或示例。新增自动化前必须检查现有 workflow，避免重复或高频轮询；时效性 GitHub 限额、账单和安全能力以官方文档复核为准。
