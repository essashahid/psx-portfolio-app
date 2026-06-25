import imaplib
import email
import os

# Load from .env.local
env_path = os.path.join(os.path.dirname(__file__), ".env.local")
if os.path.exists(env_path):
    with open(env_path) as f:
        for line in f:
            line = line.strip()
            if line and not line.startswith("#") and "=" in line:
                key, _, val = line.partition("=")
                os.environ.setdefault(key.strip(), val.strip())

EMAIL = "eessashahid@gmail.com"
APP_PASSWORD = os.environ["GMAIL_PASSWORD"]
SENDER = "confirmation@akdsl.com"
SAVE_DIR = os.path.expanduser("~/Downloads/akdsl-pdfs")

os.makedirs(SAVE_DIR, exist_ok=True)

mail = imaplib.IMAP4_SSL("imap.gmail.com")
mail.login(EMAIL, APP_PASSWORD)
mail.select('"[Gmail]/All Mail"')

_, data = mail.search(None, f'FROM "{SENDER}"')
ids = data[0].split()
print(f"Found {len(ids)} emails from {SENDER}")

saved = 0
for msg_id in ids:
    _, msg_data = mail.fetch(msg_id, "(RFC822)")
    msg = email.message_from_bytes(msg_data[0][1])
    for part in msg.walk():
        filename = part.get_filename() or ""
        is_pdf = (
            part.get_content_type() == "application/pdf"
            or (part.get_content_type() == "application/octet-stream" and filename.lower().endswith(".pdf"))
        )
        if is_pdf:
            filename = filename or f"attachment_{msg_id.decode()}.pdf"
            path = os.path.join(SAVE_DIR, filename)
            with open(path, "wb") as f:
                f.write(part.get_payload(decode=True))
            saved += 1
            print(f"Saved: {filename}")

mail.logout()
print(f"\nDone — {saved} PDFs saved to {SAVE_DIR}")
