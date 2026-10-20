# 岚连 Campus Link · CDUTYB 专版官网

独立静态官网，内容基准为 **v1.4.2**。面向成都理工大学宜宾校区，以默认宜宾方案和三步连接为主要路径。无需安装依赖、无需构建桌面客户端，可单独复制此目录用于静态托管。

## Vercel 部署

将本仓库导入 Vercel，Root Directory 设为 `site`，Framework Preset 选择 `Other`，无需 Build Command，Output Directory 使用 `.`。无需环境变量和额外依赖。`main` 的后续提交会触发官网部署。实际生产地址以 Vercel 的 Domains 页面及根 README 为准。

## 打开与预览

直接在浏览器打开 `index.html`，或在项目根目录执行：

```powershell
node site/preview.cjs
```

访问 `http://127.0.0.1:4173`，按 `Ctrl+C` 停止；指定其他端口，例如 `node site/preview.cjs 4174`。服务器仅监听本机回环地址，不启动桌面客户端，不处理校园网认证。目录及上级路径中的中文和 `#` 均可正常使用。

## 文件与依赖

- `index.html`：完整语义化内容、三平台下载及文档链接。正文、图片与下载不依赖 JavaScript。
- `styles.css`：响应式布局、环境光、定向玻璃材质、焦点样式及减少动态效果规则。
- `app.js`：滚动联动、按事件更新的动态阴影、卡片高光与双外观展示。
- `assets/`：现有项目图标与 v1.4.2 当前界面的两张 WebP 离线预览。
- `vendor/`：固定 GSAP **3.15.0** 与 ScrollTrigger **3.15.0**，保留原始头部及许可说明；二者使用 GSAP Standard License，与项目 MIT 许可分别适用。
- `preview.cjs`：仅使用 Node.js 标准库的本地静态服务器。
- `qa/`：复现脚本、验证结果和截图证据，静态部署时可省略。

没有新增 npm 包、锁文件、全局工具或后台服务。运行时不请求 CDN、GitHub API、远程字体或分析服务；只有点击外部链接和下载时才访问对应地址。

## 动效约定

- 使用 GSAP Core + **ScrollTrigger**，不加载其他动画插件。汇流 SVG 光线播放一次，持续 **2.2 秒**，不阻挡内容或操作。
- 区块入场采用 32px 位移、0.6 秒时长和 100ms 错峰，使用 `power2.out`；光源使用 `power3.out`，汇流使用 `power3.inOut`。
- 首屏滚动过渡从 Hero 顶部抵达视口顶部开始，到三步连接区顶部抵达视口中线结束，`scrub: 0.6`；产品预览最多上移 `min(48px, 10vh)`、缩放至 0.97。滚动进度映射使用无额外缓动曲线，避免对 scrub 重复缓动。
- 三层径向光源通过 transform 位移，桌面最大 24px，移动端最大 8px。没有大面积逐帧 Canvas 或 WebGL。
- 卡片阴影结合视口位置与指针距离，约 30ms 节流，仅处理可见卡片；无持续空转的 `requestAnimationFrame`。指针停止后阴影保留，离开时清除高光激活状态。没有常驻 `will-change`。
- 不支持悬停的设备不启用鼠标追踪；切换外观交叉淡化 0.6 秒。背景模糊在移动端降至 9px。
- `prefers-reduced-motion: reduce`：不创建 ScrollTrigger，取消前奏、视差、运动和淡化，内容立即可见，外观即时切换；运行期间更改系统偏好也会生效。

## 内容、图像与维护

产品事实来自根 README、`docs/usage.md`、`docs/releases-v1.4.2.md`、当前 `electron/service.cjs` / `profiles.cjs` / `updates.cjs` 及 [v1.4.2 正式发布](https://github.com/PowerT-0704/CampusLink/releases/tag/v1.4.2)。下载链接固定对应此版本，未来升级时应同时更新网站、README 与指南，不在运行时调用更新 API。

两张产品图使用**当前源代码渲染器**和内存中的离线桥接数据，展示默认选中的宜宾方案与 v1.4.2。它们不是校园网认证成功证明，也不模拟 Windows 系统 Acrylic。玻璃图使用中性背景展示应用内材质，无真实凭据和网络会话。原始图标来自 `assets/icon.svg`。

重制图片使用现有项目依赖和本机 Edge：

```powershell
node site/qa/capture-client.cjs
```

脚本只复制公开 UI 源码至受控临时目录并临时构建，避免 Vite 对 `#` 路径的限制，不修改客户端 `dist/`、配置、设置文件或真实账号。浏览器请求限定为本次临时本地服务，完成后关闭浏览器、服务并移除临时目录。

## 验收复现

需要已有的项目 Playwright 依赖和已安装 Microsoft Edge；脚本不会安装浏览器：

```powershell
node --check site/app.js
node --check site/preview.cjs
node --check site/qa/capture-client.cjs
node --check site/qa/check.cjs
node site/qa/check.cjs
```

自动检查 1440×900、1280×800、768×1024、390×844、360×800，覆盖横向溢出、图片、外观按钮、键盘焦点、`file://`、禁用 JavaScript、减少动态效果和颜色对比度。对比度检查使用组合背景及光源最亮包络的保守估计，不能替代所有显示设备上的实机检查。

CPU 指标是 CDP `TaskDuration` 增量 / 采样时间，表示**整个页面的渲染器主线程忙碌比例**，不是系统总 CPU。内存是整个页面 JavaScript 堆，不是浏览器完整进程内存，也不是单独 GSAP 的增量。压缩体积是 `gzipSync` 结果；预览服务器不启用 gzip，实际加载使用原始资源。

实测结果、新增组件占用、完整文件清单和验证边界见 [QA-REPORT.md](QA-REPORT.md)。
