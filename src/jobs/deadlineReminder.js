// jobs/deadlineReminder.js
// Run daily — checks cases with abgabefrist in exactly 7 or 3 days
// and sends reminder emails to the responsible doctor

import { supabaseAdmin } from '../lib/supabase.js'
import { sendDeadlineReminder } from '../lib/emailService.js'

export async function runDeadlineReminders() {
  const now    = new Date()
  const today  = now.toISOString().slice(0, 10)

  // Days to remind: 7 and 3 days before deadline
  const remind = [7, 3].map(d => {
    const dt = new Date(now)
    dt.setDate(dt.getDate() + d)
    return dt.toISOString().slice(0, 10)
  })

  console.log(`[DEADLINE] Checking reminders for dates: ${remind.join(', ')}`)

  const { data: cases, error } = await supabaseAdmin
    .from('cases')
    .select('id, title, patient_ref, abgabefrist, org_id, status')
    .in('abgabefrist', remind)
    .neq('status', 'completed')

  if (error) { console.error('[DEADLINE] Query failed:', error.message); return }
  if (!cases || cases.length === 0) { console.log('[DEADLINE] No cases due.'); return }

  console.log(`[DEADLINE] Found ${cases.length} case(s) due for reminder`)

  for (const c of cases) {
    try {
      // Get org members who are verified doctors
      const { data: members } = await supabaseAdmin
        .from('organization_members')
        .select('user_id')
        .eq('org_id', c.org_id)

      if (!members?.length) continue

      for (const m of members) {
        const { data: profile } = await supabaseAdmin
          .from('profiles')
          .select('full_name, auth_user_id, verification_status')
          .eq('auth_user_id', m.user_id)
          .single()

        if (!profile || profile.verification_status !== 'verified') continue

        const { data: authUser } = await supabaseAdmin.auth.admin.getUserById(profile.auth_user_id)
        if (!authUser?.user?.email) continue

        const daysLeft = Math.ceil((new Date(c.abgabefrist) - now) / (1000 * 60 * 60 * 24))

        await sendDeadlineReminder({
          recipientName:  profile.full_name || 'Kollegin/Kollege',
          recipientEmail: authUser.user.email,
          caseTitle:      c.title,
          patientRef:     c.patient_ref,
          abgabefrist:    c.abgabefrist,
          daysLeft,
        })

        console.log(`[DEADLINE] Reminder sent to ${authUser.user.email} for case "${c.title}" (${daysLeft} days)`)
      }
    } catch(err) {
      console.error(`[DEADLINE] Failed for case ${c.id}:`, err.message)
    }
  }
}