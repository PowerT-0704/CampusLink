// 开发日志页数据：上游介绍、授权署名与版本记录（新 → 旧）。
export interface JournalEntry {
  version: string;
  scope: 'upstream' | 'derived';
  date: string;
  title: string;
  items: string[];
}

export const upstreamRepo = 'https://github.com/65658dsf/CampusLink';
export const upstreamSite = 'https://campuslink.xzncraft.cn';
export const forkRepo = 'https://github.com/PowerT-0704/CampusLink';
export const maintainer = { name: 'PowerT-0704', email: '1203019025@qq.com' };

export const projectIntro = '岚连 Campus Link 是面向 Windows / macOS 的校园网认证工具，使用 Electron、React 和 TypeScript 构建，支持连接与注销、启动状态检测、断线自动重连、开机自启动、系统托盘，以及通过 JSON 导入的校园网连接方案。本应用是基于它的成都理工大学（宜宾校区）对接方案版本，已获得原作者完整授权的衍生版本。';

export const journalEntries: JournalEntry[] = [
  {
    version: '1.4.2', scope: 'derived', date: '2026-10-20', title: '加密凭据与稳定恢复',
    items: [
      '记住密码改用系统加密，保存前验证可解密；主进程缓存可用凭据，重启自动恢复，无需每次输入。',
      '兼容旧明文与旧加密凭据迁移；系统暂不可读取时保留密文和自动连接偏好，支持重试恢复。',
      '配置写入成功后再更新内存、会话与守护状态；保存失败保持原状态，自启动设置失败展示实际状态。',
      '首次引导可选择记住密码、仅本次使用或跳过；完善弹窗键盘操作、焦点恢复及更新提示排队。',
      '同步应用版本、安装包、README 与官网说明；保留认证协议、地址发现和自动重试规则。',
    ],
  },
  {
    version: '1.4.1', scope: 'derived', date: '2026-10-17', title: '项目仓库入口与更新体验',
    items: [
      '开发日志新增「本项目仓库」入口，可直接打开 GitHub 项目主页（PowerT-0704/CampusLink）。',
      '首次启动引导优化：已登录校园网时也允许输入并保存当前账号密码，自动连接与断线守护可用。',
      '默认界面改为液态玻璃（仍可在应用设置一键切换回经典）；顶栏去框线并收窄、四角圆弧一致、导航滑块与切换过场动画。',
      '软件更新提示支持前往 GitHub Releases 下载或稍后再说，应用设置中可手动检查更新。',
    ],
  },
  {
    version: '1.4.0', scope: 'derived', date: '2026-10-16', title: '液态玻璃顶栏贯通与体验更新',
    items: [
      '新增明文密码管理与「管理账号密码」入口，一键设置账号密码（不再依赖系统加密）。',
      '连接概览显示当前账号；新增首次启动引导弹窗，可设置账号、密码与断连检测间隔。',
      '检测间隔默认 10 秒；标题栏吸顶，滚动时保持可拖拽。',
      '液态玻璃改为纯透光材质（无自带底色）；顶部玻璃独立成形、无边框高光并整体收窄，内容在玻璃下方独立滚动。',
      '侧边栏新增界面外观切换的过场动画；导航选中高亮改为滑块式平滑滑动。',
    ],
  },
  {
    version: '1.3.0', scope: 'derived', date: '2026-10-16', title: '检测节奏与托盘体验',
    items: [
      '检测间隔默认值改为 10 秒，可在应用设置中按需调整（5–3600 秒）。',
      '托盘悬浮显示 IP 与在线时长，托盘菜单支持“暂停 / 恢复守护”。',
      '左侧新增“开发日志”页，集中展示版本记录、上游介绍与授权署名。',
    ],
  },
  {
    version: '1.2.0', scope: 'derived', date: '2026-10-16', title: 'CDUTYB 专版改造',
    items: [
      '默认内置成都理工大学（宜宾校区）锐捷 ePortal 方案；贵州轻工（Dr.COM）与四川大学方案移入“更多内置方案”折叠区。',
      '全量更名为“岚连 · CDUTYB 专版”，旧设置自动迁移；新增 MIT 许可与双署名。',
      '认证失败提示更友好：区分账号密码、设备上限、欠费套餐与未绑定等情况。',
    ],
  },
  {
    version: '1.1.3', scope: 'derived', date: '2026-10-16', title: '成理宜宾登录修复',
    items: [
      '修正锐捷登录的密码加密输入（密码 + “>” + mac），修复“用户名或密码错误”的误报。',
    ],
  },
  {
    version: '1.1.2', scope: 'derived', date: '2026-10-16', title: '快速检测与诊断',
    items: [
      '网络变化后立即进行静默状态检查（3 秒接口轮询，零网络流量）。',
      '新增“导出诊断包”：脱敏的应用信息、网络概况与本次运行日志。',
    ],
  },
  {
    version: '1.1.1', scope: 'upstream', date: '2026-10-12', title: '锐捷 ePortal 支持',
    items: [
      '新增锐捷 ePortal Web 适配与认证门户自动发现。',
      '完善认证结果确认与诊断信息脱敏。',
    ],
  },
  {
    version: '1.1.0', scope: 'upstream', date: '2026-10-11', title: '自动重连与跨平台',
    items: [
      '断线自动重连，检测间隔 5–3600 秒可配置。',
      'macOS 支持与标签驱动的自动发布流程。',
    ],
  },
  {
    version: '1.0.2', scope: 'upstream', date: '2026-10-11', title: 'Dr.COM 登录修正',
    items: [
      '对齐贵州轻工职业大学 Dr.COM 的登录参数顺序与响应诊断。',
    ],
  },
];
