# 会同一中学生社区中心接口清单

生产站点：`https://htyz.space`

除公开读取接口外，写入接口都要求同源请求和 `X-CSRF-Token`。普通用户与管理员使用不同的 HttpOnly 会话 Cookie；管理员目录不是安全边界，角色校验、限流和审计仍在服务端执行。

## 公共与账号

- `GET /api/health`：服务、数据库和邮件状态
- `GET /api/session`：当前会话、CSRF 令牌、邮件可用状态
- `POST /api/auth/register`：邮箱注册并发送一次性验证邮件
- `POST /api/auth/resend-verification`：重发验证邮件
- `POST /api/auth/verify`：一键验证邮箱
- `POST /api/auth/login`、`POST /api/auth/logout`
- `POST /api/auth/forgot-password`、`POST /api/auth/reset-password`
- `GET /api/me`：个人资料及本人发布内容状态
- `PATCH /api/me/profile`：修改公开用户名和简介
- `POST /api/me/avatar`：上传头像
- `GET /api/avatar/:userId`：读取公开头像

## 内容与社交

- `GET /api/public/home`：首页真实统计和最新公开内容
- `GET /api/public/moments`、`POST /api/moments`：空间动态读取/投稿（最多 9 图）
- `GET /api/public/profiles/:username`：公开个人空间
- `GET /api/public/wall`、`POST /api/wall`：校园墙读取/投稿（支持前台匿名）
- `POST /api/wall/polls`：仅校园墙发起独立单选投票；JSON 字段 `question`、`options`（2–8 项）、`anonymous`（可选）
- `POST /api/wall/polls/:pollId/votes`：JSON 字段 `optionId`；每个账号仅可选择一次
- `GET /api/public/contributions`、`GET /api/public/contributions/:id`、`POST /api/contributions`
- `GET /api/public/news`：返回 `images` 图片地址数组
- `GET /api/public/questions`、`GET /api/public/questions/:id`
- `POST /api/questions`、`POST /api/questions/:id/answers`
- `POST /api/suggestions`
- `POST /api/staff-applications`
- `GET /api/media/:id`、`GET /api/media/moment/:id`、`GET /api/media/wall/:id`、`GET /api/media/news/:id`
- `GET /api/public/posts/:type/:id`：六类公开内容的独立阅读页
- `GET /api/public/posts/:type/:id/engagement`：真实点赞数、评论数和当前用户点赞状态
- `GET /api/public/posts/:type/:id/comments`：分页读取公开评论
- `POST /api/posts/:type/:id/comments`、`DELETE /api/comments/:id`：发布评论、删除自己的评论
- `PUT /api/posts/:type/:id/like`、`DELETE /api/posts/:type/:id/like`：点赞或取消点赞
- `GET /api/notifications`、`GET /api/notifications/unread-count`：仅查看自己的站内消息
- `POST /api/notifications/:id/read`、`POST /api/notifications/read-all`：标记已读

空间动态、校园墙、投稿、问题、回答和新闻均可评论、点赞。普通用户的评论直接公开；管理员可在发布后删除违规评论。校园墙评论可选择前台匿名；匿名发帖者回复自己的帖子时始终匿名。别人点赞或评论自己的内容会生成站内消息，不发送额外邮件。校园墙匿名仅隐藏公开作者信息，管理员处理违规时仍可确认提交账号。

校园墙列表和帖子详情返回 `poll`。未投票账号只收到问题、选项和 `myOptionId: null`，不收到 `totalVotes`、各选项 `votes` 或 `percent`；投票后才返回这些汇总数据，不公开投票者身份。投票帖沿用校园墙的评论、点赞、作者删帖和后台管理接口。

## 管理员目录

前端入口：`/htyzSlowSnow`  
激活入口：`/htyzSlowSnow/activate?token=...`

管理员 API 统一位于 `/api/htyzSlowSnow`：

- `POST /api/htyzSlowSnow/auth/login`
- `POST /api/htyzSlowSnow/auth/logout`
- `POST /api/htyzSlowSnow/auth/activate`
- `POST /api/htyzSlowSnow/auth/change-password`：首次登录修改初始密码后才能使用后台
- `GET /api/htyzSlowSnow/dashboard`
- `GET /api/htyzSlowSnow/posts?type=moment&limit=30&offset=0`：浏览帖子或评论；`type` 可选 `contribution`、`moment`、`wall`、`question`、`answer`、`comment`
- `DELETE /api/htyzSlowSnow/posts/:type/:id`：归档删除违规帖子并记录操作
- `GET /api/htyzSlowSnow/users`、`PATCH /api/htyzSlowSnow/users/:id/status`：超级管理员及版主浏览账号、封禁或恢复账号
- `GET /api/htyzSlowSnow/news`
- `POST /api/htyzSlowSnow/news`：`multipart/form-data`，字段 `title`、`body`、`images`；最多 4 张 JPG/PNG/WebP，每张不超过配置的上传上限
- `PATCH /api/htyzSlowSnow/news/:id`
- `GET /api/htyzSlowSnow/suggestions`
- `PATCH /api/htyzSlowSnow/suggestions/:id`
- `GET /api/htyzSlowSnow/applications`（超级管理员）
- `POST /api/htyzSlowSnow/applications/:id/decision`（超级管理员；批准后发送随机初始密码）
- `POST /api/htyzSlowSnow/staff/:id/resend-activation`（超级管理员）
- `GET /api/htyzSlowSnow/audit`（超级管理员）

## SMTP 环境变量

推荐使用已有邮箱服务的 SMTP，不在小型 VPS 上自建外发邮件服务器。QQ 邮箱可用：

```dotenv
SMTP_HOST=smtp.qq.com
SMTP_PORT=465
SMTP_SECURE=true
SMTP_USER=你的完整QQ邮箱
SMTP_PASS=邮箱SMTP授权码（不是QQ登录密码）
MAIL_FROM=与SMTP_USER相同的邮箱
MAIL_FROM_NAME=会同一中学生社区中心
```

配置后重启 `htyz.service`，`GET /api/health` 的 `mail` 应变为 `configured`。注册验证和重置密码邮件包含一次性按钮链接。管理员申请经超级管理员批准后，系统给申请邮箱发送随机初始密码；首次登录必须修改密码。邮件中的初始密码不写入源码或日志。
