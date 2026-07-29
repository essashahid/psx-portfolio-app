/**
 * Gmail -> PSX portfolio app bridge for AKD trade-confirmation emails.
 *
 * Runs inside your own Google account (script.google.com), so no Gmail API
 * OAuth verification is needed. Every run it searches for unprocessed emails
 * from confirmation@akdsl.com, POSTs each message's PDF attachment(s) to the
 * app's /api/ingest/email endpoint with a shared secret, and labels the
 * thread "akd-ingested" so it is never sent twice.
 *
 * Setup (one time, about five minutes):
 *  1. Open https://script.google.com -> New project. Paste this file.
 *  2. Project Settings -> Script Properties -> add two properties:
 *       INGEST_URL    = https://<your-app-domain>/api/ingest/email
 *       INGEST_SECRET = the same long random value as EMAIL_INGEST_SECRET
 *                       on the server (generate with: openssl rand -hex 32)
 *  3. Run the `ingestAkdConfirmations` function once from the editor and
 *     approve the Gmail + external-request permissions it asks for.
 *  4. Triggers (clock icon) -> Add Trigger -> ingestAkdConfirmations,
 *     time-driven, every 15 minutes (or hourly; AKD sends once per day).
 *
 * The Vercel side needs EMAIL_INGEST_SECRET and EMAIL_INGEST_USER_ID set as
 * environment variables; see docs/operations/email-ingest.md.
 */

var SEARCH_QUERY = 'from:confirmation@akdsl.com has:attachment -label:akd-ingested';
var PROCESSED_LABEL = 'akd-ingested';
var MAX_THREADS_PER_RUN = 10;

function ingestAkdConfirmations() {
  var props = PropertiesService.getScriptProperties();
  var url = props.getProperty('INGEST_URL');
  var secret = props.getProperty('INGEST_SECRET');
  if (!url || !secret) {
    throw new Error('Set INGEST_URL and INGEST_SECRET in Script Properties first.');
  }

  var label = GmailApp.getUserLabelByName(PROCESSED_LABEL) || GmailApp.createLabel(PROCESSED_LABEL);
  var threads = GmailApp.search(SEARCH_QUERY, 0, MAX_THREADS_PER_RUN);

  threads.forEach(function (thread) {
    var allOk = true;

    thread.getMessages().forEach(function (message) {
      var attachments = message.getAttachments().filter(function (att) {
        return att.getContentType() === 'application/pdf' || /\.pdf$/i.test(att.getName());
      });
      if (attachments.length === 0) return;

      var payload = {
        from: message.getFrom(),
        subject: message.getSubject(),
        messageId: message.getId(),
        attachments: attachments.map(function (att) {
          return {
            filename: att.getName(),
            mimeType: att.getContentType(),
            dataBase64: Utilities.base64Encode(att.getBytes()),
          };
        }),
      };

      var response = UrlFetchApp.fetch(url, {
        method: 'post',
        contentType: 'application/json',
        headers: { 'x-ingest-secret': secret },
        payload: JSON.stringify(payload),
        muteHttpExceptions: true,
      });

      var code = response.getResponseCode();
      Logger.log('Sent "%s" -> HTTP %s: %s', message.getSubject(), code, response.getContentText());
      if (code !== 200 && code !== 207) allOk = false;
    });

    // Only mark the thread done when every message went through, so a server
    // outage simply retries on the next trigger run. The endpoint dedupes by
    // file hash, so retries never double-count.
    if (allOk) thread.addLabel(label);
  });
}
