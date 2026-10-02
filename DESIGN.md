---
name: htyz.space 学校社区
description: 夜自习后的信号窗——克制、诚实、面向会同一中在校生与毕业生的交流界面
colors:
  signal: "#d9ff43"
  signal-ink: "#405100"
  electric: "#83e5dd"
  night: "#0b0d0c"
  night-soft: "#151916"
  paper: "#f0ede3"
  paper-deep: "#e4dfd1"
  ink: "#121713"
  ink-muted: "#556158"
  warm-warning: "#ffbf69"
  danger: "#a3312d"
  success: "#2a6844"
typography:
  display:
    fontFamily: "Noto Serif SC, Songti SC, SimSun, serif"
    fontSize: "clamp(3.5rem, 7vw, 6rem)"
    fontWeight: 700
    lineHeight: 0.98
    letterSpacing: "-0.04em"
  headline:
    fontFamily: "Noto Serif SC, Songti SC, SimSun, serif"
    fontSize: "clamp(2.5rem, 5vw, 5rem)"
    fontWeight: 700
    lineHeight: 1.05
    letterSpacing: "-0.035em"
  body:
    fontFamily: "PingFang SC, Microsoft YaHei, Noto Sans CJK SC, Source Han Sans SC, system-ui, sans-serif"
    fontSize: "1rem"
    fontWeight: 400
    lineHeight: 1.75
  label:
    fontFamily: "PingFang SC, Microsoft YaHei, Noto Sans CJK SC, Source Han Sans SC, system-ui, sans-serif"
    fontSize: "0.82rem"
    fontWeight: 650
    lineHeight: 1.5
rounded:
  control: "10px"
  compact: "8px"
  pill: "999px"
spacing:
  xs: "8px"
  sm: "12px"
  md: "18px"
  lg: "24px"
  xl: "34px"
components:
  button-primary:
    backgroundColor: "{colors.ink}"
    textColor: "{colors.paper}"
    rounded: "{rounded.control}"
    padding: "11px 17px"
    typography: "{typography.label}"
  button-light:
    backgroundColor: "{colors.paper}"
    textColor: "{colors.ink}"
    rounded: "{rounded.control}"
    padding: "11px 17px"
    typography: "{typography.label}"
  input:
    backgroundColor: "rgba(255,255,255,0.48)"
    textColor: "{colors.ink}"
    rounded: "{rounded.control}"
    padding: "12px 14px"
    height: "50px"
  paper-panel:
    backgroundColor: "{colors.paper}"
    textColor: "{colors.ink}"
    padding: "30px 34px"
---

# Design System: htyz.space 学校社区

## Overview

**Creative North Star: "夜自习后的信号窗"**

界面像晚自习后仍亮着几扇窗的教学楼：外部是近黑的安静场域，长内容落在暖纸表面，信号绿与冷青色负责定位、焦点与科技感。首页以透明信号控制台承载真实频道和计数，不使用虚构热度、示例人物或社交平台式卡片瀑布来制造繁荣感。

密度遵循“方向清楚，内容留白”的原则。首页允许强烈的大字与不对称构图；表单、新闻、问答和管理台优先阅读效率。状态必须同时由文字和形态表达，颜色只作第二层提示。

**Key Characteristics:**

- 近黑导航场、暖纸阅读面与稀有酸绿信号。
- 自托管宋体展示字配合系统中文无衬线正文。
- 首页玻璃控制台、响应指针及点击的有限粒子连线与真实频道入口；粒子可手动关闭。
- 导航始终横向可见；手机端为可横向滚动的单排栏目。
- 入场动效只播放一次，背景粒子离屏停止；其余动效服务于状态反馈。
- 数据为空时明确留白，不放任何伪造内容。

## Colors

色彩角色少而明确：夜色负责方向，纸色负责阅读，信号色只标记当前动作或关键焦点。

### Primary

- **晚自习信号绿**：用于品牌圆点、焦点环、轨道标记和少量高优先级状态；不能铺成大面积背景。

### Secondary

- **暖光警示**：只用于需要留意但不是错误的提示面。
- **成功绿**与**警示红**：仅用于明确的操作状态，并始终配有可读文字。

### Neutral

- **教学楼夜色**与**夜色软层**：用于导航、页脚、管理员入口和首屏场域。
- **作业纸**与**旧纸阴影**：用于长文、表单、列表与内容分层。
- **墨色**与**淡墨**：分别承担主要文字和解释性文字。

### Named Rules

**The Rare Signal Rule.** 信号绿只占屏幕很小比例；它的稀有性就是导航能力。

**The Honest State Rule.** 任何状态都必须写出来，不能只依靠绿色、红色或亮度差异。

## Typography

**Display Font:** Noto Serif SC（回退到 Songti SC / SimSun）  
**Body Font:** 系统中文无衬线栈（PingFang SC / Microsoft YaHei / Noto Sans CJK SC / Source Han Sans SC）

**Character:** 展示宋体让首页陈述与栏目标题带有校刊和纸面记录的气质；正文无衬线保持表单、审核信息和长段落的清晰度。展示字体通过站内资产自托管，不请求第三方字体服务。

### Hierarchy

- **Display**（700，流体 3.5–6rem，0.98）：首页核心陈述和页面级标题。
- **Headline**（700，流体 2.5–5rem，1.05）：主要章节和原则陈述。
- **Title**（650–700，约 1.35–3.25rem，1.08–1.15）：投稿、新闻和问题标题。
- **Body**（400，1rem，1.75）：正文与说明；长段落保持约 65–75 个拉丁字符的等效行长。
- **Label**（650，0.82rem，1.5）：状态、表单标签、时间和紧凑操作。

### Named Rules

**The Two-Voice Rule.** 宋体只负责展示层级；交互、数据与正文一律使用无衬线体。

## Layout

桌面内容宽度为 `min(1240px, 100vw - 48px)`。首页首屏采用左右不对称两栏：左侧大字陈述，右侧为信号控制台；后续最新内容采用 1.25/0.75 的编辑式分栏。内容页以大标题带和单列阅读流为主，问答等需要上下文的页面才使用主次双栏。

1000px 以下首屏和管理台转为单列；900px 以下导航移到标题下方，保持横向单排并只在自身容器内滚动；760px 以下页面边距变为 18px，内容和新闻列表顺序堆叠。最小支持宽度为 320px，页面本身不应水平滚动。

间距以 8、12、18、24、34px 为常用控制节奏；章节间距明显放大到 70–140px，让内容组之间像翻页而不是连续卡片。

## Elevation & Depth

系统以色面、细分隔线和留白建立层级。导航、首屏控制台、注册人数和首页摘要可用低透明度玻璃面与 14–20px 背景模糊，但长文和表单仍保持稳定对比度；禁止硬偏移阴影和拟物纸张纹理。

### Shadow Vocabulary

- **控制悬浮**（`0 12px 30px rgba(18,23,19,.2)`）：主按钮 hover。
- **表单聚焦**（`0 8px 22px rgba(18,23,19,.08)`）：输入框获得焦点。
- **管理纸片**（`0 10px 30px rgba(18,23,19,.07)`）：后台列表中需要逐项判断的记录。
- **信号辉光**（`0 8px 30px rgba(217,255,67,.34)`）：只用于细小信号标记。

**The Readable Glass Rule.** 玻璃只用于方向与分层，不覆盖长段正文；模糊效果失效时，半透明底色仍必须保证文字可读。

**管理台例外。** 管理员登录与工作台使用独立的蓝白工作配色，便于与公开社区区分；保留明确的权限状态、真实统计和完整的操作记录。导航、表单与记录列表铺满可用工作区，动效只用于切换与反馈，并尊重减少动态效果设置。

## Shapes

控件采用 10px 的轻度圆角，紧凑操作可用 8px，状态胶囊才使用完全圆形。内容容器通常没有外轮廓圆角，而用一像素半透明分隔线保持编辑式连续性。信号点、轨道节点和品牌标记使用圆形，与纸面矩形形成唯一的几何对照。

## Components

### Buttons

- **Shape:** 轻度圆角（10px），最小高度 44px。
- **Primary:** 墨色底、浅色字，内部间距 11px 17px。
- **Hover / Focus:** hover 上移 2px并加深阴影；active 回落并缩小到 0.98；键盘焦点使用 3px 信号绿外环。
- **Light:** 仅在夜色表面使用暖纸底与墨色字。

### Cards / Containers

- **Corner Style:** 公共内容默认无圆角；后台任务纸片不依靠圆角强调。
- **Background:** 作业纸、旧纸阴影或夜色软层。
- **Shadow Strategy:** 公共内容平面，管理任务使用低对比环境阴影。
- **Border:** 一像素墨色或浅色透明分隔线。
- **Internal Padding:** 常用 30px 34px，手机端收敛到 22px 18px。

### Inputs / Fields

- **Style:** 半透明白色背景、1px 淡墨边框、10px 圆角、最小高度 50px。
- **Focus:** 变为白色背景、墨色边框并出现低强度环境阴影。
- **Error / Disabled:** 错误用文字与拒绝红共同表达；禁用态降低透明度并使用不可用光标。

### Navigation

桌面导航固定在 76px 高的近黑玻璃栏中，当前项以信号绿短线标记。900px 以下变为两行头部：品牌和账户操作在上，全部栏目在下方横向滚动的一排中直接可见；不使用汉堡菜单或弹层。

### Signal Console

首页六个真实入口位于玻璃信号控制台。每项使用图标、标题和真实计数或诚实空状态；中心环形图是纯装饰，不暗示在线人数。轻量粒子随指针和点击产生有限反馈，离屏或页面隐藏时暂停，并提供显式开关；`prefers-reduced-motion` 下不自动启动。

## Do's and Don'ts

### Do:

- **Do** 让真实内容、发布状态和空状态成为页面主角。
- **Do** 把长文和表单放在暖纸面，把夜色留给导航与方向感。
- **Do** 为每个颜色状态提供文字、图标或形态上的等价提示。
- **Do** 保持移动栏目直接可见，并让导航滑动局限在导航容器内。
- **Do** 保持首屏动效有限、一次性且兼容 reduced motion。

### Don't:

- **Don't** 伪造用户、投稿、新闻、回答、在线人数或增长数字。
- **Don't** 把页面变成传统校园门户的蓝白栏目网格或社交产品卡片墙。
- **Don't** 大面积使用信号绿，或把红绿作为唯一的状态区别。
- **Don't** 在正文中使用展示宋体，或让装饰动画遮挡点击、持续占用离屏资源。
- **Don't** 使用第三方跟踪字体、硬偏移阴影、表情符号图标或无意义拟物纹理。

## 2026-09-24 粒子与玻璃增量

首页增强为青蓝深色玻璃信号台：三层轨迹、星点连线、指针扰动与空白处点击扩散；频道悬停/键盘聚焦联动中心标签。首页展示标题改为清晰无衬线，其他阅读排版和蓝白管理后台保留。动画手机降密度、限制像素倍率，离屏/后台停止运算；暂停选择保存在本地，并尊重减少动态效果。只更新前端，不改数据结构或权限。最新完整需求以 FINAL_PROJECT_PROMPT.md 为准，旧 PROJECT_PROMPT.md 仅为历史版本。

## 2026-09-25 社交与管理增量

频道顺序固定为新闻、校园墙、投稿、空间动态、问答、建议、用户；移动端仍是直接可见的横向栏目。发布区位于信息流前方，图片点击打开可关闭的查看器，视频使用原生播放控件；上传以确定性的进度条区分传输完成与服务端校验。公开作者头像与名字共同指向主页，年级标签随身份出现，私聊操作只对非匿名作者开放。

私聊采用双侧气泡、发送时间、已读文字与会话列表，不把色彩作为唯一状态说明。管理台沿用蓝白工作界面，以真实 14 日曲线及可展开数据表互补；超级管理员专属的账号与聊天操作清楚标记权限与不可逆后果，账号密码仅提供一次性重置，不显示原密码。新用户注册的 QQ 邮箱格式提示直接贴近邮箱输入框；旧用户的补全年级页阻止浏览其他频道，但保留退出入口。

作者删帖入口沿用帖子底部互动栏，仅对作者显示；点击后以帖内文字确认后果，再执行下架。匿名校园墙也只向实际作者显示该入口，不在公开作者信息中泄露身份。其他成员仍使用原有点赞和评论操作。

校园墙发布区增加“发布内容 / 发起投票”切换。投票独立成帖，问题与 2–8 个选项置于轻量蓝白投票面板；投票前以清晰的单选圆点呈现可点击选项，不显示任何票数或比例。投票后选项切换为水平填充结果条，标出自己的选择、每项票数与比例及总票数；动画使用 transform 并支持减少动态效果。匿名选项默认关闭，投票者身份不公开。
