import { Resend } from 'resend'

const resend = new Resend(process.env.RESEND_API_KEY)

const FROM = 'exart.io <noreply@exart.io>'
const ADMIN_EMAIL = ['exartio@posteo.de']

// ── Verification notification to admin ───────────────────────
export async function sendVerificationNotification({ fullName, docType, orgName, submittedAt, userId, orgId }) {
  const docTypeLabels = {
    approbation:     'Approbationsurkunde',
    facharzturkunde: 'Facharztanerkennung',
    berufsausweis:   'EU-Berufsausweis',
    other:           'Sonstiger Nachweis',
  }

  const approveQuery = `UPDATE profiles
SET verification_status = 'verified'
WHERE auth_user_id = '${userId}';

UPDATE subscriptions
SET status = 'active', plan = 'solo'
WHERE org_id = '${orgId}';`

  const rejectQuery = `UPDATE profiles
SET verification_status = 'rejected'
WHERE auth_user_id = '${userId}';`

  const viewDocsQuery = `SELECT vd.id, vd.doc_type, vd.storage_path, vd.submitted_at, p.full_name, p.verification_status
FROM verification_documents vd
JOIN profiles p ON p.id = vd.profile_id
WHERE p.auth_user_id = '${userId}'
ORDER BY vd.submitted_at DESC;`

  await resend.emails.send({
    from: FROM,
    to: ADMIN_EMAIL,
    subject: `[exart.io] Neue Verifizierungsanfrage — ${fullName}`,
    html: `
<!DOCTYPE html>
<html lang="de">
<head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1.0"></head>
<body style="margin:0;padding:0;background:#f7f4ef;font-family:'DM Sans',Arial,sans-serif;">
  <table width="100%" cellpadding="0" cellspacing="0" style="background:#f7f4ef;padding:32px 16px;">
    <tr><td align="center">
      <table width="580" cellpadding="0" cellspacing="0" style="background:#ffffff;border-radius:6px;overflow:hidden;border:0.5px solid rgba(26,38,64,0.12);">

        <!-- Header -->
        <tr><td style="background:#1a2640;padding:24px 32px;">
          <p style="margin:0;font-family:'Playfair Display',Georgia,serif;font-size:20px;font-weight:600;color:#ffffff;letter-spacing:-0.02em;">
            exart<span style="color:#b89a5e;font-family:'DM Sans',Arial,sans-serif;font-size:11px;font-weight:500;letter-spacing:0.12em;vertical-align:super;">.io</span>
          </p>
        </td></tr>

        <!-- Body -->
        <tr><td style="padding:32px;">
          <p style="margin:0 0 8px;font-size:11px;text-transform:uppercase;letter-spacing:0.14em;color:#b89a5e;font-weight:500;">Verifizierungsanfrage</p>
          <h1 style="margin:0 0 24px;font-family:'Playfair Display',Georgia,serif;font-size:22px;font-weight:500;color:#1a2640;line-height:1.3;">
            Neue Approbationsverifizierung eingegangen
          </h1>

          <!-- Details table -->
          <table width="100%" cellpadding="0" cellspacing="0" style="background:#f7f4ef;border-radius:5px;margin-bottom:28px;">
            <tr><td style="padding:20px 24px;">
              <table width="100%" cellpadding="0" cellspacing="0">
                <tr>
                  <td style="font-size:11px;text-transform:uppercase;letter-spacing:0.1em;color:#6b7a94;padding-bottom:4px;">Name</td>
                  <td style="font-size:14px;color:#1a2640;font-weight:500;text-align:right;">${fullName}</td>
                </tr>
                <tr><td colspan="2" style="padding:6px 0;border-bottom:0.5px solid rgba(26,38,64,0.1);"></td></tr>
                <tr>
                  <td style="font-size:11px;text-transform:uppercase;letter-spacing:0.1em;color:#6b7a94;padding:8px 0 4px;">Praxis / Organisation</td>
                  <td style="font-size:14px;color:#1a2640;text-align:right;padding-top:8px;">${orgName || '—'}</td>
                </tr>
                <tr><td colspan="2" style="padding:6px 0;border-bottom:0.5px solid rgba(26,38,64,0.1);"></td></tr>
                <tr>
                  <td style="font-size:11px;text-transform:uppercase;letter-spacing:0.1em;color:#6b7a94;padding:8px 0 4px;">Dokumenttyp</td>
                  <td style="font-size:14px;color:#1a2640;text-align:right;padding-top:8px;">${docTypeLabels[docType] || docType}</td>
                </tr>
                <tr><td colspan="2" style="padding:6px 0;border-bottom:0.5px solid rgba(26,38,64,0.1);"></td></tr>
                <tr>
                  <td style="font-size:11px;text-transform:uppercase;letter-spacing:0.1em;color:#6b7a94;padding:8px 0 4px;">Eingereicht am</td>
                  <td style="font-size:14px;color:#1a2640;text-align:right;padding-top:8px;">${new Date(submittedAt).toLocaleDateString('de-DE', { day:'2-digit', month:'2-digit', year:'numeric', hour:'2-digit', minute:'2-digit' })}</td>
                </tr>
                <tr><td colspan="2" style="padding:6px 0;border-bottom:0.5px solid rgba(26,38,64,0.1);"></td></tr>
                <tr>
                  <td style="font-size:11px;text-transform:uppercase;letter-spacing:0.1em;color:#6b7a94;padding:8px 0 4px;">User ID</td>
                  <td style="font-size:12px;color:#6b7a94;text-align:right;padding-top:8px;font-family:monospace;">${userId || '—'}</td>
                </tr>
              </table>
            </td></tr>
          </table>

          <!-- Supabase button -->
          <table cellpadding="0" cellspacing="0" style="margin-bottom:28px;">
            <tr>
              <td style="background:#1a2640;border-radius:4px;">
                <a href="https://supabase.com/dashboard/project/bcxyychocefmurtblmwa/storage/buckets/verification-documents"
                   style="display:inline-block;padding:11px 22px;font-size:13px;font-weight:500;color:#ffffff;text-decoration:none;font-family:'DM Sans',Arial,sans-serif;">
                  Dokument in Supabase ansehen →
                </a>
              </td>
              <td width="12"></td>
              <td style="border:1px solid rgba(26,38,64,0.2);border-radius:4px;">
                <a href="https://supabase.com/dashboard/project/bcxyychocefmurtblmwa/editor"
                   style="display:inline-block;padding:10px 18px;font-size:13px;font-weight:400;color:#1a2640;text-decoration:none;font-family:'DM Sans',Arial,sans-serif;">
                  SQL Editor →
                </a>
              </td>
            </tr>
          </table>

          <!-- Divider -->
          <table width="100%" cellpadding="0" cellspacing="0" style="margin-bottom:24px;">
            <tr><td style="border-bottom:1px solid rgba(184,154,94,0.3);height:1px;"></td></tr>
          </table>

          <!-- Query: View docs -->
          <p style="margin:0 0 8px;font-size:11px;text-transform:uppercase;letter-spacing:0.1em;color:#6b7a94;font-weight:600;">1. Dokument prüfen</p>
          <table width="100%" cellpadding="0" cellspacing="0" style="margin-bottom:20px;">
            <tr><td style="background:#0f1724;border-radius:5px;padding:16px 18px;">
              <pre style="margin:0;font-family:'Courier New',Courier,monospace;font-size:12px;color:#a8c4e0;white-space:pre-wrap;line-height:1.7;">${viewDocsQuery}</pre>
            </td></tr>
          </table>

          <!-- Query: Approve -->
          <p style="margin:0 0 8px;font-size:11px;text-transform:uppercase;letter-spacing:0.1em;color:#2e7d32;font-weight:600;">2. Genehmigen ✓</p>
          <table width="100%" cellpadding="0" cellspacing="0" style="margin-bottom:20px;">
            <tr><td style="background:#0f1724;border-radius:5px;padding:16px 18px;border-left:3px solid #4caf50;">
              <pre style="margin:0;font-family:'Courier New',Courier,monospace;font-size:12px;color:#a8c4e0;white-space:pre-wrap;line-height:1.7;">${approveQuery}</pre>
            </td></tr>
          </table>

          <!-- Query: Reject -->
          <p style="margin:0 0 8px;font-size:11px;text-transform:uppercase;letter-spacing:0.1em;color:#c62828;font-weight:600;">3. Ablehnen ✗</p>
          <table width="100%" cellpadding="0" cellspacing="0" style="margin-bottom:28px;">
            <tr><td style="background:#0f1724;border-radius:5px;padding:16px 18px;border-left:3px solid #e53935;">
              <pre style="margin:0;font-family:'Courier New',Courier,monospace;font-size:12px;color:#a8c4e0;white-space:pre-wrap;line-height:1.7;">${rejectQuery}</pre>
            </td></tr>
          </table>

          <p style="margin:0;font-size:12px;color:#6b7a94;line-height:1.6;">
            Nach Genehmigung bitte auch die Bestätigungsmail an den Nutzer über <code>sendVerificationApproved()</code> auslösen oder manuell versenden.
          </p>
        </td></tr>

        <!-- Footer -->
        <tr><td style="background:#f7f4ef;padding:16px 32px;border-top:0.5px solid rgba(26,38,64,0.1);">
          <p style="margin:0;font-size:11px;color:#6b7a94;text-align:center;">
            exart.io · Automatische Benachrichtigung · <a href="https://exart.io" style="color:#1a2640;">exart.io</a>
          </p>
        </td></tr>

      </table>
    </td></tr>
  </table>
</body>
</html>
    `,
  })
}

// ── Confirmation email to user after verification approved ───
export async function sendVerificationApproved({ fullName, email }) {
  await resend.emails.send({
    from: FROM,
    to: email,
    subject: 'Ihre Approbation wurde bestätigt — exart.io',
    html: `
<!DOCTYPE html>
<html lang="de">
<head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1.0"></head>
<body style="margin:0;padding:0;background:#f7f4ef;font-family:'DM Sans',Arial,sans-serif;">
  <table width="100%" cellpadding="0" cellspacing="0" style="background:#f7f4ef;padding:32px 16px;">
    <tr><td align="center">
      <table width="560" cellpadding="0" cellspacing="0" style="background:#ffffff;border-radius:6px;overflow:hidden;border:0.5px solid rgba(26,38,64,0.12);">

        <tr><td style="background:#1a2640;padding:24px 32px;">
          <p style="margin:0;font-family:'Playfair Display',Georgia,serif;font-size:20px;font-weight:600;color:#ffffff;letter-spacing:-0.02em;">
            exart<span style="color:#b89a5e;font-family:'DM Sans',Arial,sans-serif;font-size:11px;font-weight:500;letter-spacing:0.12em;vertical-align:super;">.io</span>
          </p>
        </td></tr>

        <tr><td style="padding:32px;">
          <p style="margin:0 0 8px;font-size:11px;text-transform:uppercase;letter-spacing:0.14em;color:#b89a5e;font-weight:500;">Verifizierung</p>
          <h1 style="margin:0 0 16px;font-family:'Playfair Display',Georgia,serif;font-size:22px;font-weight:500;color:#1a2640;line-height:1.3;">
            Ihre Approbation wurde bestätigt
          </h1>
          <p style="margin:0 0 24px;font-size:14px;color:#4a5568;line-height:1.7;">
            Sehr geehrte/r ${fullName},<br><br>
            wir haben Ihren Approbationsnachweis geprüft und Ihr Konto freigeschaltet. Sie haben nun vollständigen Zugang zu allen Funktionen von exart.io.
          </p>

          <table cellpadding="0" cellspacing="0" style="margin-bottom:24px;">
            <tr><td style="background:#b89a5e;border-radius:4px;">
              <a href="${process.env.FRONTEND_URL || 'https://exart.io'}/dashboard"
                 style="display:inline-block;padding:11px 22px;font-size:13px;font-weight:500;color:#1a2640;text-decoration:none;font-family:'DM Sans',Arial,sans-serif;">
                Zum Dashboard →
              </a>
            </td></tr>
          </table>

          <p style="margin:0;font-size:13px;color:#4a5568;line-height:1.7;">
            Bei Fragen stehen wir Ihnen unter <a href="mailto:kontakt@exart.io" style="color:#1a2640;">kontakt@exart.io</a> zur Verfügung.
          </p>
        </td></tr>

        <tr><td style="background:#f7f4ef;padding:16px 32px;border-top:0.5px solid rgba(26,38,64,0.1);">
          <p style="margin:0;font-size:11px;color:#6b7a94;text-align:center;">
            exart.io · <a href="https://exart.io" style="color:#1a2640;">exart.io</a>
          </p>
        </td></tr>

      </table>
    </td></tr>
  </table>
</body>
</html>
    `,
  })
}

// ── Referral notification to referrer when code is applied ──
export async function sendReferralNotification({ referrerName, referrerEmail, referredName }) {
  await resend.emails.send({
    from: FROM,
    to: referrerEmail,
    subject: `Ihr Empfehlungscode wurde verwendet — exart.io`,
    html: `
<!DOCTYPE html>
<html lang="de">
<head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1.0"></head>
<body style="margin:0;padding:0;background:#f7f4ef;font-family:'DM Sans',Arial,sans-serif;">
  <table width="100%" cellpadding="0" cellspacing="0" style="background:#f7f4ef;padding:32px 16px;">
    <tr><td align="center">
      <table width="560" cellpadding="0" cellspacing="0" style="background:#ffffff;border-radius:6px;overflow:hidden;border:0.5px solid rgba(26,38,64,0.12);">

        <tr><td style="background:#1a2640;padding:24px 32px;">
          <p style="margin:0;font-family:'Playfair Display',Georgia,serif;font-size:20px;font-weight:600;color:#ffffff;letter-spacing:-0.02em;">
            exart<span style="color:#b89a5e;font-family:'DM Sans',Arial,sans-serif;font-size:11px;font-weight:500;letter-spacing:0.12em;vertical-align:super;">.io</span>
          </p>
        </td></tr>

        <tr><td style="padding:32px;">
          <p style="margin:0 0 8px;font-size:11px;text-transform:uppercase;letter-spacing:0.14em;color:#b89a5e;font-weight:500;">Empfehlungsprogramm</p>
          <h1 style="margin:0 0 20px;font-family:'Playfair Display',Georgia,serif;font-size:22px;font-weight:500;color:#1a2640;line-height:1.3;">
            Ihr Empfehlungscode wurde verwendet
          </h1>

          <table width="100%" cellpadding="0" cellspacing="0" style="background:#f7f4ef;border-radius:5px;margin-bottom:24px;">
            <tr><td style="padding:20px 24px;">
              <p style="margin:0 0 8px;font-size:13px;color:#6b7a94;font-family:'DM Sans',Arial,sans-serif;">Sehr geehrte/r ${referrerName},</p>
              <p style="margin:0;font-size:14px;color:#1a2640;line-height:1.7;">
                <strong>${referredName}</strong> hat sich bei exart.io registriert und Ihren Empfehlungscode verwendet. Sie wurden als Empfehlender eingetragen.
              </p>
            </td></tr>
          </table>

          <table width="100%" cellpadding="0" cellspacing="0" style="background:#1a2640;border-radius:6px;margin-bottom:24px;">
            <tr><td style="padding:20px 24px;">
              <p style="margin:0 0 6px;font-size:11px;text-transform:uppercase;letter-spacing:0.12em;color:#b89a5e;font-weight:600;font-family:'DM Sans',Arial,sans-serif;">Ihr Bonus</p>
              <p style="margin:0;font-size:16px;font-weight:600;color:#ffffff;font-family:'Playfair Display',Georgia,serif;">
                50 € Gutschrift auf Ihre nächste Rechnung
              </p>
              <p style="margin:6px 0 0;font-size:12px;color:rgba(255,255,255,0.5);font-family:'DM Sans',Arial,sans-serif;">
                Die Gutschrift wird automatisch auf Ihre nächste Abrechnung angerechnet, sobald ${referredName} ein Abonnement abschließt.
              </p>
            </td></tr>
          </table>

          <p style="margin:0 0 24px;font-size:14px;color:#4a5568;line-height:1.7;">
            Ihr Kollege oder Ihre Kollegin erhält ebenfalls einen Willkommensbonus von 50&nbsp;€ auf ihre erste Rechnung.
          </p>

          <table cellpadding="0" cellspacing="0" style="margin-bottom:24px;">
            <tr><td style="background:#b89a5e;border-radius:4px;">
              <a href="https://exart.io/dashboard-settings#abonnement"
                 style="display:inline-block;padding:11px 22px;font-size:13px;font-weight:500;color:#1a2640;text-decoration:none;font-family:'DM Sans',Arial,sans-serif;">
                Abonnement und Empfehlungen ansehen →
              </a>
            </td></tr>
          </table>

          <p style="margin:0;font-size:12px;color:#6b7a94;line-height:1.6;">
            Bei Fragen stehen wir Ihnen unter <a href="mailto:kontakt@exart.io" style="color:#1a2640;">kontakt@exart.io</a> zur Verfügung.
          </p>
        </td></tr>

        <tr><td style="background:#f7f4ef;padding:16px 32px;border-top:0.5px solid rgba(26,38,64,0.1);">
          <p style="margin:0;font-size:11px;color:#6b7a94;text-align:center;">
            exart.io · <a href="https://exart.io" style="color:#1a2640;">exart.io</a>
          </p>
        </td></tr>

      </table>
    </td></tr>
  </table>
</body>
</html>
    `,
  })
}

// ── Referral reward notification to referrer after first payment ──
export async function sendReferralRewardNotification({ referrerName, referrerEmail, referredName }) {
  await resend.emails.send({
    from: FROM,
    to: referrerEmail,
    subject: `50 € Empfehlungsbonus gutgeschrieben — exart.io`,
    html: `
<!DOCTYPE html>
<html lang="de">
<head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1.0"></head>
<body style="margin:0;padding:0;background:#f7f4ef;font-family:'DM Sans',Arial,sans-serif;">
  <table width="100%" cellpadding="0" cellspacing="0" style="background:#f7f4ef;padding:32px 16px;">
    <tr><td align="center">
      <table width="560" cellpadding="0" cellspacing="0" style="background:#ffffff;border-radius:6px;overflow:hidden;border:0.5px solid rgba(26,38,64,0.12);">

        <tr><td style="background:#1a2640;padding:24px 32px;">
          <p style="margin:0;font-family:'Playfair Display',Georgia,serif;font-size:20px;font-weight:600;color:#ffffff;letter-spacing:-0.02em;">
            exart<span style="color:#b89a5e;font-family:'DM Sans',Arial,sans-serif;font-size:11px;font-weight:500;letter-spacing:0.12em;vertical-align:super;">.io</span>
          </p>
        </td></tr>

        <tr><td style="padding:32px;">
          <p style="margin:0 0 8px;font-size:11px;text-transform:uppercase;letter-spacing:0.14em;color:#b89a5e;font-weight:500;">Empfehlungsbonus</p>
          <h1 style="margin:0 0 20px;font-family:'Playfair Display',Georgia,serif;font-size:22px;font-weight:500;color:#1a2640;line-height:1.3;">
            Ihr Empfehlungsbonus wurde gutgeschrieben
          </h1>

          <table width="100%" cellpadding="0" cellspacing="0" style="background:#1a2640;border-radius:6px;margin-bottom:24px;">
            <tr><td style="padding:24px;">
              <p style="margin:0 0 8px;font-size:11px;text-transform:uppercase;letter-spacing:0.12em;color:#b89a5e;font-weight:600;font-family:'DM Sans',Arial,sans-serif;">Gutschrift erhalten</p>
              <p style="margin:0 0 4px;font-size:28px;font-weight:600;color:#ffffff;font-family:'Playfair Display',Georgia,serif;">50,00 €</p>
              <p style="margin:0;font-size:12px;color:rgba(255,255,255,0.5);font-family:'DM Sans',Arial,sans-serif;">wird von Ihrer nächsten Rechnung abgezogen</p>
            </td></tr>
          </table>

          <p style="margin:0 0 20px;font-size:14px;color:#4a5568;line-height:1.7;">
            Sehr geehrte/r ${referrerName},<br><br>
            <strong>${referredName}</strong> hat soeben ein Abonnement bei exart.io abgeschlossen. Ihr Empfehlungsbonus von 50&nbsp;€ wurde Ihrem Konto gutgeschrieben und wird automatisch von Ihrer nächsten Abrechnung abgezogen.
          </p>

          <table cellpadding="0" cellspacing="0" style="margin-bottom:24px;">
            <tr><td style="background:#b89a5e;border-radius:4px;">
              <a href="https://exart.io/dashboard-settings#abonnement"
                 style="display:inline-block;padding:11px 22px;font-size:13px;font-weight:500;color:#1a2640;text-decoration:none;font-family:'DM Sans',Arial,sans-serif;">
                Abonnement ansehen →
              </a>
            </td></tr>
          </table>

          <p style="margin:0;font-size:12px;color:#6b7a94;line-height:1.6;">
            Bei Fragen stehen wir Ihnen unter <a href="mailto:kontakt@exart.io" style="color:#1a2640;">kontakt@exart.io</a> zur Verfügung.
          </p>
        </td></tr>

        <tr><td style="background:#f7f4ef;padding:16px 32px;border-top:0.5px solid rgba(26,38,64,0.1);">
          <p style="margin:0;font-size:11px;color:#6b7a94;text-align:center;">
            exart.io · <a href="https://exart.io" style="color:#1a2640;">exart.io</a>
          </p>
        </td></tr>

      </table>
    </td></tr>
  </table>
</body>
</html>
    `,
  })
}

// ── Abgabefrist-Erinnerung ────────────────────────────────────────────────────
export async function sendDeadlineReminder({ recipientName, recipientEmail, caseTitle, patientRef, abgabefrist, daysLeft }) {
  const urgency = daysLeft <= 3 ? 'Dringende Erinnerung' : 'Erinnerung'
  const color   = daysLeft <= 3 ? '#c62828' : '#e65100'
  const dateStr = new Date(abgabefrist).toLocaleDateString('de-DE', { day: '2-digit', month: '2-digit', year: 'numeric' })

  await resend.emails.send({
    from: FROM,
    to: recipientEmail,
    subject: `${urgency}: Abgabefrist in ${daysLeft} Tag${daysLeft === 1 ? '' : 'en'} — ${caseTitle}`,
    html: `
<!DOCTYPE html>
<html lang="de">
<head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1.0"></head>
<body style="margin:0;padding:0;background:#f7f4ef;font-family:'DM Sans',Arial,sans-serif;">
  <table width="100%" cellpadding="0" cellspacing="0" style="background:#f7f4ef;padding:32px 16px;">
    <tr><td align="center">
      <table width="560" cellpadding="0" cellspacing="0" style="background:#ffffff;border-radius:6px;overflow:hidden;border:0.5px solid rgba(26,38,64,0.12);">
        <tr><td style="background:#1a2640;padding:24px 32px;">
          <p style="margin:0;font-family:'Playfair Display',Georgia,serif;font-size:20px;font-weight:600;color:#ffffff;letter-spacing:-0.02em;">
            exart<span style="color:#b89a5e;font-family:'DM Sans',Arial,sans-serif;font-size:11px;font-weight:500;letter-spacing:0.12em;vertical-align:super;">.io</span>
          </p>
        </td></tr>
        <tr><td style="padding:32px;">
          <p style="margin:0 0 8px;font-size:11px;text-transform:uppercase;letter-spacing:0.14em;color:${color};font-weight:500;">${urgency}</p>
          <h1 style="margin:0 0 20px;font-family:'Playfair Display',Georgia,serif;font-size:22px;font-weight:500;color:#1a2640;line-height:1.3;">
            Abgabefrist in ${daysLeft} Tag${daysLeft === 1 ? '' : 'en'}
          </h1>
          <table width="100%" cellpadding="0" cellspacing="0" style="background:#1a2640;border-radius:6px;margin-bottom:24px;">
            <tr><td style="padding:20px 24px;">
              <p style="margin:0 0 6px;font-size:11px;text-transform:uppercase;letter-spacing:0.12em;color:#b89a5e;font-weight:600;font-family:'DM Sans',Arial,sans-serif;">Frist</p>
              <p style="margin:0;font-size:24px;font-weight:600;color:#ffffff;font-family:'Playfair Display',Georgia,serif;">${dateStr}</p>
              <p style="margin:6px 0 0;font-size:12px;color:rgba(255,255,255,0.5);font-family:'DM Sans',Arial,sans-serif;">
                ${daysLeft === 1 ? 'Morgen ist die letzte Möglichkeit zur Einreichung.' : `Noch ${daysLeft} Tage bis zur Einreichungsfrist.`}
              </p>
            </td></tr>
          </table>
          <table width="100%" cellpadding="0" cellspacing="0" style="background:#f7f4ef;border-radius:5px;margin-bottom:24px;">
            <tr><td style="padding:16px 20px;">
              <p style="margin:0 0 4px;font-size:11px;text-transform:uppercase;letter-spacing:0.1em;color:#6b7a94;font-weight:600;font-family:'DM Sans',Arial,sans-serif;">Fall</p>
              <p style="margin:0;font-size:14px;font-weight:600;color:#1a2640;">${caseTitle}</p>
              ${patientRef ? `<p style="margin:4px 0 0;font-size:13px;color:#4a5568;">${patientRef}</p>` : ''}
            </td></tr>
          </table>
          <p style="margin:0 0 24px;font-size:14px;color:#4a5568;line-height:1.7;">
            Sehr geehrte/r ${recipientName},<br><br>
            dies ist eine automatische Erinnerung an die bevorstehende Abgabefrist für das o. g. Gutachten. Bitte stellen Sie sicher, dass das Gutachten rechtzeitig fertiggestellt und eingereicht wird.
          </p>
          <table cellpadding="0" cellspacing="0" style="margin-bottom:24px;">
            <tr><td style="background:#b89a5e;border-radius:4px;">
              <a href="https://exart.io/dashboard" style="display:inline-block;padding:11px 22px;font-size:13px;font-weight:500;color:#1a2640;text-decoration:none;font-family:'DM Sans',Arial,sans-serif;">
                Fall öffnen →
              </a>
            </td></tr>
          </table>
          <p style="margin:0;font-size:12px;color:#6b7a94;line-height:1.6;">
            Diese E-Mail wurde automatisch von exart.io generiert. Bei Fragen wenden Sie sich an <a href="mailto:kontakt@exart.io" style="color:#1a2640;">kontakt@exart.io</a>.
          </p>
        </td></tr>
        <tr><td style="background:#f7f4ef;padding:16px 32px;border-top:0.5px solid rgba(26,38,64,0.1);">
          <p style="margin:0;font-size:11px;color:#6b7a94;text-align:center;">exart.io · <a href="https://exart.io" style="color:#1a2640;">exart.io</a></p>
        </td></tr>
      </table>
    </td></tr>
  </table>
</body>
</html>`,
  })
}

// ── Willkommensmail nach Verifizierung ────────────────────────────────────────
export async function sendWelcomeEmail({ recipientName, recipientEmail }) {
  await resend.emails.send({
    from: FROM,
    to: recipientEmail,
    subject: 'Willkommen bei exart.io — Ihr Zugang ist aktiviert',
    html: `
<!DOCTYPE html>
<html lang="de">
<head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1.0"></head>
<body style="margin:0;padding:0;background:#f7f4ef;font-family:'DM Sans',Arial,sans-serif;">
  <table width="100%" cellpadding="0" cellspacing="0" style="background:#f7f4ef;padding:32px 16px;">
    <tr><td align="center">
      <table width="560" cellpadding="0" cellspacing="0" style="background:#ffffff;border-radius:6px;overflow:hidden;border:0.5px solid rgba(26,38,64,0.12);">
        <tr><td style="background:#1a2640;padding:24px 32px;">
          <p style="margin:0;font-family:'Playfair Display',Georgia,serif;font-size:20px;font-weight:600;color:#ffffff;">
            exart<span style="color:#b89a5e;font-family:'DM Sans',Arial,sans-serif;font-size:11px;font-weight:500;letter-spacing:0.12em;vertical-align:super;">.io</span>
          </p>
        </td></tr>
        <tr><td style="padding:32px;">
          <p style="margin:0 0 8px;font-size:11px;text-transform:uppercase;letter-spacing:0.14em;color:#b89a5e;font-weight:500;">Willkommen</p>
          <h1 style="margin:0 0 20px;font-family:'Playfair Display',Georgia,serif;font-size:22px;font-weight:500;color:#1a2640;line-height:1.3;">
            Ihr Zugang ist jetzt vollständig aktiviert
          </h1>
          <p style="margin:0 0 20px;font-size:14px;color:#4a5568;line-height:1.7;">
            Sehr geehrte/r ${recipientName},<br><br>
            Ihre Approbation wurde erfolgreich verifiziert. Sie haben nun vollen Zugang zu exart.io und können sofort mit der Erstellung Ihrer ersten Gutachten beginnen.
          </p>
          <table width="100%" cellpadding="0" cellspacing="0" style="background:#f7f4ef;border-radius:5px;margin-bottom:24px;">
            <tr><td style="padding:20px 24px;">
              <p style="margin:0 0 12px;font-size:13px;font-weight:600;color:#1a2640;">In drei Schritten zum ersten Gutachten:</p>
              <p style="margin:0 0 8px;font-size:13px;color:#4a5568;line-height:1.6;">
                <strong style="color:#1a2640;">1.</strong> Neuen Fall anlegen — Patientenreferenz und Gerichtsbeschluss hochladen<br>
                <strong style="color:#1a2640;">2.</strong> Falldokumentation hochladen — Arztbriefe, Befunde, Laborberichte<br>
                <strong style="color:#1a2640;">3.</strong> Gutachten generieren — Typ wählen, Disclaimer bestätigen, fertig
              </p>
            </td></tr>
          </table>
          <table cellpadding="0" cellspacing="0" style="margin-bottom:24px;">
            <tr><td style="background:#b89a5e;border-radius:4px;">
              <a href="https://exart.io/dashboard" style="display:inline-block;padding:11px 22px;font-size:13px;font-weight:500;color:#1a2640;text-decoration:none;font-family:'DM Sans',Arial,sans-serif;">
                Zum Dashboard →
              </a>
            </td></tr>
          </table>
          <p style="margin:0 0 8px;font-size:13px;color:#4a5568;line-height:1.7;">
            Ihr Empfehlungscode für das Empfehlungsprogramm finden Sie unter Einstellungen → Abonnement.
          </p>
          <p style="margin:0;font-size:12px;color:#6b7a94;line-height:1.6;">
            Bei Fragen stehen wir Ihnen unter <a href="mailto:kontakt@exart.io" style="color:#1a2640;">kontakt@exart.io</a> zur Verfügung.
          </p>
        </td></tr>
        <tr><td style="background:#f7f4ef;padding:16px 32px;border-top:0.5px solid rgba(26,38,64,0.1);">
          <p style="margin:0;font-size:11px;color:#6b7a94;text-align:center;">exart.io · <a href="https://exart.io" style="color:#1a2640;">exart.io</a></p>
        </td></tr>
      </table>
    </td></tr>
  </table>
</body>
</html>`,
  })
}

// ── Einladungsmail ────────────────────────────────────────────────────────────
export async function sendInvitationEmail({ recipientEmail, inviterName, orgName, role, acceptUrl }) {
  const roleLabel = role === 'assistent' ? 'Assistent/in' : 'Sachverständige/r'

  await resend.emails.send({
    from: FROM,
    to: recipientEmail,
    subject: `Einladung zur Organisation ${orgName} — exart.io`,
    html: `
<!DOCTYPE html>
<html lang="de">
<head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1.0"></head>
<body style="margin:0;padding:0;background:#f7f4ef;font-family:'DM Sans',Arial,sans-serif;">
  <table width="100%" cellpadding="0" cellspacing="0" style="background:#f7f4ef;padding:32px 16px;">
    <tr><td align="center">
      <table width="560" cellpadding="0" cellspacing="0" style="background:#ffffff;border-radius:6px;overflow:hidden;border:0.5px solid rgba(26,38,64,0.12);">
        <tr><td style="background:#1a2640;padding:24px 32px;">
          <p style="margin:0;font-family:'Playfair Display',Georgia,serif;font-size:20px;font-weight:600;color:#ffffff;letter-spacing:-0.02em;">
            exart<span style="color:#b89a5e;font-family:'DM Sans',Arial,sans-serif;font-size:11px;font-weight:500;letter-spacing:0.12em;vertical-align:super;">.io</span>
          </p>
        </td></tr>
        <tr><td style="padding:32px;">
          <p style="margin:0 0 8px;font-size:11px;text-transform:uppercase;letter-spacing:0.14em;color:#b89a5e;font-weight:500;">Einladung</p>
          <h1 style="margin:0 0 20px;font-family:'Playfair Display',Georgia,serif;font-size:22px;font-weight:500;color:#1a2640;line-height:1.3;">
            Sie wurden zur Organisation eingeladen
          </h1>
          <table width="100%" cellpadding="0" cellspacing="0" style="background:#f7f4ef;border-radius:5px;margin-bottom:24px;">
            <tr><td style="padding:20px 24px;">
              <p style="margin:0 0 8px;font-size:13px;color:#6b7a94;font-family:'DM Sans',Arial,sans-serif;">
                <strong style="color:#1a2640;">${inviterName}</strong> hat Sie eingeladen, der Organisation
                <strong style="color:#1a2640;">${orgName}</strong> auf exart.io beizutreten.
              </p>
              <p style="margin:0;font-size:13px;color:#4a5568;line-height:1.6;">
                Ihre Rolle: <strong style="color:#1a2640;">${roleLabel}</strong>
              </p>
            </td></tr>
          </table>
          <p style="margin:0 0 24px;font-size:14px;color:#4a5568;line-height:1.7;">
            Klicken Sie auf den Button unten, um die Einladung anzunehmen. Der Link ist 7 Tage gültig.
          </p>
          <table cellpadding="0" cellspacing="0" style="margin-bottom:24px;">
            <tr><td style="background:#1a2640;border-radius:4px;">
              <a href="${acceptUrl}"
                 style="display:inline-block;padding:13px 28px;font-size:13px;font-weight:500;color:#ffffff;text-decoration:none;font-family:'DM Sans',Arial,sans-serif;">
                Einladung annehmen →
              </a>
            </td></tr>
          </table>
          <p style="margin:0 0 8px;font-size:12px;color:#6b7a94;line-height:1.6;">
            Falls Sie diese Einladung nicht erwartet haben, können Sie diese E-Mail ignorieren.
          </p>
          <p style="margin:0;font-size:12px;color:#6b7a94;line-height:1.6;">
            Der Link läuft am ${new Date(Date.now() + 7*24*60*60*1000).toLocaleDateString('de-DE')} ab.
          </p>
        </td></tr>
        <tr><td style="background:#f7f4ef;padding:16px 32px;border-top:0.5px solid rgba(26,38,64,0.1);">
          <p style="margin:0;font-size:11px;color:#6b7a94;text-align:center;">exart.io · <a href="https://exart.io" style="color:#1a2640;">exart.io</a></p>
        </td></tr>
      </table>
    </td></tr>
  </table>
</body>
</html>`,
  })
}

// ── Admin: new user registered ───────────────────────────────
export async function sendAdminNewUserRegistered({ fullName, email }) {
  await resend.emails.send({
    from: FROM,
    to: ADMIN_EMAIL,
    subject: `[exart.io] Neue Registrierung — ${fullName || email}`,
    html: `
<!DOCTYPE html>
<html lang="de">
<head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1.0"></head>
<body style="margin:0;padding:0;background:#f7f4ef;font-family:'DM Sans',Arial,sans-serif;">
  <table width="100%" cellpadding="0" cellspacing="0" style="background:#f7f4ef;padding:32px 16px;">
    <tr><td align="center">
      <table width="580" cellpadding="0" cellspacing="0" style="background:#ffffff;border-radius:6px;overflow:hidden;border:0.5px solid rgba(26,38,64,0.12);">
        <tr><td style="background:#1a2640;padding:24px 32px;">
          <p style="margin:0;font-family:'Playfair Display',Georgia,serif;font-size:20px;font-weight:600;color:#ffffff;">exart<span style="color:#b89a5e;">.</span>io</p>
          <p style="margin:6px 0 0;font-size:11px;color:rgba(255,255,255,0.45);letter-spacing:0.12em;text-transform:uppercase;">Admin-Benachrichtigung</p>
        </td></tr>
        <tr><td style="padding:32px;">
          <p style="margin:0 0 8px;font-size:13px;font-weight:600;color:#1a2640;text-transform:uppercase;letter-spacing:0.1em;">Neue Registrierung</p>
          <p style="margin:0 0 24px;font-family:'Playfair Display',Georgia,serif;font-size:22px;font-weight:500;color:#1a2640;">Ein neuer Nutzer hat sich registriert.</p>
          <table width="100%" cellpadding="0" cellspacing="0" style="border:0.5px solid rgba(26,38,64,0.12);border-radius:5px;overflow:hidden;margin-bottom:24px;">
            <tr style="background:#f7f4ef;">
              <td style="padding:12px 16px;font-size:12px;color:#6b7a94;width:140px;">Name</td>
              <td style="padding:12px 16px;font-size:13px;color:#1a2640;font-weight:500;">${fullName || '—'}</td>
            </tr>
            <tr>
              <td style="padding:12px 16px;font-size:12px;color:#6b7a94;border-top:0.5px solid rgba(26,38,64,0.08);">E-Mail</td>
              <td style="padding:12px 16px;font-size:13px;color:#1a2640;border-top:0.5px solid rgba(26,38,64,0.08);">${email}</td>
            </tr>
            <tr style="background:#f7f4ef;">
              <td style="padding:12px 16px;font-size:12px;color:#6b7a94;border-top:0.5px solid rgba(26,38,64,0.08);">Zeitpunkt</td>
              <td style="padding:12px 16px;font-size:13px;color:#1a2640;border-top:0.5px solid rgba(26,38,64,0.08);">${new Date().toLocaleString('de-DE', { timeZone: 'Europe/Berlin' })}</td>
            </tr>
          </table>
          <p style="margin:0;font-size:12px;color:#6b7a94;line-height:1.6;">Das Konto ist noch nicht verifiziert. Eine Verifizierungsanfrage wird separat gemeldet, sobald der Nutzer seinen Approbationsnachweis einreicht.</p>
        </td></tr>
        <tr><td style="background:#f7f4ef;padding:16px 32px;border-top:0.5px solid rgba(26,38,64,0.08);">
          <p style="margin:0;font-size:11px;color:#6b7a94;">exart.io Admin-System · Diese E-Mail wurde automatisch generiert.</p>
        </td></tr>
      </table>
    </td></tr>
  </table>
</body>
</html>`,
  })
}

// ── Admin: user email confirmed ───────────────────────────────
export async function sendAdminEmailConfirmed({ fullName, email }) {
  await resend.emails.send({
    from: FROM,
    to: ADMIN_EMAIL,
    subject: `[exart.io] E-Mail bestätigt — ${fullName || email}`,
    html: `
<!DOCTYPE html>
<html lang="de">
<head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1.0"></head>
<body style="margin:0;padding:0;background:#f7f4ef;font-family:'DM Sans',Arial,sans-serif;">
  <table width="100%" cellpadding="0" cellspacing="0" style="background:#f7f4ef;padding:32px 16px;">
    <tr><td align="center">
      <table width="580" cellpadding="0" cellspacing="0" style="background:#ffffff;border-radius:6px;overflow:hidden;border:0.5px solid rgba(26,38,64,0.12);">
        <tr><td style="background:#1a2640;padding:24px 32px;">
          <p style="margin:0;font-family:'Playfair Display',Georgia,serif;font-size:20px;font-weight:600;color:#ffffff;">exart<span style="color:#b89a5e;">.</span>io</p>
          <p style="margin:6px 0 0;font-size:11px;color:rgba(255,255,255,0.45);letter-spacing:0.12em;text-transform:uppercase;">Admin-Benachrichtigung</p>
        </td></tr>
        <tr><td style="padding:32px;">
          <p style="margin:0 0 8px;font-size:13px;font-weight:600;color:#2d7a4f;text-transform:uppercase;letter-spacing:0.1em;">E-Mail bestätigt</p>
          <p style="margin:0 0 24px;font-family:'Playfair Display',Georgia,serif;font-size:22px;font-weight:500;color:#1a2640;">Ein Nutzer hat seine E-Mail-Adresse bestätigt.</p>
          <table width="100%" cellpadding="0" cellspacing="0" style="border:0.5px solid rgba(26,38,64,0.12);border-radius:5px;overflow:hidden;margin-bottom:24px;">
            <tr style="background:#f7f4ef;">
              <td style="padding:12px 16px;font-size:12px;color:#6b7a94;width:140px;">Name</td>
              <td style="padding:12px 16px;font-size:13px;color:#1a2640;font-weight:500;">${fullName || '—'}</td>
            </tr>
            <tr>
              <td style="padding:12px 16px;font-size:12px;color:#6b7a94;border-top:0.5px solid rgba(26,38,64,0.08);">E-Mail</td>
              <td style="padding:12px 16px;font-size:13px;color:#1a2640;border-top:0.5px solid rgba(26,38,64,0.08);">${email}</td>
            </tr>
            <tr style="background:#f7f4ef;">
              <td style="padding:12px 16px;font-size:12px;color:#6b7a94;border-top:0.5px solid rgba(26,38,64,0.08);">Zeitpunkt</td>
              <td style="padding:12px 16px;font-size:13px;color:#1a2640;border-top:0.5px solid rgba(26,38,64,0.08);">${new Date().toLocaleString('de-DE', { timeZone: 'Europe/Berlin' })}</td>
            </tr>
          </table>
          <p style="margin:0;font-size:12px;color:#6b7a94;line-height:1.6;">Das Konto ist nun aktiv. Der Nutzer kann sich einloggen und eine Verifizierungsanfrage einreichen.</p>
        </td></tr>
        <tr><td style="background:#f7f4ef;padding:16px 32px;border-top:0.5px solid rgba(26,38,64,0.08);">
          <p style="margin:0;font-size:11px;color:#6b7a94;">exart.io Admin-System · Diese E-Mail wurde automatisch generiert.</p>
        </td></tr>
      </table>
    </td></tr>
  </table>
</body>
</html>`,
  })
}

// ── Admin: user deleted account ───────────────────────────────
export async function sendAdminAccountDeleted({ fullName, email }) {
  await resend.emails.send({
    from: FROM,
    to: ADMIN_EMAIL,
    subject: `[exart.io] Konto gelöscht — ${fullName || email}`,
    html: `
<!DOCTYPE html>
<html lang="de">
<head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1.0"></head>
<body style="margin:0;padding:0;background:#f7f4ef;font-family:'DM Sans',Arial,sans-serif;">
  <table width="100%" cellpadding="0" cellspacing="0" style="background:#f7f4ef;padding:32px 16px;">
    <tr><td align="center">
      <table width="580" cellpadding="0" cellspacing="0" style="background:#ffffff;border-radius:6px;overflow:hidden;border:0.5px solid rgba(26,38,64,0.12);">
        <tr><td style="background:#1a2640;padding:24px 32px;">
          <p style="margin:0;font-family:'Playfair Display',Georgia,serif;font-size:20px;font-weight:600;color:#ffffff;">exart<span style="color:#b89a5e;">.</span>io</p>
          <p style="margin:6px 0 0;font-size:11px;color:rgba(255,255,255,0.45);letter-spacing:0.12em;text-transform:uppercase;">Admin-Benachrichtigung</p>
        </td></tr>
        <tr><td style="padding:32px;">
          <p style="margin:0 0 8px;font-size:13px;font-weight:600;color:#b84040;text-transform:uppercase;letter-spacing:0.1em;">Konto gelöscht</p>
          <p style="margin:0 0 24px;font-family:'Playfair Display',Georgia,serif;font-size:22px;font-weight:500;color:#1a2640;">Ein Nutzer hat sein Konto gelöscht.</p>
          <table width="100%" cellpadding="0" cellspacing="0" style="border:0.5px solid rgba(26,38,64,0.12);border-radius:5px;overflow:hidden;margin-bottom:24px;">
            <tr style="background:#f7f4ef;">
              <td style="padding:12px 16px;font-size:12px;color:#6b7a94;width:140px;">Name</td>
              <td style="padding:12px 16px;font-size:13px;color:#1a2640;font-weight:500;">${fullName || '—'}</td>
            </tr>
            <tr>
              <td style="padding:12px 16px;font-size:12px;color:#6b7a94;border-top:0.5px solid rgba(26,38,64,0.08);">E-Mail</td>
              <td style="padding:12px 16px;font-size:13px;color:#1a2640;border-top:0.5px solid rgba(26,38,64,0.08);">${email}</td>
            </tr>
            <tr style="background:#f7f4ef;">
              <td style="padding:12px 16px;font-size:12px;color:#6b7a94;border-top:0.5px solid rgba(26,38,64,0.08);">Zeitpunkt</td>
              <td style="padding:12px 16px;font-size:13px;color:#1a2640;border-top:0.5px solid rgba(26,38,64,0.08);">${new Date().toLocaleString('de-DE', { timeZone: 'Europe/Berlin' })}</td>
            </tr>
          </table>
          <p style="margin:0;font-size:12px;color:#6b7a94;line-height:1.6;">Alle Konto- und Falldaten wurden gemäß DSGVO gelöscht.</p>
        </td></tr>
        <tr><td style="background:#f7f4ef;padding:16px 32px;border-top:0.5px solid rgba(26,38,64,0.08);">
          <p style="margin:0;font-size:11px;color:#6b7a94;">exart.io Admin-System · Diese E-Mail wurde automatisch generiert.</p>
        </td></tr>
      </table>
    </td></tr>
  </table>
</body>
</html>`,
  })
}