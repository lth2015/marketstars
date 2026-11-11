// 邮件发送适配：MAIL_TRANSPORT=log（默认，写日志，演示/测试用）| smtp（SMTP_URL）。
import nodemailer from "nodemailer";

export type Mail = { to: string; subject: string; text: string };

let transport: nodemailer.Transporter | null = null;

export async function sendMail(m: Mail): Promise<void> {
  const mode = process.env.MAIL_TRANSPORT ?? "log";
  if (mode === "smtp") {
    if (!process.env.SMTP_URL) throw new Error("SMTP_URL is not configured");
    transport ??= nodemailer.createTransport(process.env.SMTP_URL);
    await transport.sendMail({ from: process.env.MAIL_FROM ?? "MarketStars <no-reply@marketstars.example>", to: m.to, subject: m.subject, text: m.text });
    return;
  }
  // log 模式：不外发，只记录元数据（不输出正文，避免日志中出现个人信息）
  console.log(JSON.stringify({ severity: "INFO", message: "mail.log", to_domain: m.to.split("@")[1] ?? "", subject: m.subject }));
}
