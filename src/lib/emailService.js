import { Resend } from 'resend'

const resend = new Resend(process.env.RESEND_API_KEY)

const FROM = 'exart.io <noreply@exart.io>'
const ADMIN_EMAIL = 'k.schlaaff@posteo.de'

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