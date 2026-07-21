// Support System Phase 4 — starter Help Center / FAQ fixtures.
//
// These are DEV/TEST demo fixtures only (gated in run.ts behind
// NODE_ENV !== 'production'), for the same reason as seedState: production FAQ
// content must come through the content-authoring handoff and the admin
// review/publish workflow, not a seed. The starter copy below is deliberately
// OPERATIONAL (how to use the app, security, privacy) and carries no clinical
// instruction — anything clinical is Dr. Singal's to author and sign off.
//
// Reuses the existing `content` module (contentType=FAQ); the public
// `GET /v2/content?type=FAQ` endpoint already filters PUBLISHED FAQ items, so
// the patient Help Center reads them with no new API.
import { ContentStatus, ContentType, UserRole } from '../../src/generated/prisma/enums.js'
import { prisma } from './helpers.js'

interface FaqSeed {
  humanId: string
  title: string
  summary: string
  body: string
  tags: string[]
}

// Starter set per the roadmap: how to take/read a reading, what an alert means
// (mechanical, not clinical), reset MFA, who sees my data, data use, edit meds.
const FAQS: FaqSeed[] = [
  {
    humanId: 'FAQ-TAKE-READING',
    title: 'How do I take and enter a blood pressure reading?',
    summary: 'Steps for measuring and logging a reading in the app.',
    body: 'Sit quietly for five minutes with your feet flat and your arm resting at heart level. Take the reading with your cuff, then open the app and go to your daily check-in. Enter the top number (systolic) and the bottom number (diastolic) exactly as they show on your monitor, add your pulse if you have it, and save. If a number looks wrong, you can measure again and re-enter it.',
    tags: ['readings', 'check-in', 'getting-started'],
  },
  {
    humanId: 'FAQ-WHAT-IS-ALERT',
    title: 'What does it mean when I get an alert?',
    summary: 'An alert means the app noticed a reading outside your target and told your care team.',
    body: 'An alert means the app noticed one of your readings was outside the target range your care team set for you, and it let your care team know. An alert is not a diagnosis and it is not medical advice — it is a heads-up so your care team can follow up. If you have questions about your health, your symptoms, or your medicines, contact your care team through the app. If you think you are having an emergency, call 911.',
    tags: ['alerts', 'safety'],
  },
  {
    humanId: 'FAQ-RESET-MFA',
    title: 'I lost access to my authenticator — how do I reset it?',
    summary: 'How to recover when you can no longer complete two-step sign-in.',
    body: 'If you can still sign in, open Settings and choose to reset your two-step verification, then follow the steps to set it up again. If you are locked out and cannot sign in at all, use the "I can\'t sign in" link on the sign-in page to reach the support team. For your safety, the team will confirm who you are before making any change to your account.',
    tags: ['security', 'mfa', 'account'],
  },
  {
    humanId: 'FAQ-WHO-SEES-DATA',
    title: 'Who can see my readings and health information?',
    summary: 'Your care team sees your readings; support staff do not see clinical data.',
    body: 'Your readings and health information are shared with your assigned care team so they can support you. Support staff who help with account and technical problems do not see your clinical readings. Access to your information is limited to the people involved in your care and is recorded for your protection.',
    tags: ['privacy', 'data'],
  },
  {
    humanId: 'FAQ-DATA-USE',
    title: 'How is my information used and protected?',
    summary: 'Your information is used to support your care and is protected under HIPAA.',
    body: 'Your information is used to help your care team monitor your blood pressure and follow up when needed. It is stored securely and handled under HIPAA privacy and security rules. You can read the full details in the Privacy Notice linked in the app footer.',
    tags: ['privacy', 'data', 'hipaa'],
  },
  {
    humanId: 'FAQ-EDIT-MEDS',
    title: 'How do I update my medication list?',
    summary: 'Where to review and update the medicines you are taking.',
    body: 'Open your medications in the app to see the list you reported. You can add a medicine, mark one as stopped, or update the details. Your care team reviews what you report. Always keep your list current so your care team has the right information — but never start, stop, or change a dose on your own without talking to your care team first.',
    tags: ['medications', 'getting-started'],
  },
]

/**
 * Idempotent. Upserts the starter FAQ set as PUBLISHED content authored by an
 * existing admin (SUPER_ADMIN or MEDICAL_DIRECTOR). Skips silently if no such
 * author exists (e.g. a minimal seed) — the FAQ fixture is non-essential.
 */
export async function seedFaqContent() {
  const author = await prisma.user.findFirst({
    where: {
      OR: [
        { roles: { has: UserRole.SUPER_ADMIN } },
        { roles: { has: UserRole.MEDICAL_DIRECTOR } },
      ],
    },
    select: { id: true },
  })
  if (!author) {
    console.log('  FAQ content: skipped (no admin author found)')
    return
  }

  const now = new Date()
  for (const faq of FAQS) {
    await prisma.content.upsert({
      where: { humanId: faq.humanId },
      // No update on re-seed — do not clobber edits made through the admin UI.
      update: {},
      create: {
        humanId: faq.humanId,
        title: faq.title,
        summary: faq.summary,
        body: faq.body,
        contentType: ContentType.FAQ,
        status: ContentStatus.PUBLISHED,
        needsReview: false,
        tags: faq.tags,
        submittedById: author.id,
        publishedVersionNo: 1,
        publishedAt: now,
        lastReviewed: now,
      },
    })
  }
  console.log(`  FAQ content: ${FAQS.length} starter articles seeded`)
}
