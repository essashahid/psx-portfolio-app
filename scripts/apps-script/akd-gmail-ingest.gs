/**
 * Gmail -> PSX portfolio app bridge for AKD trade-confirmation emails.
 *
 * Runs inside your own Google account (script.google.com), so no Gmail API
 * OAuth verification is needed. Every run it searches for unprocessed emails
 * from confirmation@akdsl.com, POSTs each message's PDF attachment(s) to the
 * app's /api/ingest/email endpoint with a shared secret, and labels the thread
 * "akd-ingested" so it is never sent twice.
 *
 * A thread is only labelled when every attachment actually committed (or was
 * already present). A confirmation the server could not parse stays unlabelled
 * and is retried on the next run, so a parser fix picks it up automatically
 * instead of the trade going missing silently.
 *
 * Setup (one time):
 *  1. Open https://script.google.com -> New project. Paste this file.
 *  2. Project Settings -> Script Properties -> add two properties:
 *       INGEST_URL    = https://<your-app-domain>/api/ingest/email
 *       INGEST_SECRET = the same value as EMAIL_INGEST_SECRET on the server
 *  3. Select `installTriggers` in the function dropdown and press Run. Approve
 *     the Gmail + external-request permissions. That schedules the recurring
 *     job; you never need to press Run again.
 *
 * To check on it later: run `showStatus` and read the Execution log.
 */

var SEARCH_QUERY = 'from:confirmation@akdsl.com has:attachment -label:akd-ingested';
var PROCESSED_LABEL = 'akd-ingested';
var MAX_THREADS_PER_RUN = 25;

// How often the job runs. AKD sends a confirmation after the close, so several
// runs a day means a same-day pickup and an automatic retry if one run fails.
// Set to 24 for a strict once-a-day schedule.
var RUN_EVERY_HOURS = 4;

// Email a summary when something needs attention. Successful quiet runs stay
// silent unless NOTIFY_ON_SUCCESS is turned on.
var NOTIFY_ON_PROBLEM = true;
var NOTIFY_ON_SUCCESS = false;

/** Installs (or reinstalls) the recurring trigger. Run this once by hand. */
function installTriggers() {
  var existing = ScriptApp.getProjectTriggers();
  for (var i = 0; i < existing.length; i++) {
    if (existing[i].getHandlerFunction() === 'ingestAkdConfirmations') {
      ScriptApp.deleteTrigger(existing[i]);
    }
  }
  var builder = ScriptApp.newTrigger('ingestAkdConfirmations').timeBased();
  if (RUN_EVERY_HOURS >= 24) {
    builder.everyDays(1).atHour(22); // after the market close and AKD's send
  } else {
    builder.everyHours(RUN_EVERY_HOURS);
  }
  builder.create();
  Logger.log('Trigger installed: every %s hour(s).', RUN_EVERY_HOURS);

  // Run once immediately so setup is verified rather than assumed.
  ingestAkdConfirmations();
}

/** Removes the recurring trigger. */
function uninstallTriggers() {
  var triggers = ScriptApp.getProjectTriggers();
  var removed = 0;
  for (var i = 0; i < triggers.length; i++) {
    if (triggers[i].getHandlerFunction() === 'ingestAkdConfirmations') {
      ScriptApp.deleteTrigger(triggers[i]);
      removed++;
    }
  }
  Logger.log('Removed %s trigger(s).', removed);
}

/** Prints the schedule, the last run and anything still waiting. */
function showStatus() {
  var props = PropertiesService.getScriptProperties();
  var triggers = ScriptApp.getProjectTriggers().filter(function (t) {
    return t.getHandlerFunction() === 'ingestAkdConfirmations';
  });
  Logger.log('Triggers installed: %s', triggers.length);
  Logger.log('Last run: %s', props.getProperty('LAST_RUN') || 'never');
  Logger.log('Last result: %s', props.getProperty('LAST_RESULT') || 'none');
  Logger.log('Unprocessed confirmation threads: %s', GmailApp.search(SEARCH_QUERY, 0, 50).length);
}

function ingestAkdConfirmations() {
  var props = PropertiesService.getScriptProperties();
  var url = props.getProperty('INGEST_URL');
  var secret = props.getProperty('INGEST_SECRET');
  if (!url || !secret) {
    throw new Error('Set INGEST_URL and INGEST_SECRET in Script Properties first.');
  }

  var label = GmailApp.getUserLabelByName(PROCESSED_LABEL) || GmailApp.createLabel(PROCESSED_LABEL);
  var threads = GmailApp.search(SEARCH_QUERY, 0, MAX_THREADS_PER_RUN);

  var stat = { threads: threads.length, trades: 0, duplicates: 0, ignored: 0, review: 0, failed: 0, notes: [] };

  threads.forEach(function (thread) {
    var threadClean = true;

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

      var response;
      try {
        response = UrlFetchApp.fetch(url, {
          method: 'post',
          contentType: 'application/json',
          headers: { 'x-ingest-secret': secret },
          payload: JSON.stringify(payload),
          muteHttpExceptions: true,
        });
      } catch (err) {
        threadClean = false;
        stat.failed++;
        stat.notes.push(message.getSubject() + ': request failed (' + err + ')');
        return;
      }

      var code = response.getResponseCode();
      var text = response.getContentText();
      if (code !== 200 && code !== 207) {
        threadClean = false;
        stat.failed++;
        stat.notes.push(message.getSubject() + ': HTTP ' + code + ' ' + text.slice(0, 200));
        Logger.log('%s -> HTTP %s (will retry next run)', message.getSubject(), code);
        return;
      }

      // A 200 does not mean the trades landed: the endpoint reports per-file
      // outcomes, and needs_review means nothing was committed.
      var results = [];
      try {
        results = (JSON.parse(text) || {}).results || [];
      } catch (err) {
        results = [];
      }

      results.forEach(function (r) {
        if (r.status === 'committed') {
          stat.trades += r.trades || 0;
          stat.duplicates += r.duplicates || 0;
        } else if (r.status === 'duplicate_file') {
          stat.duplicates++;
        } else if (r.status === 'ignored') {
          // AKD sends CGT reports and similar from the same address. Nothing
          // to import, but the thread is done and must not be retried.
          stat.ignored++;
        } else {
          threadClean = false;
          if (r.status === 'needs_review') stat.review++;
          else stat.failed++;
          stat.notes.push(
            message.getSubject() + ': ' + r.status + ' - ' + (r.warnings || [r.error]).join('; ').slice(0, 300)
          );
        }
      });

      Logger.log('%s -> HTTP %s: %s', message.getSubject(), code, text.slice(0, 300));
    });

    // Label only when the whole thread landed, so anything unresolved is
    // retried automatically on the next run.
    if (threadClean) thread.addLabel(label);
  });

  var summary =
    stat.threads + ' thread(s), ' + stat.trades + ' trade(s) imported, ' +
    stat.duplicates + ' already present, ' + stat.ignored + ' not confirmations, ' +
    stat.review + ' needing review, ' + stat.failed + ' failed';
  Logger.log(summary);

  props.setProperty('LAST_RUN', new Date().toISOString());
  props.setProperty('LAST_RESULT', summary);

  var problem = stat.review > 0 || stat.failed > 0;
  if ((problem && NOTIFY_ON_PROBLEM) || (!problem && stat.trades > 0 && NOTIFY_ON_SUCCESS)) {
    notify(problem, summary, stat.notes);
  }
}

function notify(problem, summary, notes) {
  try {
    var to = Session.getEffectiveUser().getEmail();
    if (!to) return;
    MailApp.sendEmail(
      to,
      problem ? 'AKD ingest needs attention' : 'AKD ingest: new trades imported',
      summary +
        (notes.length ? '\n\n' + notes.join('\n') : '') +
        (problem
          ? '\n\nThese emails were left unlabelled and will be retried on the next run.'
          : '')
    );
  } catch (err) {
    Logger.log('Notification failed: %s', err);
  }
}
