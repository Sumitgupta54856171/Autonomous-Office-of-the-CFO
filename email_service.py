"""Enterprise Gmail Delivery Service for AutoCFO.

Integrates with Gmail SMTP (smtp.gmail.com:465 SSL / 587 TLS) using Google App Passwords
to deliver real vendor inquiry and reconciliation follow-up emails.
"""

import html
import logging
import os
import re
import smtplib
from datetime import datetime
from email.mime.multipart import MIMEMultipart
from email.mime.text import MIMEText
from typing import Any, Dict, Optional, Tuple
from dotenv import load_dotenv

load_dotenv()

logger = logging.getLogger("autocfo.email")


def get_gmail_credentials() -> Tuple[Optional[str], Optional[str]]:
    """Retrieve Gmail address and App Password from environment variables.

    Supports case-insensitive variations:
    - User: `gmail`, `GMAIL_USER`, `GMAIL_EMAIL`, `SMTP_USER`
    - Secret: `gmail_secret`, `GMAIL_SECRET`, `GMAIL_APP_PASSWORD`, `SMTP_PASSWORD`
    """
    user = (
        os.getenv("gmail")
        or os.getenv("GMAIL_USER")
        or os.getenv("GMAIL_EMAIL")
        or os.getenv("SMTP_USER")
        or ""
    ).strip()

    secret = (
        os.getenv("gmail_secret")
        or os.getenv("GMAIL_SECRET")
        or os.getenv("GMAIL_APP_PASSWORD")
        or os.getenv("SMTP_PASSWORD")
        or ""
    ).strip().replace(" ", "")

    return (user if user else None, secret if secret else None)


def is_gmail_configured() -> bool:
    """Return True if both Gmail address and App Password are available."""
    user, secret = get_gmail_credentials()
    return bool(user and secret)


def clean_email_text(raw_text: str) -> str:
    """Strip all markdown bold/italic asterisks, hashes, and formatting artifacts."""
    if not raw_text:
        return ""
    # Strip markdown bold/italic asterisks: **text** -> text, *text* -> text
    cleaned = re.sub(r"\*\*([^*]+)\*\*", r"\1", raw_text)
    cleaned = re.sub(r"\*([^*]+)\*", r"\1", cleaned)
    cleaned = re.sub(r"__([^_]+)__", r"\1", cleaned)
    cleaned = re.sub(r"_([^_]+)_", r"\1", cleaned)
    # Remove markdown header hashes: ### Heading -> Heading
    cleaned = re.sub(r"^#{1,6}\s*", "", cleaned, flags=re.MULTILINE)
    # Normalize bullet points: * Item -> - Item
    cleaned = re.sub(r"^\s*\*\s+", " - ", cleaned, flags=re.MULTILINE)
    # Remove raw markdown horizontal dividers: --- or *** or ___
    cleaned = re.sub(r"^[ \t]*[-*_]{3,}[ \t]*$", "", cleaned, flags=re.MULTILINE)
    # Remove leftover standalone asterisks and backticks
    cleaned = cleaned.replace("**", "").replace("`", "")
    return cleaned.strip()


def extract_subject_and_body(
    content: str,
    invoice_id: Optional[int] = None,
    vendor_name: Optional[str] = None,
) -> Tuple[str, str]:
    """Parse out the subject line and cleaned email body from raw draft text.

    Cleans all markdown bold asterisks (**) and formatting artifacts.
    Handles formats like:
    - Subject: <subject>
    - **Subject:** <subject>
    - Subject - <subject>
    """
    default_sub = (
        f"Payment Discrepancy Notice – Invoice #{invoice_id or ''} [{vendor_name or 'AutoCFO'}]"
    ).strip()

    if not content:
        return default_sub, ""

    # Clean entire text of raw markdown asterisks first
    cleaned_input = clean_email_text(content)
    lines = cleaned_input.splitlines()
    subject = default_sub
    body_lines = []
    found_subject = False

    for i, line in enumerate(lines):
        clean = line.strip()
        # Look for subject line markers
        match = re.match(
            r"^(?:Subject\s*[:\-]\s*)(.*)$",
            clean,
            flags=re.IGNORECASE,
        )
        if match and not found_subject:
            extracted = match.group(1).strip().strip("*").strip()
            if extracted:
                subject = extracted
            found_subject = True
            # Skip horizontal rules immediately following subject line
            if i + 1 < len(lines) and lines[i + 1].strip() in ("---", "***", "___"):
                continue
            continue

        # Skip leading separator line if after subject
        if found_subject and len(body_lines) == 0 and clean in ("---", "***", "___"):
            continue

        body_lines.append(line)

    cleaned_body = "\n".join(body_lines).strip()
    return clean_email_text(subject), clean_email_text(cleaned_body)


def _build_html_email(
    subject: str,
    body_text: str,
    invoice_id: Optional[int] = None,
    vendor_name: Optional[str] = None,
) -> str:
    """Generate a sleek, responsive HTML email template for enterprise presentation."""
    # Convert newlines to paragraphs / breaks while escaping user input
    escaped_body = html.escape(body_text)
    paragraphs = escaped_body.split("\n\n")
    html_paragraphs = "".join(f"<p style='margin: 0 0 16px 0; line-height: 1.6;'>{p.replace(chr(10), '<br>')}</p>" for p in paragraphs if p.strip())

    return f"""<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8">
  <title>{html.escape(subject)}</title>
</head>
<body style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif; background-color: #f8fafc; margin: 0; padding: 24px; color: #1e293b;">
  <div style="max-width: 600px; margin: 0 auto; background: #ffffff; border-radius: 12px; border: 1px solid #e2e8f0; overflow: hidden; box-shadow: 0 4px 6px -1px rgba(0, 0, 0, 0.05);">
    <!-- Header -->
    <div style="background: linear-gradient(135deg, #0f172a 0%, #1e1b4b 100%); padding: 24px 32px; color: #ffffff;">
      <div style="display: flex; align-items: center; justify-content: space-between;">
        <div>
          <h1 style="margin: 0; font-size: 18px; font-weight: 700; letter-spacing: -0.5px; color: #ffffff;">AutoCFO Autonomous Finance</h1>
          <p style="margin: 4px 0 0 0; font-size: 12px; color: #94a3b8;">Accounts Payable &amp; Reconciliation Department</p>
        </div>
        {f'<div style="background: rgba(255, 255, 255, 0.15); border: 1px solid rgba(255, 255, 255, 0.25); border-radius: 6px; padding: 4px 10px; font-size: 11px; font-weight: 600; font-family: monospace;">#INV-{invoice_id}</div>' if invoice_id else ''}
      </div>
    </div>

    <!-- Notice Ribbon -->
    <div style="background: #eff6ff; border-bottom: 1px solid #dbeafe; padding: 10px 32px; font-size: 12px; color: #1e40af; font-weight: 500;">
      Official Communication regarding: <strong>{html.escape(vendor_name or 'Invoice Inquiry')}</strong>
    </div>

    <!-- Body Content -->
    <div style="padding: 32px; font-size: 14px; color: #334155;">
      {html_paragraphs}
    </div>

    <!-- Footer -->
    <div style="background: #f1f5f9; border-top: 1px solid #e2e8f0; padding: 20px 32px; text-align: center; font-size: 11px; color: #64748b;">
      <p style="margin: 0;">Dispatched autonomously via <strong>AutoCFO Engine</strong> on behalf of Corporate Finance.</p>
      <p style="margin: 6px 0 0 0;">Please direct remittance advice and payment inquiries to this email address.</p>
    </div>
  </div>
</body>
</html>
"""


def send_real_gmail(
    recipient_email: str,
    raw_content: str,
    invoice_id: Optional[int] = None,
    vendor_name: Optional[str] = None,
) -> Dict[str, Any]:
    """Dispatch real email to recipient via Gmail SMTP.

    If Gmail credentials are configured, sends real email using SSL (465) or STARTTLS (587).
    If credentials are not configured, gracefully falls back to simulation mode.
    """
    gmail_user, gmail_secret = get_gmail_credentials()
    subject, body = extract_subject_and_body(raw_content, invoice_id=invoice_id, vendor_name=vendor_name)
    timestamp_str = datetime.utcnow().strftime("%Y-%m-%d %H:%M:%S UTC")

    # 1. Check if Gmail is configured
    if not gmail_user or not gmail_secret:
        logger.warning("Gmail credentials not detected. Simulating email dispatch.")
        _print_simulated_dispatch(recipient_email, subject, body, invoice_id, vendor_name, timestamp_str)
        return {
            "success": True,
            "is_real_email": False,
            "sender_email": "simulation@autocfo.local",
            "recipient_email": recipient_email,
            "subject": subject,
            "message": f"Simulated delivery: Gmail credentials not configured in .env. Email printed to console.",
        }

    # 2. Build MIME message with Plain Text + HTML alternative
    msg = MIMEMultipart("alternative")
    msg["From"] = f"AutoCFO Finance Operations <{gmail_user}>"
    msg["To"] = recipient_email.strip()
    msg["Subject"] = subject
    msg["Reply-To"] = gmail_user
    msg["Date"] = datetime.utcnow().strftime("%a, %d %b %Y %H:%M:%S +0000")

    part_text = MIMEText(body, "plain", "utf-8")
    part_html = MIMEText(
        _build_html_email(subject, body, invoice_id=invoice_id, vendor_name=vendor_name),
        "html",
        "utf-8",
    )

    msg.attach(part_text)
    msg.attach(part_html)

    # 3. Connect and send via Gmail SMTP
    last_error = None
    # Try SSL on port 465 first
    try:
        logger.info("Attempting Gmail SSL connection (smtp.gmail.com:465) for sender %s...", gmail_user)
        with smtplib.SMTP_SSL("smtp.gmail.com", 465, timeout=15) as server:
            server.login(gmail_user, gmail_secret)
            server.send_message(msg)
            logger.info("Real Gmail dispatched successfully via SSL to %s", recipient_email)
            _print_live_dispatch_banner(gmail_user, recipient_email, subject, body, invoice_id, timestamp_str)
            return {
                "success": True,
                "is_real_email": True,
                "sender_email": gmail_user,
                "recipient_email": recipient_email,
                "subject": subject,
                "message": f"Real email successfully dispatched via Gmail ({gmail_user}) to {recipient_email}.",
            }
    except Exception as ssl_err:
        logger.warning("Gmail SMTP_SSL (465) failed: %s. Attempting STARTTLS on port 587...", ssl_err)
        last_error = ssl_err

    # Fallback: Try STARTTLS on port 587
    try:
        with smtplib.SMTP("smtp.gmail.com", 587, timeout=15) as server:
            server.ehlo()
            server.starttls()
            server.ehlo()
            server.login(gmail_user, gmail_secret)
            server.send_message(msg)
            logger.info("Real Gmail dispatched successfully via STARTTLS (587) to %s", recipient_email)
            _print_live_dispatch_banner(gmail_user, recipient_email, subject, body, invoice_id, timestamp_str)
            return {
                "success": True,
                "is_real_email": True,
                "sender_email": gmail_user,
                "recipient_email": recipient_email,
                "subject": subject,
                "message": f"Real email successfully dispatched via Gmail ({gmail_user}) to {recipient_email}.",
            }
    except Exception as tls_err:
        logger.error("Both Gmail SSL and STARTTLS failed: %s (SSL: %s)", tls_err, last_error)
        raise RuntimeError(f"Gmail SMTP authentication/sending failed: {str(tls_err)}")


def _print_live_dispatch_banner(
    sender: str,
    recipient: str,
    subject: str,
    body: str,
    invoice_id: Optional[int],
    timestamp: str,
):
    """Print high-visibility audit output to terminal."""
    sep = "=" * 74
    div = "-" * 74
    print(
        f"\n{sep}\n"
        f"🚀 [LIVE GMAIL SMTP DISPATCH CONFIRMED]\n"
        f"Timestamp:  {timestamp}\n"
        f"From:       {sender}\n"
        f"To:         {recipient}\n"
        f"Invoice:    #INV-{invoice_id or 'N/A'}\n"
        f"Subject:    {subject}\n"
        f"Status:     250 OK Message accepted for delivery by Gmail\n"
        f"{div}\n"
        f"{body}\n"
        f"{sep}\n",
        flush=True,
    )


def _print_simulated_dispatch(
    recipient: str,
    subject: str,
    body: str,
    invoice_id: Optional[int],
    vendor_name: Optional[str],
    timestamp: str,
):
    """Print simulated dispatch to terminal when credentials are absent."""
    sep = "=" * 74
    div = "-" * 74
    print(
        f"\n{sep}\n"
        f"📧 [SIMULATED EMAIL DISPATCH - GMAIL UNCONFIGURED]\n"
        f"Timestamp:  {timestamp}\n"
        f"To:         {recipient}\n"
        f"Invoice:    #INV-{invoice_id or 'N/A'} ({vendor_name or 'Vendor'})\n"
        f"Subject:    {subject}\n"
        f"{div}\n"
        f"{body}\n"
        f"{sep}\n",
        flush=True,
    )
