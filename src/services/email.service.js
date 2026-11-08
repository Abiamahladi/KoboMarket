
const nodemailer = require('nodemailer');
const env = require('../config/env');

let transporter = null;

const isSmtpConfigured = () => {
  return Boolean(
    env.SMTP_HOST &&
    env.SMTP_USER &&
    env.SMTP_PASS &&
    env.EMAIL_FROM
  );
};

const getTransporter = () => {
  if (!isSmtpConfigured()) {
    throw new Error('SMTP email configuration is incomplete');
  }

  if (!transporter) {
    transporter = nodemailer.createTransport({
      host: env.SMTP_HOST,
      port: env.SMTP_PORT,
      secure: env.SMTP_SECURE,
      auth: {
        user: env.SMTP_USER,
        pass: env.SMTP_PASS
      }
    });
  }

  return transporter;
};

const emailService = {
  async sendEmail({ to, subject, text, html }) {
    const mailer = getTransporter();

    return mailer.sendMail({
      from: env.EMAIL_FROM,
      to,
      subject,
      text,
      html
    });
  }
};

module.exports = emailService;
