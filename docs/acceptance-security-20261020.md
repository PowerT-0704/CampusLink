# CampusLink 加密与使用体验验收交付报告

日期：2026-10-20（Asia/Shanghai）。基于 v1.4.1 的本地验收版，未发布、未上传，依赖清单、锁文件及构建配置未修改。官网等待用户验收后同步。

## 1. 修改概述

- 记住密码使用 Electron safeStorage 系统加密；写入前做加密及解密往返校验。保留原产品标识和数据目录，普通启动仅解密一次，后续使用内存缓存。
- 已验证记住一次后连续三次完整 Electron 进程重启均能自动连接，模拟掉线后无需重输密码即可重连。
- 旧明文在应用正常启动时自动迁移；旧密文保留兼容。Windows 旧目录迁移同时保留受系统保护的 Chromium 加密上下文，并提前到应用就绪之前处理。原目录不会删除，不覆盖目标已有设置或不同的加密上下文。
- 临时读取失败不删除密文、不清空自动连接偏好；提供重试读取或将本次密码加密保存的入口。新密码在系统加密不可用时仅留本次运行，不启用启动自动连接。
- 设置、密码、方案导入/删除、清除凭据和首次引导采用先原子写入、再更新内存。自启动系统调用失败或落盘后回滚失败均明确报告，读取实际系统状态。
- 首次引导默认不勾选记住密码，支持仅本次使用及跳过；跳过状态持久保存。弹窗使用原生 dialog，支持焦点限制、Esc 关闭及焦点恢复；关闭密码管理后清空临时密码及明文显示状态；更新弹窗延后到引导或密码管理关闭后展示。
- 按用户要求保留原认证地址发现、缓存和重试提交规则；认证适配器和传输层未修改。

## 2. 文件变动清单

修改（12 个源码、文档或测试文件）：

- X:\#工程\CODEX\Github-校园网自动连接\CampusLink-液态玻璃版\electron\main.cjs
- X:\#工程\CODEX\Github-校园网自动连接\CampusLink-液态玻璃版\electron\preload.cjs
- X:\#工程\CODEX\Github-校园网自动连接\CampusLink-液态玻璃版\electron\service.cjs
- X:\#工程\CODEX\Github-校园网自动连接\CampusLink-液态玻璃版\src\api.ts
- X:\#工程\CODEX\Github-校园网自动连接\CampusLink-液态玻璃版\src\App.tsx
- X:\#工程\CODEX\Github-校园网自动连接\CampusLink-液态玻璃版\src\styles.css
- X:\#工程\CODEX\Github-校园网自动连接\CampusLink-液态玻璃版\src\types.ts
- X:\#工程\CODEX\Github-校园网自动连接\CampusLink-液态玻璃版\tests\core.test.cjs
- X:\#工程\CODEX\Github-校园网自动连接\CampusLink-液态玻璃版\tests\monitor.test.cjs
- X:\#工程\CODEX\Github-校园网自动连接\CampusLink-液态玻璃版\scripts\smoke-desktop.cjs
- X:\#工程\CODEX\Github-校园网自动连接\CampusLink-液态玻璃版\README.md
- X:\#工程\CODEX\Github-校园网自动连接\CampusLink-液态玻璃版\docs\usage.md

新增（6 个文件，含本报告）：

- X:\#工程\CODEX\Github-校园网自动连接\CampusLink-液态玻璃版\electron\legacy-data.cjs
- X:\#工程\CODEX\Github-校园网自动连接\CampusLink-液态玻璃版\tests\credentials.test.cjs
- X:\#工程\CODEX\Github-校园网自动连接\CampusLink-液态玻璃版\tests\legacy-data.test.cjs
- X:\#工程\CODEX\Github-校园网自动连接\CampusLink-液态玻璃版\scripts\build-acceptance.cjs
- X:\#工程\CODEX\Github-校园网自动连接\CampusLink-液态玻璃版\scripts\smoke-credentials.cjs
- X:\#工程\CODEX\Github-校园网自动连接\CampusLink-液态玻璃版\docs\acceptance-security-20261020.md

构建产物：dist/index.html 与两份带哈希名称的 JS/CSS；已移除旧的 index 哈希资源，原 dist 已备份。完整产物变动清单见本次生成的 source-and-renderer-changes.csv。

生成/刷新桌面截图与本机验证证据：X:\#工程\CODEX\Github-校园网自动连接\CampusLink-液态玻璃版\artifacts\credential-acceptance 和桌面冒烟脚本中指定的 artifacts 截图。截图均使用本机模拟账号，不包含真实校园网会话。

Windows 安装包、展开目录、校验和、构建日志和包内一致性结果位于：X:\#工程\CODEX\Github-校园网自动连接\CampusLink-液态玻璃版\artifacts\acceptance-20261020。完整生成文件列表见 generated-files.csv（含文件大小及 SHA-256）；源码与界面变更列表见 source-and-renderer-changes.csv。无源码删除。

回滚基线：X:\#工程\CODEX\Github-校园网自动连接\开发笔记\客户端加密验收-20261020-183333。source-before.zip 保存修改前源码及静态资源，renderer-before.zip 保存原 dist，source-before.csv 保存原始文件 SHA-256。备份未包含真实运行配置、.env、密钥或证书。

## 3. 测试与检查行为

执行并通过：

```powershell
node --test --test-reporter=spec tests/*.test.cjs
npm run test:release
npm run typecheck
node --check electron/main.cjs
node --check electron/legacy-data.cjs
node --check scripts/build-acceptance.cjs
node --check scripts/smoke-credentials.cjs
node scripts/build-acceptance.cjs
node scripts/smoke-desktop.cjs
node scripts/smoke-credentials.cjs
```

Windows 打包使用已安装的 electron-builder：--win nsis --x64 --publish never，输出定向到本次验收目录；禁用签名身份自动发现并从子进程环境移除发布及签名凭证变量。构建工具的 native dependency rebuild 为既有依赖打包流程，未新增生产依赖或改动依赖清单。

另完成：7 个关键包内文件与当前源码/构建产物逐字节比较，ASAR 排除开发数据、测试和 .env 路径的检查，安装包 SHA-256、Authenticode 状态检查，以及官网原 9 个文件 SHA-256 对比。

## 4. 检查结果

- 应用测试：158/158 通过；其中增加加密恢复、跨重启、往返校验失败、系统加密不可用、迁移失败、磁盘写入/重命名失败及迁移上下文保护等用例。
- 发布测试：7/7 通过；TypeScript 类型检查、语法检查及界面构建通过，无编译错误。
- 桌面验证：Windows + Electron 44.7.0；原有桌面冒烟通过；原生加密连续三次完整重启、断线重连、旧明文及旧密文升级、跳过引导跨重启、仅本次密码不落盘、焦点与 Esc、清除临时密码及更新弹窗延后均通过。页面异常为 0。
- 宿主原生剪贴板读回不可用；既有冒烟校验剪贴板桥接载荷通过，此限制不影响密码保存或连接验证。
- 打包通过，包内 7 个关键文件与当前源文件逐字节一致；未包含 dev-data、tests 或 .env。安装包 114243574 字节，Authenticode 为 NotSigned。打包日志包含 react-dom 重复引用提示，未阻止打包。
- 官网：9/9 原文件哈希一致，未同步修改；项目内 site 目录亦未修改。
- 依赖未升级。评估阶段 npm audit 结果仍作为本轮基线：开发/构建链 8 项中危、生产依赖 0 项告警；本轮不将此视为完整安全认证。

安装包：X:\#工程\CODEX\Github-校园网自动连接\CampusLink-液态玻璃版\artifacts\acceptance-20261020\Campus-Link-Glass-Setup-1.4.1.exe

SHA-256：ed5ade33cf2c4ef498a98aa1fae8cf75a3fd1f4630f6ade27254af077da4a34a

原生加密桌面证据：X:\#工程\CODEX\Github-校园网自动连接\CampusLink-液态玻璃版\artifacts\credential-acceptance\results.json

包内校验结果：X:\#工程\CODEX\Github-校园网自动连接\CampusLink-液态玻璃版\artifacts\acceptance-20261020\verification.json

## 5. 验收步骤与剩余风险

1. 使用本次验收安装包；其内部版本仍为 1.4.1，尚未创建正式发行版。原 release 目录中的安装包未覆盖。
2. 在当前 Windows 用户下按需勾选记住密码，成功连接后开启启动后自动连接；正常退出客户端，再启动，确认不必重新输入。
3. 已保存旧凭据的用户启动时检查是否自动恢复；不要手动单独移动 settings.json，也不要删除应用数据目录中的系统加密上下文。
4. 实际校园网确认掉线重连及手动注销暂停行为符合原有习惯；检查引导、密码管理、Esc 和焦点。
5. 若提示系统暂时无法读取密码，先点击重试读取；原密文与自动连接偏好会保留。确认系统密钥损坏或变更、原上下文遗失后才需要重新录入。
6. 客户端验收合格后，再同步指定官网的说明、隐私文案和必要截图；对应发行资产未确认前不修改下载版本链接。

本轮没有安装验收包到系统，也没有使用真实校园网账号执行认证或注销。Windows 原生功能已在隔离数据目录及本机模拟服务验证；macOS 仍需实机验证，尤其是 Keychain 权限和应用签名稳定性。没有执行操作系统重启测试，已验证的是客户端完整进程重启。

历史目录和备份中的明文不自动清理。系统密钥或加密上下文确实损坏时无法承诺恢复原密码；Windows 系统加密也不能防御同一登录用户下的恶意程序。既有 HTTP 认证链路、新发现认证地址的信任边界及持续重试风险按要求保留。当前安装包未签名，未对外发布。
