import nodemailer from 'nodemailer'

export function createMailer(config) {
  const configured = Boolean(config.mail.host && config.mail.user && config.mail.pass && config.mail.from)
  const transport = configured
    ? nodemailer.createTransport({
        host: config.mail.host,
        port: config.mail.port,
        secure: config.mail.secure,
        connectionTimeout: 10000,
        greetingTimeout: 10000,
        socketTimeout: 15000,
        auth: { user: config.mail.user, pass: config.mail.pass }
      })
    : null

  async function send({ to, subject, heading, text, actionLabel, actionUrl, footer = '如果这不是你的操作，请忽略这封邮件。链接具有时效性且只能使用一次。' }) {
    if (!transport) {
      const error = new Error('SMTP is not configured')
      error.code = 'MAIL_NOT_CONFIGURED'
      throw error
    }
    const html = `<!doctype html><html lang="zh-CN"><body style="margin:0;background:#f4f1e8;color:#111713;font-family:Arial,sans-serif">
      <div style="max-width:600px;margin:0 auto;padding:40px 24px">
        <p style="letter-spacing:.08em;color:#4d5b51">会同一中学生社区中心 · htyz.space</p>
        <h1 style="font-size:28px;line-height:1.25">${escapeHtml(heading)}</h1>
        <p style="font-size:16px;line-height:1.8">${escapeHtml(text).replaceAll('\n', '<br>')}</p>
        <a href="${escapeHtml(actionUrl)}" style="display:inline-block;margin-top:18px;padding:12px 18px;background:#171d19;color:white;text-decoration:none;border-radius:8px">${escapeHtml(actionLabel)}</a>
        <p style="margin-top:28px;font-size:13px;line-height:1.6;color:#59645d">${escapeHtml(footer)}</p>
      </div></body></html>`
    await transport.sendMail({
      from: { name: config.mail.fromName, address: config.mail.from },
      to,
      subject,
      text: `${heading}\n\n${text}\n\n${actionLabel}: ${actionUrl}`,
      html
    })
  }

  return {
    configured,
    verifyConnection: () => (transport ? transport.verify() : Promise.resolve(false)),
    sendVerification: (email, token) => send({
      to: email,
      subject: '验证你的管理员申请邮箱',
      heading: '验证管理员申请邮箱',
      text: '只有申请管理员才需要验证邮箱。点击下方按钮完成验证，链接 24 小时内有效。',
      actionLabel: '验证邮箱',
      actionUrl: `${config.siteOrigin}/verify?token=${encodeURIComponent(token)}`
    }),
    sendReset: (email, token) => send({
      to: email,
      subject: '重置会同一中学生社区中心密码',
      heading: '重置密码',
      text: '点击下方按钮设置新密码。链接 30 分钟内有效。',
      actionLabel: '设置新密码',
      actionUrl: `${config.siteOrigin}/reset-password?token=${encodeURIComponent(token)}`
    }),
    sendStaffActivation: (email, token) => send({
      to: email,
      subject: '激活会同一中学生社区中心管理员账号',
      heading: '管理员申请已通过',
      text: '请通过一次性链接自行设置管理员密码。我们不会通过邮件发送明文密码。',
      actionLabel: '激活管理员账号',
      actionUrl: `${config.siteOrigin}/htyzSlowSnow/activate?token=${encodeURIComponent(token)}`
    }),
    sendStaffInitialPassword: (email, password) => send({
      to: email,
      subject: '会同一中学生社区中心管理员申请已通过',
      heading: '管理员账号已开通',
      text: `你的管理员初始密码：${password}\n首次登录后必须立即更换密码。请勿转发此邮件。`,
      actionLabel: '前往管理员入口',
      actionUrl: `${config.siteOrigin}/htyzSlowSnow`,
      footer: '如果这不是你的申请，请勿使用该密码，并联系网站负责人。登录后请立即更换初始密码。'
    })
  }
}

function escapeHtml(value) {
  return String(value)
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#039;')
}
