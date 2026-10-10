let warned = false;

export async function sendMail({ to, subject, text, html }) {
  const apiKey = process.env.BREVO_API_KEY;

  if (!apiKey) {
    if (!warned) {
      console.warn(
        "[mailer] BREVO_API_KEY not set. Emails will be logged only.",
      );
      warned = true;
    }
    console.info(`[mailer] (skipped) to=${to} subject="${subject}"`);
    return { skipped: true };
  }

  const fromEmail =
    process.env.MAIL_FROM_EMAIL ?? "choudharybinaykumar0@gmail.com";
  const fromName = process.env.MAIL_FROM_NAME ?? "MentorMatch";

  const response = await fetch("https://api.brevo.com/v3/smtp/email", {
    method: "POST",
    headers: {
      "api-key": apiKey,
      "content-type": "application/json",
      accept: "application/json",
    },
    body: JSON.stringify({
      sender: { name: fromName, email: fromEmail },
      to: [{ email: to }],
      subject,
      textContent: text,
      htmlContent: html,
    }),
  });

  if (!response.ok) {
    const err = await response.json().catch(() => ({}));
    throw new Error(`Brevo: ${err.message ?? response.statusText}`);
  }

  const data = await response.json();
  return { skipped: false, messageId: data.messageId };
}
