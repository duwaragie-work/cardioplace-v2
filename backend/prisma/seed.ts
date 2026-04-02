import { PrismaClient } from '../src/generated/prisma/client.js'
import { PrismaPg } from '@prisma/adapter-pg'
import pg from 'pg'
import bcrypt from 'bcrypt'
import 'dotenv/config'

const dbUrl = process.env.DATABASE_URL!
const isAccelerate = dbUrl.startsWith('prisma://')
const prisma = isAccelerate
  ? new PrismaClient({ accelerateUrl: dbUrl })
  : new PrismaClient({ adapter: new PrismaPg(new pg.Pool({ connectionString: dbUrl })) })

// ─── Helpers ──────────────────────────────────────────────────────────────────

function daysAgo(n: number): Date {
  const d = new Date()
  d.setDate(d.getDate() - n)
  d.setHours(0, 0, 0, 0)
  return d
}

function dateOnly(d: Date): Date {
  return new Date(Date.UTC(d.getFullYear(), d.getMonth(), d.getDate()))
}

function rand(min: number, max: number): number {
  return Math.floor(Math.random() * (max - min + 1)) + min
}

function pick<T>(arr: T[]): T {
  return arr[Math.floor(Math.random() * arr.length)]
}

const SYMPTOMS = [
  'Chest Pain', 'Severe Headache', 'Shortness of Breath', 'Dizziness',
  'Blurred Vision', 'Fatigue', 'Nausea', 'Swelling', 'Palpitations',
]

function randomSymptoms(maxCount: number): string[] {
  const count = rand(0, maxCount)
  const shuffled = [...SYMPTOMS].sort(() => Math.random() - 0.5)
  return shuffled.slice(0, count)
}

// ─── Patient definitions ─────────────────────────────────────────────────────

interface PatientDef {
  email: string
  otp: string
  name: string
  riskTier: 'STANDARD' | 'ELEVATED' | 'HIGH'
  commPref: 'TEXT_FIRST' | 'AUDIO_FIRST'
  lang: string
  dob: string
  condition: string
  bp: { sysBase: number; sysVar: number; diaBase: number; diaVar: number; trendRise?: number }
  weight: { base: number; variance: number }
  medCompliance: number
  symptomFreq: number
  days: number
  crisisDays?: number[]  // force crisis readings on these day offsets from end
  conversations: { title: string; messages: { user: string; ai: string; source: string }[] }[]
}

const PATIENTS: PatientDef[] = [
  {
    email: 'dorothy.james@healplace.com',
    otp: '111111',
    name: 'Dorothy James',
    riskTier: 'STANDARD',
    commPref: 'TEXT_FIRST',
    lang: 'en',
    dob: '1958-03-22',
    condition: 'Hypertension - Stage 1',
    bp: { sysBase: 120, sysVar: 8, diaBase: 76, diaVar: 4 },
    weight: { base: 155, variance: 2 },
    medCompliance: 0.95,
    symptomFreq: 0,
    days: 90,
    conversations: [
      {
        title: 'Daily Check-in',
        messages: [
          { user: 'Good morning! My blood pressure was 118/74 today.', ai: 'Great reading, Dorothy! Your BP is well within the normal range. Keep up the good work with your medication and healthy habits.', source: 'text' },
          { user: 'Should I still take my medication even when my readings are normal?', ai: 'Yes, absolutely. Your normal readings are a sign that the medication is working. Stopping it could cause your BP to rise again. Always follow your doctor\'s instructions.', source: 'text' },
          { user: 'What vegetables are best for blood pressure?', ai: 'Leafy greens like spinach and kale are excellent — they\'re rich in potassium which helps your body flush out sodium. Beets, sweet potatoes, and broccoli are also great choices for the DASH diet.', source: 'text' },
        ],
      },
      {
        title: 'Diet Questions',
        messages: [
          { user: 'Is it okay to have a glass of wine with dinner?', ai: 'Moderate alcohol consumption (one glass for women) is generally acceptable, but it can interact with BP medication. Check with your doctor about your specific medications.', source: 'text' },
          { user: 'How much salt should I have per day?', ai: 'The American Heart Association recommends no more than 2,300mg of sodium per day, ideally moving toward 1,500mg. Read nutrition labels carefully — processed foods often contain hidden sodium.', source: 'text' },
          { user: 'Thank you, this app has really helped me stay on track!', ai: 'You\'re welcome, Dorothy! Your consistency with daily check-ins is impressive. Your 90-day trend shows stable, healthy readings. Keep it up!', source: 'voice' },
        ],
      },
    ],
  },
  {
    email: 'marcus.williams@healplace.com',
    otp: '222222',
    name: 'Marcus Williams',
    riskTier: 'ELEVATED',
    commPref: 'AUDIO_FIRST',
    lang: 'en',
    dob: '1965-11-08',
    condition: 'Hypertension - Stage 2',
    bp: { sysBase: 128, sysVar: 12, diaBase: 82, diaVar: 6, trendRise: 20 },
    weight: { base: 205, variance: 4 },
    medCompliance: 0.75,
    symptomFreq: 1,
    days: 90,
    crisisDays: [5, 2],
    conversations: [
      {
        title: 'BP Concerns',
        messages: [
          { user: 'My blood pressure has been creeping up the last few weeks. Should I be worried?', ai: 'I can see your readings have been trending upward. This is worth discussing with your care team. In the meantime, try to reduce sodium, manage stress, and take your medication consistently.', source: 'voice' },
          { user: 'Work has been really stressful lately, could that be causing it?', ai: 'Yes, chronic stress can definitely raise blood pressure. Consider stress management techniques like deep breathing, regular walks, or even brief meditation. Your body\'s stress response directly affects your cardiovascular system.', source: 'voice' },
          { user: 'I missed my medication twice this week because of long shifts.', ai: 'Missing doses can cause your BP to spike. Try setting a phone alarm as a reminder. If your schedule makes it hard to take medication at the same time daily, talk to your doctor about adjusting the timing.', source: 'voice' },
        ],
      },
      {
        title: 'Exercise and Lifestyle',
        messages: [
          { user: 'What kind of exercise would help lower my blood pressure?', ai: 'Aim for 150 minutes of moderate aerobic exercise per week — brisk walking, cycling, or swimming. Even 10-minute walks after meals can help. Avoid heavy weightlifting until your BP is better controlled.', source: 'text' },
          { user: 'I used to play basketball but stopped a few years ago.', ai: 'Getting back to recreational sports is a great idea! Start gradually — maybe shooting around before jumping into full games. Your doctor can advise on safe intensity levels given your current BP.', source: 'text' },
          { user: 'My reading today was 152/94. That seems really high.', ai: 'That is elevated. Please make sure you\'ve been sitting quietly for 5 minutes before measuring. If readings stay above 140/90 consistently, your doctor may need to adjust your medication. I\'m flagging this for your care team.', source: 'voice' },
        ],
      },
      {
        title: 'Medication Follow-up',
        messages: [
          { user: 'The doctor increased my medication dosage after the last visit.', ai: 'That\'s a common adjustment when BP trends upward. Give the new dose a few weeks to take full effect. Continue monitoring daily so we can track whether it\'s helping.', source: 'text' },
          { user: 'I\'ve been getting headaches since the dosage change.', ai: 'Headaches can be a side effect of some BP medications, especially during adjustment periods. Keep tracking this symptom — if it persists beyond 2 weeks, contact your doctor. Don\'t stop the medication without consulting them.', source: 'text' },
        ],
      },
    ],
  },
  {
    email: 'maria.santos@healplace.com',
    otp: '333333',
    name: 'Maria Santos',
    riskTier: 'HIGH',
    commPref: 'AUDIO_FIRST',
    lang: 'es',
    dob: '1952-07-14',
    condition: 'Hypertensive Crisis History',
    bp: { sysBase: 162, sysVar: 15, diaBase: 102, diaVar: 12 },
    weight: { base: 175, variance: 5 },
    medCompliance: 0.60,
    symptomFreq: 3,
    days: 90,
    crisisDays: [85, 60, 35, 12, 3],
    conversations: [
      {
        title: 'Emergency Reading',
        messages: [
          { user: 'Mi presion esta muy alta hoy, 192 sobre 125. Tengo dolor de cabeza fuerte.', ai: 'This is a critical reading. With a severe headache at these levels, please call 911 or go to the emergency room immediately. Do not wait. Your care team has been notified.', source: 'voice' },
          { user: 'I went to the ER and they gave me medication. My pressure is down to 158/98 now.', ai: 'I\'m glad you went to the ER and your BP has come down. 158/98 is still elevated but much safer than before. Please follow up with your cardiologist within the next 2-3 days. Take all prescribed medications exactly as directed.', source: 'voice' },
          { user: 'My daughter helps me take my medicine but she works during the day.', ai: 'It\'s great that your daughter helps! Consider setting up a pill organizer with morning and evening compartments. We can also set up voice reminders through this app to help you remember when she\'s not available.', source: 'voice' },
        ],
      },
      {
        title: 'Family Support',
        messages: [
          { user: 'Can my daughter see my readings too? She worries about me.', ai: 'Family involvement is wonderful for managing your health. While we don\'t have a shared dashboard yet, you can share your daily readings with her. Your care team also monitors your data and will reach out if there are concerns.', source: 'text' },
          { user: 'I don\'t always understand the English instructions on my medicine bottles.', ai: 'That\'s an important concern. Ask your pharmacist for Spanish-language labels — they\'re required to provide them. You can also use this app in Spanish by changing your language preference. Your health literacy matters and we want to make sure you understand everything.', source: 'voice' },
          { user: 'Gracias. Me siento mas segura usando esta aplicacion.', ai: 'De nada, Maria. Estamos aqui para ayudarle. Su salud es nuestra prioridad. Recuerde tomar su medicamento todos los dias y registrar su presion arterial. Si tiene alguna emergencia, llame al 911 inmediatamente.', source: 'voice' },
        ],
      },
    ],
  },
  {
    email: 'angela.thompson@healplace.com',
    otp: '444444',
    name: 'Angela Thompson',
    riskTier: 'ELEVATED',
    commPref: 'TEXT_FIRST',
    lang: 'en',
    dob: '1980-01-30',
    condition: 'Hypertension - Stage 2 (Healthcare Worker)',
    bp: { sysBase: 135, sysVar: 13, diaBase: 86, diaVar: 6 },
    weight: { base: 170, variance: 2 },
    medCompliance: 0.85,
    symptomFreq: 1,
    days: 90,
    crisisDays: [10],
    conversations: [
      {
        title: 'Shift Work & BP',
        messages: [
          { user: 'I just finished a 12-hour night shift and my BP is 148/92. Is that normal after a long shift?', ai: 'It\'s common for BP to be elevated after a demanding shift due to stress, fatigue, and disrupted sleep patterns. Rest for at least 30 minutes before measuring again. If it stays above 140/90 after rest, log it and we\'ll track the pattern.', source: 'text' },
          { user: 'As a nurse, I know I should take better care of myself but it\'s hard with back-to-back shifts.', ai: 'You\'re not alone — healthcare workers often struggle to prioritize their own health. Even small steps matter: staying hydrated during shifts, healthy snacks instead of vending machines, and consistent medication timing even on rotating schedules.', source: 'text' },
          { user: 'I\'ve been so tired lately. Could my BP medication be causing fatigue?', ai: 'Fatigue is a known side effect of several BP medications, especially beta-blockers. Track when the fatigue is worst — is it after taking the medication or after shifts? Share this pattern with your doctor so they can consider alternatives.', source: 'text' },
        ],
      },
      {
        title: 'Medication Timing',
        messages: [
          { user: 'When is the best time to take my BP meds if I work night shifts?', ai: 'Consistency matters more than the specific time. Pick a time that stays the same regardless of your shift — for example, when you wake up. If you rotate between day and night shifts, discuss a flexible dosing schedule with your doctor.', source: 'text' },
          { user: 'My BP was 126/82 today. That\'s the lowest it\'s been in weeks!', ai: 'Excellent reading, Angela! That\'s a great improvement. Were you able to rest well before measuring? Keep tracking — it helps us see what factors contribute to your better readings.', source: 'text' },
          { user: 'Yes, I had two days off in a row. I think rest really makes a difference.', ai: 'Absolutely! Your data shows a clear pattern — your BP is lower after rest days. This is valuable information for your care team. Prioritizing recovery between shifts is as important as the work itself.', source: 'voice' },
        ],
      },
    ],
  },
  {
    email: 'james.carter@healplace.com',
    otp: '555555',
    name: 'James Carter',
    riskTier: 'STANDARD',
    commPref: 'TEXT_FIRST',
    lang: 'en',
    dob: '1972-09-05',
    condition: 'Pre-Hypertension (Family History)',
    bp: { sysBase: 124, sysVar: 8, diaBase: 78, diaVar: 6 },
    weight: { base: 190, variance: 2 },
    medCompliance: 0.90,
    symptomFreq: 0,
    days: 90,
    conversations: [
      {
        title: 'Family History Questions',
        messages: [
          { user: 'My mother has severe hypertension. Am I at risk too?', ai: 'Family history is a significant risk factor for hypertension. The good news is that your current readings are in the pre-hypertension range, and lifestyle choices can make a big difference. Regular monitoring, exercise, and a healthy diet can help prevent progression.', source: 'text' },
          { user: 'I started checking her BP readings for her since she lives with me now.', ai: 'That\'s wonderful family support. If she\'d like, she could also use this app to track her own readings. Having a family member involved in care has been shown to improve health outcomes significantly.', source: 'text' },
        ],
      },
      {
        title: 'Preventive Care',
        messages: [
          { user: 'What can I do now to prevent my blood pressure from getting worse?', ai: 'Great proactive thinking! Key steps: maintain a healthy weight, exercise 30 minutes most days, limit sodium to under 2,300mg/day, eat plenty of fruits and vegetables, limit alcohol, and manage stress. Your current readings are borderline — these changes can keep them from crossing into hypertension.', source: 'text' },
          { user: 'I\'ve started walking 20 minutes every morning. My readings seem a little better.', ai: 'That\'s a great start! Even modest regular exercise like walking can lower systolic BP by 5-8 points. Your recent readings do show a slight improvement. Keep it up and consider gradually increasing duration or pace.', source: 'text' },
        ],
      },
    ],
  },
  {
    email: 'ethel.washington@healplace.com',
    otp: '666666',
    name: 'Ethel Washington',
    riskTier: 'HIGH',
    commPref: 'AUDIO_FIRST',
    lang: 'en',
    dob: '1945-12-19',
    condition: 'Hypertensive Crisis History, CHF',
    bp: { sysBase: 160, sysVar: 16, diaBase: 96, diaVar: 12 },
    weight: { base: 145, variance: 4 },
    medCompliance: 0.65,
    symptomFreq: 2,
    days: 90,
    crisisDays: [78, 45, 20, 5],
    conversations: [
      {
        title: 'Medication Confusion',
        messages: [
          { user: 'I have so many pills to take. I get confused about which ones are for my blood pressure and which are for my heart.', ai: 'I understand — managing multiple medications can be overwhelming. Ask your pharmacist about a pill organizer with separate compartments for morning and evening. You can also request a medication list card to keep in your wallet. Never stop any medication without talking to your doctor first.', source: 'voice' },
          { user: 'Sometimes I feel dizzy when I stand up and I\'m afraid I\'ll fall.', ai: 'Dizziness when standing is called orthostatic hypotension and can be related to your BP medications. Stand up slowly — sit on the edge of the bed for a minute before standing. Tell your doctor about this at your next visit. If you feel very dizzy or faint, sit down immediately.', source: 'voice' },
          { user: 'My granddaughter showed me how to use this app. She checks on me every evening.', ai: 'That\'s wonderful, Ethel! Having family support makes a real difference. Your granddaughter can help you review your readings and make sure you\'re taking your medications. We\'re also monitoring your readings and will alert your care team if anything needs attention.', source: 'voice' },
        ],
      },
      {
        title: 'Swelling Concerns',
        messages: [
          { user: 'My ankles have been swelling up more than usual the past few days.', ai: 'Increased ankle swelling can be a sign of fluid retention, which is important to monitor with your heart condition. Please weigh yourself daily — sudden weight gain of 2+ pounds overnight could indicate worsening fluid retention. Contact your doctor if the swelling gets worse or you have trouble breathing.', source: 'voice' },
          { user: 'I weighed myself and I gained 3 pounds since yesterday.', ai: 'A 3-pound weight gain overnight is concerning and could indicate fluid buildup. Please call your doctor today. They may need to adjust your diuretic medication. If you experience shortness of breath, chest pain, or difficulty lying flat, call 911 immediately.', source: 'voice' },
          { user: 'The doctor said to take an extra water pill today. I\'m feeling a little better now.', ai: 'I\'m glad your doctor responded quickly. Continue monitoring your weight daily and report any further sudden gains. Make sure to limit your fluid and salt intake as directed. Your care team is tracking your readings closely.', source: 'voice' },
        ],
      },
    ],
  },
  {
    email: 'robert.brown@healplace.com',
    otp: '777777',
    name: 'Robert Brown',
    riskTier: 'HIGH',
    commPref: 'AUDIO_FIRST',
    lang: 'en',
    dob: '1960-04-11',
    condition: 'Uncontrolled Hypertension, Post-Discharge BridgePoint',
    bp: { sysBase: 170, sysVar: 18, diaBase: 105, diaVar: 14 },
    weight: { base: 230, variance: 5 },
    medCompliance: 0.55,
    symptomFreq: 3,
    days: 90,
    crisisDays: [82, 65, 40, 22, 8, 3],
    conversations: [
      {
        title: 'Post-Discharge Follow-up',
        messages: [
          { user: 'I just got discharged from BridgePoint last week. My blood pressure is still really high.', ai: 'Welcome to the monitoring program, Robert. Post-discharge is a critical period. It\'s important to take all your medications exactly as prescribed and check your BP twice daily. Your care team at BridgePoint is being notified of your readings automatically.', source: 'voice' },
          { user: 'My reading today was 188/122. I have a bad headache and my vision is blurry.', ai: 'URGENT: Your BP is at a dangerous level and you\'re showing symptoms of hypertensive crisis. Call 911 immediately or have someone drive you to the nearest emergency room. Do NOT wait. Your care team is being notified right now.', source: 'voice' },
          { user: 'I went to the ER again. They changed my medications. I\'m on three different BP meds now.', ai: 'I\'m glad you sought emergency care. Three BP medications is common for resistant hypertension. Take each one exactly as prescribed — spacing and timing matter. Set alarms for each dose. Your follow-up appointment should be within one week.', source: 'voice' },
        ],
      },
      {
        title: 'Medication Adherence',
        messages: [
          { user: 'I keep forgetting to take my evening pills. The morning ones I remember.', ai: 'Missing evening doses is common. Try linking it to a daily routine — like dinner or brushing your teeth. You could also use a pill organizer with AM/PM sections. Consistent medication is the single most important thing for controlling your BP right now.', source: 'voice' },
          { user: 'The pharmacy said my insurance won\'t cover one of the new medications.', ai: 'Insurance coverage issues can be stressful. Ask your doctor about generic alternatives or patient assistance programs from the manufacturer. Your social worker at BridgePoint may also be able to help navigate this. Don\'t skip the medication — cost should not prevent you from taking a critical BP medication.', source: 'text' },
        ],
      },
      {
        title: 'Progress Check',
        messages: [
          { user: 'My BP has been around 165/100 the last few days. Is that better?', ai: 'It\'s an improvement from your crisis readings, but 165/100 is still significantly elevated. The goal is to get below 140/90. Continue taking all three medications consistently and we should see further improvement over the next few weeks.', source: 'voice' },
          { user: 'I cut out fast food and started eating more home-cooked meals.', ai: 'That\'s a great change, Robert! Fast food is typically very high in sodium. Home-cooking lets you control salt and fat content. Even this one change can lower your systolic BP by 5-10 points over time. Keep it up.', source: 'text' },
          { user: 'Today my reading was 155/95. Slowly coming down.', ai: 'Definite progress! Your trend over the past two weeks shows a clear downward trajectory. This confirms your medications are working and your dietary changes are helping. Stay the course — your care team is encouraged by this trend.', source: 'voice' },
        ],
      },
    ],
  },
  {
    email: 'linda.chen@healplace.com',
    otp: '888888',
    name: 'Linda Chen',
    riskTier: 'STANDARD',
    commPref: 'TEXT_FIRST',
    lang: 'en',
    dob: '1985-08-25',
    condition: 'Mild Hypertension (Healthcare Worker - Cedar Hill Nurse)',
    bp: { sysBase: 122, sysVar: 6, diaBase: 76, diaVar: 4 },
    weight: { base: 138, variance: 1 },
    medCompliance: 0.95,
    symptomFreq: 0,
    days: 90,
    conversations: [
      {
        title: 'Preventive Monitoring',
        messages: [
          { user: 'I started monitoring my BP after seeing so many patients with uncontrolled hypertension at Cedar Hill.', ai: 'That\'s a very proactive approach, Linda. As a healthcare worker, you\'re at higher risk due to stress and irregular schedules. Your current readings are excellent — keeping a daily log will help catch any changes early.', source: 'text' },
          { user: 'My readings have been consistently around 120/76. Should I keep monitoring?', ai: 'Absolutely! Consistent monitoring is valuable even with normal readings. It establishes your personal baseline so we can detect changes quickly. Given your family history risk factors and work stress, ongoing tracking is recommended.', source: 'text' },
        ],
      },
      {
        title: 'Workplace Wellness',
        messages: [
          { user: 'Some of my patients at Cedar Hill could really benefit from this app. How does the referral process work?', ai: 'Great observation! Patients can be enrolled during their discharge planning process. Your care coordinator can set them up with the app before they leave. The system then monitors their BP remotely and alerts the care team if readings are concerning.', source: 'text' },
          { user: 'I try to walk during my lunch break. Today my post-walk BP was 116/72!', ai: 'Excellent! Exercise-induced BP reduction is a great sign of cardiovascular fitness. Your post-walk reading is optimal. Regular physical activity like this is one of the most effective ways to maintain healthy blood pressure long-term.', source: 'text' },
        ],
      },
    ],
  },
]

const SEED_EMAILS = [
  'support@healplace.com',
  ...PATIENTS.map((p) => p.email),
]

// ─── Main ─────────────────────────────────────────────────────────────────────

async function main() {
  console.log('Seeding database...\n')

  // ── Cleanup existing seed data (idempotent) ──
  await prisma.otpCode.deleteMany({ where: { email: { in: SEED_EMAILS } } })
  await prisma.user.deleteMany({ where: { email: { in: SEED_EMAILS } } })
  console.log('Cleaned up existing seed data.\n')

  // ══════════════════════════════════════════════════════════════════════════
  // 1. SUPER ADMIN + PROVIDER
  // ══════════════════════════════════════════════════════════════════════════

  const superAdmin = await prisma.user.create({
    data: {
      email: 'support@healplace.com',
      name: 'Dr. Manisha Patel',
      isVerified: true,
      roles: ['SUPER_ADMIN'],
      onboardingStatus: 'COMPLETED',
      accountStatus: 'ACTIVE',
      communicationPreference: 'TEXT_FIRST',
      preferredLanguage: 'en',
      timezone: 'America/New_York',
      dateOfBirth: new Date('1978-06-15'),
      primaryCondition: 'Provider - Cardiology',
    },
  })

  const adminOtpHash = await bcrypt.hash('999999', 10)
  await prisma.otpCode.create({
    data: {
      email: 'support@healplace.com',
      codeHash: adminOtpHash,
      expiresAt: new Date('2099-12-31T23:59:59Z'),
      attempts: 0,
    },
  })
  console.log(`[admin] ${superAdmin.email} (OTP: 999999)`)

  // ══════════════════════════════════════════════════════════════════════════
  // 2. PATIENTS
  // ══════════════════════════════════════════════════════════════════════════

  for (const def of PATIENTS) {
    const user = await prisma.user.create({
      data: {
        email: def.email,
        name: def.name,
        isVerified: true,
        roles: ['REGISTERED_USER'],
        onboardingStatus: 'COMPLETED',
        accountStatus: 'ACTIVE',
        riskTier: def.riskTier,
        communicationPreference: def.commPref,
        preferredLanguage: def.lang,
        timezone: 'America/New_York',
        dateOfBirth: new Date(def.dob),
        primaryCondition: def.condition,
      },
    })

    // ── Per-patient OTP ──
    const otpHash = await bcrypt.hash(def.otp, 10)
    await prisma.otpCode.create({
      data: {
        email: def.email,
        codeHash: otpHash,
        expiresAt: new Date('2099-12-31T23:59:59Z'),
        attempts: 0,
      },
    })

    // ── Journal Entries (90 days, with multiple readings per day ~30%) ──
    const entries: { id: string; date: Date; sys: number; dia: number; weight: number; medTaken: boolean; time: string }[] = []
    const crisisSet = new Set(def.crisisDays ?? [])

    for (let i = def.days; i >= 1; i--) {
      const entryDate = dateOnly(daysAgo(i))

      // ~30% of non-crisis days get a second (evening) reading
      const periods: string[] = ['08:00']
      if (!crisisSet.has(i) && Math.random() < 0.3) {
        periods.push('19:00')
      }

      for (const measurementTime of periods) {
        let sys: number, dia: number

        if (crisisSet.has(i)) {
          // Forced crisis reading
          sys = rand(185, 200)
          dia = rand(120, 135)
        } else {
          // Normal with optional trend
          const dayProgress = (def.days - i) / def.days
          const trendedSysBase = def.bp.sysBase + (def.bp.trendRise ?? 0) * dayProgress
          sys = Math.round(trendedSysBase) + rand(-def.bp.sysVar, def.bp.sysVar)
          dia = def.bp.diaBase + rand(-def.bp.diaVar, def.bp.diaVar)

          // Evening readings tend to be slightly lower
          if (measurementTime === '19:00') {
            sys = Math.max(90, sys - rand(2, 6))
            dia = Math.max(55, dia - rand(1, 4))
          }
        }

        const weight = def.weight.base + rand(-def.weight.variance, def.weight.variance)
        const medTaken = Math.random() < def.medCompliance
        const symptoms = crisisSet.has(i)
          ? ['Severe Headache', 'Chest Pain', 'Blurred Vision'].slice(0, rand(2, 3))
          : randomSymptoms(def.symptomFreq)

        const entry = await prisma.journalEntry.create({
          data: {
            userId: user.id,
            entryDate,
            measurementTime,
            systolicBP: sys,
            diastolicBP: dia,
            weight,
            medicationTaken: medTaken,
            missedDoses: medTaken ? 0 : rand(1, 2),
            symptoms,
            notes: symptoms.length > 0 ? `Patient reported: ${symptoms.join(', ')}` : null,
            source: 'MANUAL',
          },
        })
        entries.push({ id: entry.id, date: entryDate, sys, dia, weight, medTaken, time: measurementTime })
      }
    }

    // ── Baseline Snapshots (every 7 days) ──
    let snapshotCount = 0
    for (let i = 6; i < entries.length; i += 7) {
      const window = entries.slice(Math.max(0, i - 6), i + 1)
      const avgSys = window.reduce((s, e) => s + e.sys, 0) / window.length
      const avgDia = window.reduce((s, e) => s + e.dia, 0) / window.length
      const avgWeight = window.reduce((s, e) => s + e.weight, 0) / window.length

      const snapshot = await prisma.baselineSnapshot.create({
        data: {
          userId: user.id,
          computedForDate: entries[i].date,
          baselineSystolic: Math.round(avgSys * 100) / 100,
          baselineDiastolic: Math.round(avgDia * 100) / 100,
          baselineWeight: Math.round(avgWeight * 100) / 100,
          sampleSize: window.length,
        },
      })

      const entryIds = window.map((e) => e.id)
      await prisma.journalEntry.updateMany({
        where: { id: { in: entryIds } },
        data: { snapshotId: snapshot.id },
      })
      snapshotCount++
    }

    // ── Deviation Alerts ──
    const alertEntries = entries.filter(
      (e) => e.sys >= 140 || e.dia >= 90 || !e.medTaken,
    )

    const createdAlerts: { id: string; severity: string; entryDate: Date }[] = []

    for (const ae of alertEntries) {
      const isCrisis = ae.sys >= 180 || ae.dia >= 120
      const isElevated = ae.sys >= 140 || ae.dia >= 90
      const severity = isCrisis ? 'HIGH' : isElevated ? 'MEDIUM' : 'LOW'

      let devType: 'SYSTOLIC_BP' | 'DIASTOLIC_BP' | 'MEDICATION_ADHERENCE' = 'SYSTOLIC_BP'
      let magnitude = Math.abs(ae.sys - def.bp.sysBase)
      let baselineVal = def.bp.sysBase
      let actualVal = ae.sys

      if (!ae.medTaken && ae.sys < 140 && ae.dia < 90) {
        devType = 'MEDICATION_ADHERENCE'
        magnitude = 1
        baselineVal = 1
        actualVal = 0
      } else if (ae.dia >= 90 && (ae.dia - def.bp.diaBase) > (ae.sys - def.bp.sysBase)) {
        devType = 'DIASTOLIC_BP'
        magnitude = Math.abs(ae.dia - def.bp.diaBase)
        baselineVal = def.bp.diaBase
        actualVal = ae.dia
      }

      const statusOptions: ('OPEN' | 'ACKNOWLEDGED' | 'RESOLVED')[] =
        severity === 'HIGH' ? ['OPEN', 'ACKNOWLEDGED'] : ['OPEN', 'ACKNOWLEDGED', 'RESOLVED']

      try {
        const alert = await prisma.deviationAlert.create({
          data: {
            userId: user.id,
            journalEntryId: ae.id,
            type: devType,
            severity: severity as 'LOW' | 'MEDIUM' | 'HIGH',
            magnitude,
            baselineValue: baselineVal,
            actualValue: actualVal,
            escalated: severity === 'HIGH',
            status: pick(statusOptions),
            acknowledgedAt: severity !== 'HIGH' ? daysAgo(rand(0, 3)) : null,
          },
        })
        createdAlerts.push({ id: alert.id, severity, entryDate: ae.date })
      } catch {
        // Skip duplicate (journalEntryId + type unique constraint)
      }
    }

    // ── Escalation Events ──
    const highAlerts = createdAlerts.filter((a) => a.severity === 'HIGH')
    let escalationCount = 0

    for (let i = 0; i < highAlerts.length && i < 4; i++) {
      await prisma.escalationEvent.create({
        data: {
          alertId: highAlerts[i].id,
          userId: user.id,
          escalationLevel: i < 2 ? 'LEVEL_2' : 'LEVEL_1',
          reason: i < 2
            ? 'Crisis-level BP reading detected. Immediate intervention required. 911 protocol initiated.'
            : 'Elevated BP persists beyond threshold. Care team notification sent.',
          notificationSentAt: new Date(),
        },
      })
      escalationCount++
    }

    // ── Notifications ──
    let notifCount = 0
    for (const alert of createdAlerts.slice(0, 6)) {
      await prisma.notification.create({
        data: {
          userId: user.id,
          alertId: alert.id,
          channel: pick(['PUSH', 'EMAIL'] as const),
          title: alert.severity === 'HIGH'
            ? 'Urgent: Critical Blood Pressure Reading'
            : 'Blood Pressure Alert',
          body: alert.severity === 'HIGH'
            ? 'Your blood pressure reading requires immediate attention. Please contact your care team or call 911.'
            : 'Your recent blood pressure reading was above your baseline. Please continue monitoring and take your medication.',
          tips: [
            'Take your medication as prescribed',
            'Reduce sodium intake to under 2,300mg/day',
            'Stay hydrated and avoid caffeine',
            'Practice deep breathing for 5 minutes',
          ],
          readAt: Math.random() > 0.5 ? daysAgo(rand(0, 2)) : null,
        },
      })
      notifCount++
    }

    // ── Scheduled Calls ──
    const callDefs = [
      { status: 'UPCOMING' as const, offset: -3, type: 'Follow-up', note: 'Scheduled follow-up for elevated BP readings.' },
      { status: 'UPCOMING' as const, offset: -7, type: 'Care Plan Review', note: 'Review medication effectiveness and lifestyle changes.' },
      { status: 'COMPLETED' as const, offset: 5, type: 'Check-in', note: 'Patient confirmed medication adherence. BP trending down.' },
      { status: 'MISSED' as const, offset: 10, type: 'Follow-up', note: 'Patient did not answer. Rescheduling required.' },
    ]

    let callCount = 0
    for (const cd of callDefs.slice(0, Math.min(3, createdAlerts.length))) {
      await prisma.scheduledCall.create({
        data: {
          userId: user.id,
          alertId: createdAlerts[callCount]?.id ?? null,
          callDate: daysAgo(cd.offset).toISOString().split('T')[0],
          callTime: pick(['09:00', '10:30', '14:00', '15:30']),
          callType: cd.type,
          notes: cd.note,
          status: cd.status,
        },
      })
      callCount++
    }

    // ── Chat Conversations (patient-specific) ──
    let totalMessages = 0
    for (const convo of def.conversations) {
      const session = await prisma.session.create({
        data: {
          userId: user.id,
          title: convo.title,
          messageCount: convo.messages.length,
        },
      })

      for (let j = 0; j < convo.messages.length; j++) {
        const msg = convo.messages[j]
        await prisma.conversation.create({
          data: {
            sessionId: session.id,
            userMessage: msg.user,
            aiSummary: msg.ai,
            source: msg.source,
            timestamp: daysAgo(def.days - j * 5 - rand(0, 3)),
          },
        })
        totalMessages++
      }
    }

    const highCount = createdAlerts.filter((a) => a.severity === 'HIGH').length
    const medCount = createdAlerts.filter((a) => a.severity === 'MEDIUM').length
    console.log(
      `[${def.riskTier.padEnd(8)}] ${def.name.padEnd(20)} | ${entries.length} entries | ${highCount}H/${medCount}M alerts | ${escalationCount} escalations | ${totalMessages} messages | OTP: ${def.otp}`,
    )
  }

  // ── Print credentials ──
  console.log('\n' + '═'.repeat(60))
  console.log('  DEMO CREDENTIALS')
  console.log('═'.repeat(60))
  console.log('  Email'.padEnd(42) + 'OTP')
  console.log('─'.repeat(60))
  console.log('  support@healplace.com'.padEnd(42) + '999999  (Provider)')
  for (const p of PATIENTS) {
    console.log(`  ${p.email.padEnd(40)} ${p.otp}`)
  }
  console.log('═'.repeat(60))
  console.log('\nSeed completed successfully!')
}

main()
  .catch((e) => {
    console.error('Seed failed:', e)
    process.exit(1)
  })
  .finally(() => prisma.$disconnect())
