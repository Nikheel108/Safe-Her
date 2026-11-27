# Emergency notifications

Safe Her reacts to the ESP32's first `SOS: ACTIVE` transition and posts one event to the local Node server. The server sends the email via Google Apps Script and sends SMS through Twilio when configured. Repeated `SOS: ACTIVE` lines are ignored until the ESP32 reports SOS normal and activates again.

Notifications run while the dashboard is open, the ESP32 USB serial connection is active, and the local server is running. Email is accepted by Google Mail and SMS is accepted by Twilio; these acknowledgements do not guarantee delivery to the recipient. The Emergency Center displays provider status and errors. It never marks an unconfigured channel as sent.

## Google Apps Script email setup

1. Open [script.google.com](https://script.google.com/) and create a new project.
2. Replace the starter contents with [`SafeHerEmergencyWebhook.gs`](../integrations/google-apps-script/SafeHerEmergencyWebhook.gs), then save.
3. In **Project Settings → Script properties**, add `SAFEHER_WEBHOOK_SECRET`. Generate a long random value and use that exact value in both the Apps Script property and the local `.env` file. Do not put this secret in frontend code or commit it.
4. Choose **Deploy → New deployment → Web app**. Set **Execute as** to your Google account and access to **Anyone**, then deploy. Review and approve the Mail permission prompt.
5. Copy the deployed URL ending in `/exec` to `.env`:

   ```dotenv
   EMERGENCY_WEBHOOK_URL=https://script.google.com/macros/s/DEPLOYMENT_ID/exec
   EMERGENCY_WEBHOOK_SECRET=the-same-long-random-value
   ```

6. In Safe Her → **Emergency Contacts**, add a valid email address to each person who should receive the alert. Restart `npm run dev` after editing `.env`.

The Apps Script checks a shared secret, limits recipients, and deduplicates an event for six hours. Google Apps Script web apps use a `doPost` handler and `MailApp` sends the message as the Google account that owns the deployment. See Google's [web app deployment guide](https://developers.google.com/apps-script/guides/web) and [MailApp documentation](https://developers.google.com/apps-script/reference/mail/mail-app).

## SMS setup (Twilio)

SMS is a paid provider feature; an Apps Script webhook or an email address alone cannot send SMS. Create a Twilio account, provision an SMS-capable sender, and set all three server-only variables in `.env`:

```dotenv
TWILIO_ACCOUNT_SID=AC...
TWILIO_AUTH_TOKEN=...
TWILIO_FROM_NUMBER=+1...
```

Add the recipients' mobile numbers in Safe Her contacts. Phone numbers are sent in international E.164 form. Twilio trial accounts may require each destination number to be verified. The server reports **Accepted by provider** only after Twilio accepts the message request; final delivery can still fail. See Twilio's [Messages API](https://www.twilio.com/docs/messaging/api/message-resource).

Leave the Twilio fields blank if you have not configured SMS. The page will show **Not configured** and will not claim an SMS was sent.
