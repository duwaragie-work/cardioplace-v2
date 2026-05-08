/**
 * Single source of truth for every data-testid the suite asserts against.
 *
 * Conventions:
 *   - kebab-case
 *   - prefix by surface (dashboard-*, checkin-*, readings-*, etc.)
 *   - parameterized testids return functions: medication(id)
 *
 * If you add a new testid here, also add it to the matching React component
 * in /frontend or /admin. The CI lint step does NOT check this — it's a
 * convention to keep in your head.
 */

export const T = {
  // ─── Patient: sign-in ───────────────────────────────────────────────────
  signIn: {
    emailInput: 'signin-email-input',
    sendOtpBtn: 'signin-send-otp-btn',
    otpInput: 'signin-otp-input',
    verifyBtn: 'signin-verify-btn',
    magicLinkBtn: 'signin-magic-link-btn',
    otpTab: 'signin-otp-tab',
    magicTab: 'signin-magic-tab',
    statusMsg: 'signin-status',
    errorMsg: 'signin-error',
  },

  // ─── Patient: onboarding ────────────────────────────────────────────────
  onboarding: {
    nameInput: 'onboarding-name-input',
    dobInput: 'onboarding-dob-input',
    timezoneSelect: 'onboarding-timezone-select',
    submitBtn: 'onboarding-submit-btn',
    skipBtn: 'onboarding-skip-btn',
  },

  // ─── Patient: clinical intake (A1–A9) ───────────────────────────────────
  intake: {
    step: (n: number) => `intake-step-${n}`,
    next: 'intake-next-btn',
    back: 'intake-back-btn',
    submit: 'intake-submit-btn',
    // A1: gender + height + DOB
    genderRadio: (v: 'MALE' | 'FEMALE' | 'OTHER') => `intake-gender-${v.toLowerCase()}`,
    heightFt: 'intake-height-ft',
    heightIn: 'intake-height-in',
    heightCm: 'intake-height-cm',
    heightUnitToggle: 'intake-height-unit-toggle',
    // A2: pregnancy / preeclampsia
    isPregnantYes: 'intake-pregnant-yes',
    isPregnantNo: 'intake-pregnant-no',
    historyPreeclampsiaYes: 'intake-preeclampsia-yes',
    historyPreeclampsiaNo: 'intake-preeclampsia-no',
    // A3: cardiac conditions
    conditionCheckbox: (
      key:
        | 'hasHeartFailure'
        | 'hasCAD'
        | 'hasHCM'
        | 'hasDCM'
        | 'hasAFib'
        | 'hasTachycardia'
        | 'hasBradycardia'
        | 'diagnosedHypertension',
    ) => `intake-condition-${key}`,
    hfTypeRadio: (v: 'HFREF' | 'HFPEF' | 'UNKNOWN') => `intake-hf-type-${v.toLowerCase()}`,
    // A5–A8: medications visual cards
    medCard: (drugClassOrName: string) => `intake-med-card-${drugClassOrName}`,
    medCardYes: (drugClassOrName: string) => `intake-med-card-${drugClassOrName}-yes`,
    medCardNo: (drugClassOrName: string) => `intake-med-card-${drugClassOrName}-no`,
    medFreqOnce: (id: string) => `intake-med-${id}-freq-once`,
    medFreqTwice: (id: string) => `intake-med-${id}-freq-twice`,
    medListItem: (id: string) => `intake-med-list-item-${id}`,
    medListEdit: (id: string) => `intake-med-list-edit-${id}`,
    medListDelete: (id: string) => `intake-med-list-delete-${id}`,
  },

  // ─── Patient: dashboard ─────────────────────────────────────────────────
  dashboard: {
    greeting: 'dashboard-greeting',
    awaitingVerificationBadge: 'awaiting-verification-badge',
    activeAlertBanner: 'active-alert-banner',
    activeAlertReading: 'active-alert-reading',
    activeAlertTier: 'active-alert-tier',
    activeAlertCta: 'active-alert-cta',
    latestBp: 'latest-bp',
    latestBpStatus: 'latest-bp-status',
    medicationStreak: 'medication-streak',
    totalCheckins: 'total-checkins',
    bpGoal: 'bp-goal',
    bpChart: 'bp-chart',
    bpChartXTick: 'bp-chart-x-tick',
    bpChartRangeToggle: (range: '7d' | '30d' | '90d') => `bp-chart-range-${range}`,
    recentAlerts: 'recent-alerts',
    recentAlertRow: (i: number) => `recent-alert-row-${i}`,
    startCheckinCta: 'start-checkin-cta',
    hearSummaryCta: 'hear-summary-cta',
    notificationBell: 'notification-bell',
    notificationBellBadge: 'notification-bell-badge',
  },

  // ─── Patient: check-in ──────────────────────────────────────────────────
  checkin: {
    step: (n: 1 | 2 | 3 | 4 | 5) => `checkin-step-${n}`,
    checklistItem: (key: string) => `checkin-checklist-${key}`,
    systolic: 'checkin-systolic',
    diastolic: 'checkin-diastolic',
    pulse: 'checkin-pulse',
    positionSelect: 'checkin-position',
    sessionId: 'checkin-session-id',
    symptom: (key: string) => `checkin-symptom-${key}`,
    otherSymptoms: 'checkin-other-symptoms',
    measurementCondition: (key: string) => `checkin-measurement-${key}`,
    next: 'checkin-next-btn',
    back: 'checkin-back-btn',
    submit: 'checkin-submit-btn',
    success: 'checkin-success',
    summary: 'checkin-summary',
  },

  // ─── Patient: readings ──────────────────────────────────────────────────
  readings: {
    list: 'readings-list',
    group: 'reading-group',
    groupDate: 'reading-group-date',
    groupCount: 'reading-group-count',
    row: 'reading-row',
    rowDate: 'reading-row-date',
    rowBp: 'reading-row-bp',
    rowPulse: 'reading-row-pulse',
    rowEdit: (id: string) => `reading-row-edit-${id}`,
    rowDelete: (id: string) => `reading-row-delete-${id}`,
    rowSpeaker: (id: string) => `reading-row-speaker-${id}`,
    newCheckinCta: 'new-checkin-cta',
  },

  // ─── Patient: notifications ─────────────────────────────────────────────
  notifications: {
    tabAlerts: 'notifications-tab-alerts',
    tabNotifications: 'notifications-tab-notifications',
    sectionEmergency: 'alerts-section-emergency',
    sectionElevated: 'alerts-section-elevated',
    sectionPast: 'alerts-section-past',
    alertCard: (id: string) => `alert-card-${id}`,
    alertCardTier: (id: string) => `alert-card-tier-${id}`,
    alertCardBody: (id: string) => `alert-card-body-${id}`,
    alertAckCta: (id: string) => `alert-ack-${id}`,
    alertViewDetailsCta: (id: string) => `alert-view-details-${id}`,
    notificationCard: 'notification-card',
    notificationDate: 'notification-date',
    notificationTapMark: 'notification-tap-to-mark',
    markAllRead: 'notifications-mark-all-read',
  },

  // ─── Patient: chat ──────────────────────────────────────────────────────
  chat: {
    sidebar: 'chat-sidebar',
    conversation: (i: number) => `chat-conversation-${i}`,
    emptyState: 'chat-empty-state',
    suggestedPrompt: (i: number) => `chat-suggested-prompt-${i}`,
    input: 'chat-input',
    micBtn: 'chat-mic-btn',
    sendBtn: 'chat-send-btn',
    assistantMessage: 'assistant-message',
    userMessage: 'user-message',
  },

  // ─── Patient: profile ───────────────────────────────────────────────────
  profile: {
    name: 'profile-name',
    email: 'profile-email',
    verifiedBadge: 'profile-verified-badge',
    signOut: 'profile-signout',
    careTeamPractice: 'care-team-practice',
    careTeamPrimary: 'care-team-primary',
    careTeamBackup: 'care-team-backup',
    careTeamMd: 'care-team-md',
    section: (key: 'personal' | 'about' | 'pregnancy' | 'conditions' | 'medications') =>
      `profile-section-${key}`,
    sectionEdit: (key: string) => `profile-section-edit-${key}`,
    medicationRow: (id: string) => `medication-row-${id}`,
    medicationStatus: (id: string) => `medication-status-${id}`,
  },

  // ─── Admin: shared ──────────────────────────────────────────────────────
  admin: {
    signInEmail: 'admin-signin-email',
    signInSendOtp: 'admin-signin-send-otp',
    signInOtp: 'admin-signin-otp',
    signInVerify: 'admin-signin-verify',
    signInError: 'admin-signin-error',

    dashboardAlertsRed: 'admin-dashboard-alerts-red',
    dashboardAlertsYellow: 'admin-dashboard-alerts-yellow',
    dashboardAlertsGreen: 'admin-dashboard-alerts-green',

    patientListSearch: 'admin-patient-list-search',
    patientListRow: (userId: string) => `admin-patient-row-${userId}`,
    patientListAwaitingFilter: 'admin-patient-list-awaiting-filter',

    detailHeader: 'admin-patient-detail-header',
    detailTab: (key: 'profile' | 'medications' | 'thresholds' | 'alerts' | 'readings' | 'timeline' | 'care-team') =>
      `admin-tab-${key}`,

    profileField: (key: string) => `admin-profile-field-${key}`,
    profileFieldConfirm: (key: string) => `admin-profile-field-confirm-${key}`,
    profileFieldCorrect: (key: string) => `admin-profile-field-correct-${key}`,
    profileFieldReject: (key: string) => `admin-profile-field-reject-${key}`,
    profileVerifyComplete: 'admin-profile-verify-complete',
    profileRejectionRationale: 'admin-profile-rejection-rationale',

    medRow: (id: string) => `admin-med-row-${id}`,
    medVerify: (id: string) => `admin-med-verify-${id}`,
    medReject: (id: string) => `admin-med-reject-${id}`,
    medRejectionRationale: 'admin-med-rejection-rationale',
    medRejectionConfirm: 'admin-med-rejection-confirm',

    thresholdSbpUpper: 'admin-threshold-sbp-upper',
    thresholdSbpLower: 'admin-threshold-sbp-lower',
    thresholdDbpUpper: 'admin-threshold-dbp-upper',
    thresholdDbpLower: 'admin-threshold-dbp-lower',
    thresholdNotes: 'admin-threshold-notes',
    thresholdSave: 'admin-threshold-save',

    enrollmentCard: 'admin-enrollment-card',
    enrollmentCheckBtn: 'admin-enrollment-check-btn',
    enrollmentCompleteBtn: 'admin-enrollment-complete-btn',
    enrollmentReason: (reason: string) => `admin-enrollment-reason-${reason}`,

    practiceCreate: 'admin-practice-create',
    practiceName: 'admin-practice-name',
    practiceHoursStart: 'admin-practice-hours-start',
    practiceHoursEnd: 'admin-practice-hours-end',
    practiceTz: 'admin-practice-tz',
    practiceSave: 'admin-practice-save',

    assignmentPracticeSelect: 'admin-assignment-practice',
    assignmentPrimary: 'admin-assignment-primary',
    assignmentBackup: 'admin-assignment-backup',
    assignmentMd: 'admin-assignment-md',
    assignmentSave: 'admin-assignment-save',

    alertCard: (id: string) => `admin-alert-card-${id}`,
    alertTier: (id: string) => `admin-alert-tier-${id}`,
    alertRuleId: (id: string) => `admin-alert-rule-${id}`,
    alertPatientMsg: (id: string) => `admin-alert-patient-msg-${id}`,
    alertPhysicianMsg: (id: string) => `admin-alert-physician-msg-${id}`,
    alertAckBtn: (id: string) => `admin-alert-ack-${id}`,
    alertResolveAction: 'admin-alert-resolve-action',
    alertResolveRationale: 'admin-alert-resolve-rationale',
    alertResolveBtn: 'admin-alert-resolve-btn',
    alertAuditField: (i: number) => `admin-alert-audit-field-${i}`,
  },
} as const

export type TestId = string

/** Helper: convert a testid string to a Playwright locator selector. */
export function byTestId(id: TestId): string {
  return `[data-testid="${id}"]`
}
