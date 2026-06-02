import { Resend } from 'resend'

const resend = new Resend(process.env.RESEND_API_KEY)

const FROM = 'exart.io <noreply@mail.exart.io>'
const ADMIN_EMAIL = 'k.schlaaff@posteo.de'

// ── Verification notification to admin ───────────────────────
export async function sendVerificationNotification({ fullName, docType, orgName, submittedAt }) {
  const docTypeLabels = {
    approbation:    'Approbationsurkunde',
    facharzturkunde: 'Facharztanerkennung',
    berufsausweis:  'EU-Berufsausweis',
    other:          'Sonstiger Nachweis',
  }

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
      <table width="560" cellpadding="0" cellspacing="0" style="background:#ffffff;border-radius:6px;overflow:hidden;border:0.5px solid rgba(26,38,64,0.12);">
        
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

          <table width="100%" cellpadding="0" cellspacing="0" style="background:#f7f4ef;border-radius:5px;margin-bottom:24px;">
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
              </table>
            </td></tr>
          </table>

          <p style="margin:0 0 24px;font-size:14px;color:#4a5568;line-height:1.6;">
            Bitte prüfen Sie das eingereichte Dokument in der Supabase-Verwaltungsoberfläche und genehmigen oder lehnen Sie die Verifizierungsanfrage ab.
          </p>

          <table cellpadding="0" cellspacing="0">
            <tr><td style="background:#1a2640;border-radius:4px;">
              <a href="https://supabase.com/dashboard/project/bcxyychocefmurtblmwa/editor" 
                 style="display:inline-block;padding:11px 22px;font-size:13px;font-weight:500;color:#ffffff;text-decoration:none;font-family:'DM Sans',Arial,sans-serif;">
                Supabase öffnen →
              </a>
            </td></tr>
          </table>

          <p style="margin:24px 0 0;font-size:11px;color:#6b7a94;line-height:1.6;">
            Nach Prüfung führen Sie Query #2 aus der Datei <code>verification-queries.sql</code> aus, um die Verifizierung zu genehmigen.
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
              <a href="https://exart-io.webflow.io/dashboard"
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