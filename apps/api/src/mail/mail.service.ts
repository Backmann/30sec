import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import * as nodemailer from 'nodemailer';

@Injectable()
export class MailService {
  private transporter: nodemailer.Transporter;

  constructor(private readonly config: ConfigService) {
    const host = this.config.get<string>('SMTP_HOST');
    const port = this.config.get<number>('SMTP_PORT') || 587;
    const user = this.config.get<string>('SMTP_USER');
    const pass = this.config.get<string>('SMTP_PASS');

    if (host && user && pass) {
      this.transporter = nodemailer.createTransport({
        host,
        port,
        secure: port === 465,
        auth: { user, pass },
      });
      console.log(`📧 Mail configured: ${user} via ${host}:${port}`);
    } else {
      console.log('📧 Mail not configured — emails will be logged to console');
    }
  }

  async sendVerificationCode(to: string, code: string, language: string = 'ru') {
    const subjects: Record<string, string> = {
      ru: '30sec. — Код подтверждения',
      de: '30sec. — Bestätigungscode',
      en: '30sec. — Verification Code',
    };

    const bodies: Record<string, string> = {
      ru: `
        <div style="font-family:'Helvetica Neue',Arial,sans-serif;max-width:480px;margin:0 auto;padding:40px 20px">
          <div style="text-align:center;margin-bottom:30px">
            <h1 style="font-size:36px;font-weight:900;margin:0">
              <span style="color:#ffffff">30</span><span style="color:#0c8de6">sec</span><span style="color:#f59e0b">.</span>
            </h1>
          </div>
          <div style="background:#111827;border:1px solid rgba(255,255,255,0.06);border-radius:16px;padding:32px;text-align:center">
            <p style="color:#9ca3af;font-size:14px;margin:0 0 8px">Ваш код подтверждения:</p>
            <div style="font-size:40px;font-weight:800;letter-spacing:8px;color:#0c8de6;font-family:monospace;margin:16px 0">${code}</div>
            <p style="color:#6b7280;font-size:12px;margin:16px 0 0">Код действителен 15 минут</p>
          </div>
          <p style="color:#4b5563;font-size:11px;text-align:center;margin-top:24px">Если вы не регистрировались на 30sec.org — проигнорируйте это письмо.</p>
        </div>
      `,
      de: `
        <div style="font-family:'Helvetica Neue',Arial,sans-serif;max-width:480px;margin:0 auto;padding:40px 20px">
          <div style="text-align:center;margin-bottom:30px">
            <h1 style="font-size:36px;font-weight:900;margin:0">
              <span style="color:#ffffff">30</span><span style="color:#0c8de6">sec</span><span style="color:#f59e0b">.</span>
            </h1>
          </div>
          <div style="background:#111827;border:1px solid rgba(255,255,255,0.06);border-radius:16px;padding:32px;text-align:center">
            <p style="color:#9ca3af;font-size:14px;margin:0 0 8px">Ihr Bestätigungscode:</p>
            <div style="font-size:40px;font-weight:800;letter-spacing:8px;color:#0c8de6;font-family:monospace;margin:16px 0">${code}</div>
            <p style="color:#6b7280;font-size:12px;margin:16px 0 0">Der Code ist 15 Minuten gültig</p>
          </div>
          <p style="color:#4b5563;font-size:11px;text-align:center;margin-top:24px">Falls Sie sich nicht bei 30sec.org registriert haben, ignorieren Sie diese E-Mail.</p>
        </div>
      `,
      en: `
        <div style="font-family:'Helvetica Neue',Arial,sans-serif;max-width:480px;margin:0 auto;padding:40px 20px">
          <div style="text-align:center;margin-bottom:30px">
            <h1 style="font-size:36px;font-weight:900;margin:0">
              <span style="color:#ffffff">30</span><span style="color:#0c8de6">sec</span><span style="color:#f59e0b">.</span>
            </h1>
          </div>
          <div style="background:#111827;border:1px solid rgba(255,255,255,0.06);border-radius:16px;padding:32px;text-align:center">
            <p style="color:#9ca3af;font-size:14px;margin:0 0 8px">Your verification code:</p>
            <div style="font-size:40px;font-weight:800;letter-spacing:8px;color:#0c8de6;font-family:monospace;margin:16px 0">${code}</div>
            <p style="color:#6b7280;font-size:12px;margin:16px 0 0">This code expires in 15 minutes</p>
          </div>
          <p style="color:#4b5563;font-size:11px;text-align:center;margin-top:24px">If you didn't sign up for 30sec.org, please ignore this email.</p>
        </div>
      `,
    };

    const subject = subjects[language] || subjects.en;
    const html = bodies[language] || bodies.en;

    if (this.transporter) {
      try {
        await this.transporter.sendMail({
          from: `"30sec." <${this.config.get('SMTP_FROM')}>`,
          to,
          subject,
          html: `<div style="background:#0a0e17;padding:20px">${html}</div>`,
        });
        console.log(`📧 Verification email sent to ${to}`);
        return true;
      } catch (err) {
        console.error(`📧 Failed to send email to ${to}:`, err.message);
        return false;
      }
    } else {
      console.log(`📧 [DEV] Verification code for ${to}: ${code}`);
      return true;
    }
  }

  async sendNotification(to: string, title: string, body: string, language: string = 'ru') {
    const html = `
      <div style="font-family:'Helvetica Neue',Arial,sans-serif;max-width:480px;margin:0 auto;padding:40px 20px;background:#0a0e1a">
        <div style="text-align:center;margin-bottom:30px">
          <h1 style="font-size:36px;font-weight:900;margin:0">
            <span style="color:#ffffff">30</span><span style="color:#0c8de6">sec</span><span style="color:#f59e0b">.</span>
          </h1>
        </div>
        <div style="background:#141824;border-radius:16px;padding:30px;color:#ffffff">
          <h2 style="margin:0 0 15px;font-size:20px;color:#0c8de6">${title}</h2>
          <p style="margin:0;line-height:1.6;color:#cbd5e1">${body}</p>
        </div>
        <p style="text-align:center;color:#64748b;font-size:12px;margin-top:30px">
          <a href="https://30sec.org" style="color:#64748b">30sec.org</a>
        </p>
      </div>
    `;

    if (this.transporter) {
      await this.transporter.sendMail({
        from: this.config.get<string>('SMTP_FROM'),
        to,
        subject: `30sec. — ${title}`,
        html,
      });
    } else {
      console.log(`[MAIL STUB] To: ${to}, Title: ${title}, Body: ${body}`);
    }
  }

}
