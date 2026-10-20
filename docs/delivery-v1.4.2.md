# CampusLink v1.4.2 发布交付记录

日期：2026-10-20（Asia/Shanghai）。

## 1. 修改概述

- 客户端清单、锁文件、预览版本、应用内开发日志、安装包、README、使用指南及官网统一至 v1.4.2。
- 系统加密、旧凭据迁移、临时故障恢复、保存一致性、首次引导和弹窗改进一并发布。应用标识及数据目录保持稳定。
- 客户端及官网源码已提交到 [PowerT-0704/CampusLink](https://github.com/PowerT-0704/CampusLink)。
- [v1.4.2 正式发行](https://github.com/PowerT-0704/CampusLink/releases/tag/v1.4.2) 已包含 Windows x64、Intel Mac、Apple Silicon Mac 安装包及校验和。发行源码提交为 `f85bd9c520445cf5cfca6d1fc2a6ad6a7bc04c44`。
- 官网已部署至 [w3f7-campus-link-cdut.vercel.app](https://w3f7-campus-link-cdut.vercel.app/)，Vercel 状态为 Valid Configuration / Production；线上已核对 v1.4.2、三平台下载地址和加密隐私说明。
- Vercel 项目名为 `w3f7.campus_link.cdut`，实际访问域名不接受点号和下划线，按维护者确认改用连字符。本次为静态文件上传，尚未连接 Git 提供方。
- 指定本地官网发布包 `CampusLink-官网站点-v1.4.1-发布包/dist` 已同步，目录名称保留，公开内容为 v1.4.2。

## 2. 文件变动清单

以下为相对上一发布源码 `c85f9e4` 的全部提交路径（含此前本地完成、本次发布的安全改进）。相对客户端项目根目录；无删除文件。

```text
README.md
docs/acceptance-security-20261020.md
docs/delivery-v1.4.2.md
docs/releases-v1.4.2.md
docs/usage.md
electron/legacy-data.cjs
electron/main.cjs
electron/preload.cjs
electron/service.cjs
package-lock.json
package.json
scripts/build-acceptance.cjs
scripts/smoke-credentials.cjs
scripts/smoke-desktop.cjs
site/QA-REPORT.md
site/README.md
site/app.js
site/assets/campuslink-classic.webp
site/assets/campuslink-liquid.webp
site/assets/icon.svg
site/index.html
site/preview.cjs
site/qa/capture-client.cjs
site/qa/check.cjs
site/qa/evidence/1280x800.png
site/qa/evidence/1440x900.png
site/qa/evidence/360x800.png
site/qa/evidence/390x844.png
site/qa/evidence/768x1024.png
site/qa/evidence/desktop-full.png
site/qa/evidence/mobile-full.png
site/qa/results.json
site/styles.css
site/vendor/GSAP-LICENSE.txt
site/vendor/ScrollTrigger.min.js
site/vendor/gsap.min.js
src/App.tsx
src/api.ts
src/journal.ts
src/styles.css
src/types.ts
tests/core.test.cjs
tests/credentials.test.cjs
tests/legacy-data.test.cjs
tests/monitor.test.cjs
```

本地官网发布包实际改变：`dist/index.html`、`dist/assets/campuslink-liquid.webp`、`dist/assets/campuslink-classic.webp`。其余公开静态资源逐字节一致。历史备份和本地开发数据未上传。

本地 Windows 正式发行副本：
`artifacts/release-v1.4.2/github-release/Campus-Link-Glass-Setup-1.4.2.exe`。
对应 `build-info.json` 和 `SHA256SUMS.txt` 位于同目录。
另有本机独立构建及官网 ZIP、Vercel 部署凭证，位于 `artifacts/release-v1.4.2/`。

## 3. 测试与检查行为

- `npm test -- --test-reporter=dot`
- `npm run test:release`
- `npm run typecheck`
- `node scripts/build-acceptance.cjs`；独立 Git 检出目录另执行 `npm run build`
- `node scripts/smoke-desktop.cjs`
- `node scripts/smoke-credentials.cjs`
- `node site/qa/capture-client.cjs`
- `node site/qa/check.cjs`
- `node scripts/release/build.cjs win x64`
- GitHub Actions 三平台构建及统一发布：[完整流水线](https://github.com/PowerT-0704/CampusLink/actions/runs/39423734015)
- 安装包 ProductVersion、ASAR 版本及凭据代码一致性、敏感文件排除检查；正式发行下载后 SHA-256 核验。
- 本地官网 9 个公开静态文件一致性检查；浏览器验收生产官网版本、产品图、下载与隐私文案；Vercel 生产域名状态检查。

## 4. 检查结果反馈

158 项客户端测试、7 项发布流程测试、类型检查、两种方式的界面构建、Windows 桌面检查及原生加密检查全部通过。原生测试验证连续三次完整 Electron 重启自动连接、断线重连、旧明文与旧密文迁移，无需重新输入密码。

官网五种尺寸、图片、外观切换、键盘焦点、减少动态效果、禁用脚本和动画库失效降级检查通过；页面错误为 0。详情见 `site/qa/results.json`。

三平台 CI 全部成功，五个安装产物及构建信息、校验和均已发布。正式发行 Windows 安装包版本为 1.4.2，大小 114243791 字节，SHA-256：

```text
59c4bf369dcbcfc9df88d9fbdf0cb72846d0390e07c993c4505807389cf869e4
```

本机打包过程有依赖探测提示 `scheduler@undefined`；已检查最终 ASAR 凭据代码、版本和隐私文件排除，打包成功。第三方原样保留的 GSAP 文件存在上游空白格式提示。Windows 宿主剪贴板不可读时，桌面测试验证了桥接载荷。

## 5. 剩余风险与边界

- Windows 未签名，macOS 未签名且未公证；macOS 钥匙串、登录项和真实校园网仍需设备实测。未执行真实校园网认证或安装到用户系统。
- 测试使用隔离数据；没有读取、迁移或修改真实账号配置、环境文件、密钥和证书。
- 保留用户要求的地址发现、缓存及持续重试行为。系统加密不能替代 HTTP 传输安全；系统密钥损坏或更换系统用户仍可能需要重新输入密码。
- 本次未新增或升级生产依赖；既有开发依赖审计问题不在本轮处理范围。
- 官网通过静态文件发布。后续需再次上传官网公开文件，或由维护者连接 Git 提供方后配置自动部署。
- 命令行直接访问 Vercel 在当前网络超时，已通过已登录浏览器成功访问生产主页并完成内容检查。
