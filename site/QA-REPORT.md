# CampusLink v1.4.2 官网检查

2026-10-20：内容、下载地址、隐私说明及两张离线客户端截图已同步至 v1.4.2。`node site/qa/capture-client.cjs`、`node site/qa/check.cjs` 均通过；五种尺寸无横向溢出，键盘焦点、图片、外观切换、减少动态效果、禁用脚本及动画库失效降级均通过，页面错误为 0。正文对比度最小值 4.58，首次加载外部请求为 0。最新机器结果见 [qa/results.json](qa/results.json)。

以下保留 v1.4.1 建站时的历史交付记录；其中版本、明文策略和“未发布”状态仅描述当时状态，当前使用说明以根 README、使用指南和 v1.4.2 发布说明为准。

# CampusLink v1.4.1 官网历史交付与占用报告

验证日期：2026-10-20（Asia/Shanghai）。范围：独立静态官网、根 README、专版使用指南。本次本地交付，未发布线上站点。

## 1. 修改概述

完成宜宾专版官网：汇流前奏、Hero、默认方案三步连接、六项能力、双外观切换、Windows / Apple Silicon / Intel 下载、开源与文档入口。支持本地双击打开、HTTP 预览、移动布局、键盘操作及静态降级。

README 与使用指南统一为 v1.4.1，包括默认液态玻璃、默认宜宾方案、本机明文密码策略、已在线时保存凭据及本项目更新渠道。当前源码的更新弹窗按钮为“稍后再说”，同一版本在本次运行中只自动提示一次，指南按源码准确说明。历史版本记录保留。

产品展示图由当前源码渲染器与离线内存数据生成，无真实账号、校园网认证或设置文件读写。图中方案版本 1.0.0 是连接方案版本，与客户端版本 1.4.1 分别表示。

## 2. 完整文件变动清单

以下路径相对 `X:\#工程\CODEX\Github-校园网自动连接\CampusLink-液态玻璃版`。无删除文件；客户端源码、入口、依赖清单、锁文件、构建配置与敏感文件未修改。

修改：

```text
README.md
docs/usage.md
```

新增：

```text
site/index.html
site/styles.css
site/app.js
site/preview.cjs
site/README.md
site/QA-REPORT.md
site/assets/icon.svg
site/assets/campuslink-liquid.webp
site/assets/campuslink-classic.webp
site/vendor/gsap.min.js
site/vendor/ScrollTrigger.min.js
site/vendor/GSAP-LICENSE.txt
site/qa/capture-client.cjs
site/qa/check.cjs
site/qa/results.json
site/qa/evidence/1440x900.png
site/qa/evidence/1280x800.png
site/qa/evidence/768x1024.png
site/qa/evidence/390x844.png
site/qa/evidence/360x800.png
site/qa/evidence/desktop-full.png
site/qa/evidence/mobile-full.png
```

## 3. 测试与检查行为

执行命令：

```powershell
node site/qa/capture-client.cjs
node --check site/app.js
node --check site/preview.cjs
node --check site/qa/capture-client.cjs
node --check site/qa/check.cjs
node site/qa/check.cjs
node site/preview.cjs
```

另外执行本地资源与锚点检查、README / 指南内容搜索、GitHub v1.4.1 Release API 下载资产核对、上游文档 HTTP HEAD 检查、图片视觉检查，以及预览进程和监听端口检查。没有运行校园网认证或客户端业务测试；没有修改客户端构建产物。截图用临时目录中的源码渲染器构建成功，原路径的 `#` 导致的 Vite 开发解析问题已通过临时构建绕开。

## 4. 检查结果

环境：Windows，本机既有 Microsoft Edge **155.0.4283.62**，Playwright 无界面模式，设备像素比 1。测试复用既有项目依赖，没有安装浏览器或 npm 包。

| 场景 | 结果 |
| --- | --- |
| 1440×900、1280×800 | 通过：布局、五区块、图片、焦点、外观切换，无横向溢出 |
| 768×1024、390×844、360×800 | 通过：单列布局、图片、焦点、外观切换，无横向溢出 |
| `file://`，JavaScript 开启 | 通过：正文、图片、下载链接和切换 |
| `file://`，JavaScript 禁用 | 通过：正文、图片、下载链接、经典图片替代入口；隐藏无效切换按钮 |
| 减少动态效果 | 通过：ScrollTrigger 数量为 0，内容可见，切换无动画 |
| 动效库不可用 | 通过：内容可见，原生外观按钮仍有效 |
| 对比度 | 通过：组合背景及环境光亮度包络检查，正文最低 **4.58:1** |
| 控制台、资源 | 通过：无页面异常、控制台错误或 HTTP 资源错误；外部资源请求 0 |
| 本地引用、锚点与版本 | 通过：6 张功能卡、3 个 v1.4.1 下载资产、本地资源均有效 |
| 下载与文档 | 3 个下载链接与正式 Release API 一致；上游在线文档 HTTP 200 |
| 最终语法检查 | 4 个 JavaScript / CommonJS 文件均通过 |

完整自动化数据见 [qa/results.json](qa/results.json)。[桌面整页](qa/evidence/desktop-full.png)与[移动整页](qa/evidence/mobile-full.png)留作视觉验收证据。

### 新增组件与磁盘、加载占用

| 新增组件 | 版本 | 原始大小 | gzip 大小 |
| --- | --- | ---: | ---: |
| GSAP Core | 3.15.0 | 72,927 B / 71.22 KiB | 28,420 B / 27.75 KiB |
| ScrollTrigger | 3.15.0 | 44,575 B / 43.53 KiB | 18,003 B / 17.58 KiB |
| 动效脚本合计 | 同一 GSAP 库的核心与插件 | **117,502 B / 114.75 KiB** | **46,423 B / 45.33 KiB** |

- 官网生产文件（HTML / CSS / JS / SVG / WebP 及许可说明）：**265,213 B / 259.00 KiB**；逐文件 gzip 合计 **160,723 B / 156.96 KiB**。WebP 已压缩，gzip 数字仅作编码体积参考。
- 首屏冷加载的 HTML 与资源正文：**211,308 B / 206.36 KiB**；含浏览器估算响应头的传输量 **213,708 B / 208.70 KiB**。本机预览不启用 gzip。首屏未加载经典外观图；滚动后按需加载。浏览器将 favicon 和页面图标计为两个资源条目，统计保留实际结果。
- 两张新产品图合计 **101,830 B / 99.44 KiB**。系统字体，没有新增字体文件。
- 官网目录总文件大小（含 QA 脚本、结果、PNG 证据和本报告）：**4,409,140 B / 4.205 MiB**。这是文件长度合计，不代表文件系统分配簇大小。
- 新增 npm 包 **0**，全局安装 **0**，新增后台服务 **0**。Node.js、Vite、React、Playwright 与 Edge 均使用本机既有组件；临时源码构建目录已移除。部署时可省略 `qa/` 和预览脚本。

### 运行占用实测

整页基准：1440×900，首屏加载及动画结束后，在同一页面分别采样。下列 CPU 为 CDP `TaskDuration` / 实际采样时长，即渲染器主线程忙碌比例；内存为 CDP JavaScript 堆。

| 场景 | 采样时长 | 渲染器主线程忙碌比例 | JS 堆 |
| --- | ---: | ---: | ---: |
| 静止 | 3.00 秒 | 1.98% | 2.11 MiB |
| 滚动 | 3.31 秒 | 8.58% | 2.80 MiB |
| 卡片指针交互 | 3.28 秒 | 8.05% | 4.22 MiB |

这些是包含 GSAP、页面和浏览器执行开销的短时观测，**不是单独 GSAP 的增量占用，也不是浏览器完整进程内存或系统总 CPU**。不同设备及采样状态会变化。浏览器完整进程内存、组件单独 CPU / 内存增量及独显缺失设备帧率均为 **unverified**。

### 端口与进程

预览使用 `127.0.0.1:4173`，进程 PID **137500**。交付前已停止并再次检查：4173 无监听，PID 不存在，本任务 QA Node 进程 0、Playwright 浏览器进程 0。自动化测试的临时服务与浏览器均已关闭。网站本身无需常驻进程；重新预览时运行上面的预览命令。

## 5. 剩余风险与验证边界

- Safari、Firefox、真实移动设备及低性能办公笔记本的实际滚动帧率：**unverified**。本次通过的是 Edge 的桌面与移动视口自动化。
- 对比度检查使用保守背景估计；复杂材质所有像素、显示器和浏览器组合的完整 WCAG 审计：**unverified**。截图内的客户端文字属于原有界面预览。
- 系统 Acrylic、macOS 安装与校园网登录均未执行，本次网站截图只展示离线界面。
- 下载地址固定为 v1.4.1；发布后续版本时需要同步更新官网、README 与指南。本次仅核对发布资产，没有下载或执行安装包。
- 本地目录没有 `.git` 元数据，未创建 Git 提交或 PR。文件级变动清单如上。
- 新增 GSAP 文件保留其自身 Standard License，不能将其许可误写为项目 MIT。详情见 [vendor/GSAP-LICENSE.txt](vendor/GSAP-LICENSE.txt)。
