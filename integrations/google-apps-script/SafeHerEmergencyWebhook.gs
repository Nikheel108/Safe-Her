function jsonOutput(value) {
  return ContentService.createTextOutput(JSON.stringify(value))
    .setMimeType(ContentService.MimeType.JSON);
}

function doPost(e) {
  const lock = LockService.getScriptLock();
  try {
    const request = JSON.parse(e?.postData?.contents || '{}');
    const expectedSecret = PropertiesService.getScriptProperties()
      .getProperty('SAFEHER_WEBHOOK_SECRET');
    if (!expectedSecret || request.secret !== expectedSecret) {
      return jsonOutput({ ok: false, error: 'unauthorized' });
    }

    const eventId = String(request.event_id || '');
    if (!/^[A-Za-z0-9_-]{8,80}$/.test(eventId)) {
      return jsonOutput({ ok: false, error: 'invalid_event_id' });
    }

    lock.waitLock(10000);
    const cache = CacheService.getScriptCache();
    const cacheKey = `safeher-sos-${eventId}`;
    const prior = cache.get(cacheKey);
    if (prior) {
      return jsonOutput({ ok: true, email: { status: 'accepted' }, duplicate: true });
    }

    const recipients = [...new Set((Array.isArray(request.emails) ? request.emails : [])
      .filter(email => typeof email === 'string' && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)))]
      .slice(0, 10);
    if (!recipients.length) {
      return jsonOutput({ ok: false, error: 'no_email_recipients' });
    }

    const subject = String(request.email_subject || 'SAFE HER SOS ALERT').slice(0, 150);
    const body = String(request.email_text || 'Safe Her SOS was activated.')
      .replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F]/g, '')
      .slice(0, 8000);

    MailApp.sendEmail(recipients.join(','), subject, body, { name: 'Safe Her emergency alerts' });
    cache.put(cacheKey, 'accepted', 21600);
    return jsonOutput({ ok: true, email: { status: 'accepted' } });
  } catch (error) {
    return jsonOutput({ ok: false, error: `email_failed: ${String(error?.message || error).slice(0, 240)}` });
  } finally {
    if (lock.hasLock()) lock.releaseLock();
  }
}