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
    // Phase 4 §B.4 — the real sticky CTA that drives goNext()/submit, plus
    // the catalog-card condition testids the wizard actually renders
    // (token-keyed, NOT the aspirational hasX form above).
    cta: 'intake-submit',
    conditionCard: (
      key: 'HEART_FAILURE' | 'CAD' | 'HCM' | 'AFIB' | 'BRADYCARDIA',
    ) => `intake-condition-${key}`,
    genderCard: (v: 'male' | 'female' | 'non_binary') => `intake-gender-${v}`,
    pregnancyYes: 'intake-pregnancy-yes',
    pregnancyNo: 'intake-pregnancy-no',
    medAddBtn: 'intake-medication-add-button',
    medSaveBtn: 'intake-medication-save-button',
    medDeleteBtn: 'intake-medication-delete-button',
    medPhotoButton: 'intake-medication-photo-button',
    // Phase 4b — MedicationPhotoConfirmModal. The "Add all" button is gated
    // until each kept row resolves to a real write (a new med, or an
    // already-listed med whose non-UNSURE frequency differs). Tests pick a
    // per-row frequency via the native <select> before confirming.
    medPhotoConfirmModal: 'medication-photo-confirm-modal',
    medPhotoConfirmButton: 'medication-photo-confirm-button',
    medPhotoRow: (i: number) => `medication-photo-row-${i}`,
    medPhotoRowFrequency: (i: number) => `medication-photo-row-frequency-${i}`,
    // Phase 4b — A9 per-medication frequency picker (index-keyed; each med
    // is a row of 5 frequency buttons). The A9 gate blocks submit until
    // every selected med has a frequency, so a freeform/OCR add that lands
    // without one must be answered here before A10.
    a9Row: (i: number) => `intake-a9-row-${i}`,
    a9Freq: (
      i: number,
      freq:
        | 'ONCE_DAILY'
        | 'TWICE_DAILY'
        | 'THREE_TIMES_DAILY'
        | 'AS_NEEDED'
        | 'UNSURE',
    ) => `intake-a9-freq-${i}-${freq}`,
    // Phase 4 v3.1 — A8 medication-catalog category tiles (the OTHER tile
    // opens the free-text/photo sub-panel) + the A8 free-text input.
    catTile: (
      key:
        | 'WATER_PILL'
        | 'BLOOD_THINNER'
        | 'CHOLESTEROL'
        | 'HEART_RHYTHM'
        | 'SGLT2'
        | 'OTHER',
    ) => `intake-cat-tile-${key}`,
    otherMedInput: 'intake-other-med-input',
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
    // Phase 4 §B.4 — MonthlyMedReask modal rendered over the dashboard.
    monthlyMedReask: 'dashboard-monthly-med-reask',
  },

  // ─── Patient: alert detail / emergency (Phase 4 §B.4) ────────────────────
  alertDetail: {
    tierBadge: 'alert-detail-tier-badge',
    statusBadge: 'alert-status-badge',
    // Patient frontend renders ONLY the patient-tier message — caregiver /
    // physician tiers are admin-facing in v2 (see §B report anomaly).
    messagePatient: 'alert-message-patient',
    messageCaregiver: 'alert-message-caregiver',
    messagePhysician: 'alert-message-physician',
    acknowledgeBtn: 'alert-acknowledge-button',
    resolvedBy: 'alert-resolved-by',
  },
  emergency: {
    screen: 'emergency-screen',
    message: 'emergency-screen-message',
    call911: 'emergency-call-911-button',
  },

  // ─── Patient: language selector (Phase 4 §B.4) ───────────────────────────
  language: {
    button: 'language-selector-button',
    option: (code: 'en' | 'es' | 'am' | 'fr' | 'de') =>
      `language-selector-option-${code}`,
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
    // CheckIn.tsx renders the actual data-testid as `check-in-symptom-${KEY}`
    // (hyphenated, KEY is the SCREAMING_SNAKE form). qa/helpers/api.ts:300
    // already references it that way. Keep the helper aligned with reality —
    // pass the SCREAMING_SNAKE key (FACE_SWELLING, THROAT_TIGHTNESS, FATIGUE,
    // SHORTNESS_OF_BREATH, DRY_COUGH, etc.).
    symptom: (key: string) => `check-in-symptom-${key}`,
    otherSymptoms: 'checkin-other-symptoms',
    measurementCondition: (key: string) => `checkin-measurement-${key}`,
    next: 'checkin-next-btn',
    back: 'checkin-back-btn',
    submit: 'checkin-submit-btn',
    success: 'checkin-success',
    summary: 'checkin-summary',
    // Phase 4 §B.4 — BP-photo OCR entry + two-reading session prompt.
    bpPhotoButton: 'check-in-bp-photo-button',
    medicationYes: 'check-in-medication-yes',
    medicationNo: 'check-in-medication-no',
    pendingSecondReading: 'pending-second-reading',
    addSecondReading: 'add-second-reading',
    // Cross-visit "add to this session or start new?" prompt.
    openSessionPrompt: 'checkin-open-session-prompt',
    openSessionNeedsMore: 'checkin-open-session-needs-more',
    joinSession: 'checkin-join-session-btn',
    newSession: 'checkin-new-session-btn',
    resumePrompt: 'checkin-resume-prompt',
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

  // ─── Patient: voice chat (Phase 4 v3.1 §B) ──────────────────────────────
  // Voice is hosted INLINE in AIChatInterface via useVoiceSession (socket.io
  // transport, namespace /voice). The standalone VoiceChat.tsx is legacy/
  // unused on /chat. Mic toggle enters voice; the voice-active bar shows
  // session state; transcript renders as chat-message-{ai,patient} bubbles.
  voice: {
    micButton: 'voice-mic-button',
    activeBar: 'voice-active-bar',
    stateLabel: 'voice-state-label',
    endButton: 'voice-end-button',
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

  // ─── Admin (Phase 3) ────────────────────────────────────────────────────
  //
  // Reconciled against the REAL admin DOM (Phase 3 §B audit), NOT the Phase 3
  // doc's idealised names. Notable reality deltas baked in here (see §B
  // report / RESULTS.md Phase 3 anomalies):
  //   • Dashboard is stat-cards + tier-filter chips + a flat queue — there is
  //     NO 3-layer red/yellow/green panel. Tier 3 is excluded from it.
  //   • The 3-tier (patient/caregiver/physician) message cards live in the
  //     EXPANDED AlertCard, NOT in AlertResolutionModal (modal shows only the
  //     patient-facing message + the resolution-action catalog).
  //   • Patient-detail tab key is `careteam` (one word), matching TabKey.
  //   • Patient list has risk-tier + awaiting-verification filters, NOT an
  //     ENROLLED/NOT_ENROLLED/SUSPENDED status filter.
  //   • Medication HOLD collects its rationale via window.prompt (not a
  //     modal); REJECT uses MedicationRejectModal.
  //   • CareTeam reassignment is an inline <select> editor, not a modal.
  //   • Escalation rungs are keyed by ladder CODE (T0/T4H/T8H/T24H/T48H/
  //     T2H/T72H/T7D/TIER2_48H/TIER2_7D/TIER2_14D), not the "T+0" label.
  //   • The 15-field audit footer renders ~17 `audit-field-<key>` rows with
  //     keys: alertId,tier,ruleId,severity,mode,status,created,acknowledged,
  //     acknowledgedBy,resolved,resolvedBy,resolutionAction,reading,
  //     pulsePressure,bmi,triggeringValue,escalationCount (+ resolutionRationale).
  admin: {
    // Sign-in (already wired pre-Phase-3 — names locked, used by auth.ts)
    signInEmail: 'admin-signin-email',
    signInSendOtp: 'admin-signin-send-otp',
    signInOtp: 'admin-signin-otp',
    signInVerify: 'admin-signin-verify',
    signInError: 'admin-signin-error',

    // Shared shell
    notificationBell: 'admin-notification-bell',
    notificationBellCount: 'admin-notification-bell-count',

    // Dashboard (AdminDashboard.tsx) — triage queue, NOT a 3-layer panel
    dashboardStat: (
      key: 'total-patients' | 'bp-l2' | 'tier-1' | 'tier-2' | 'attention',
    ) => `admin-dashboard-stat-${key}`,
    dashboardTierFilter: (
      key: 'ALL' | 'BP_L2' | 'TIER_1' | 'TIER_2' | 'BP_L1',
    ) => `admin-dashboard-tier-filter-${key}`,
    dashboardSearch: 'admin-dashboard-search',
    dashboardQueue: 'admin-dashboard-queue',
    dashboardQueueEmpty: 'admin-dashboard-queue-empty',
    dashboardAlertRow: (alertId: string) => `admin-dashboard-alert-row-${alertId}`,
    dashboardAlertOpen: (alertId: string) => `admin-dashboard-alert-open-${alertId}`,

    // Patient list (/patients)
    patientListSearch: 'admin-patient-search-input',
    patientRiskFilter: 'admin-patient-risk-filter',
    patientAwaitingFilter: 'admin-patient-awaiting-filter',
    patientListRow: (userId: string) => `admin-patient-list-row-${userId}`,
    patientListEmpty: 'admin-patient-list-empty',
    patientListAccessDenied: 'admin-access-denied',

    // Patient-detail shell
    detailHeader: 'admin-patient-detail-header',
    patientName: 'admin-patient-name',
    verificationBadge: 'admin-patient-verification-badge',
    detailTab: (
      key:
        | 'profile'
        | 'medications'
        | 'alerts'
        | 'readings'
        | 'thresholds'
        | 'careteam'
        | 'timeline',
    ) => `admin-tab-${key}`,

    // ProfileTab
    profileStatusBanner: 'admin-profile-status-banner',
    profileField: (key: string) => `admin-profile-field-${key}`,
    profileConfirm: (key: string) => `admin-profile-confirm-${key}`,
    profileCorrect: (key: string) => `admin-profile-correct-${key}`,
    profileReject: (key: string) => `admin-profile-reject-${key}`,
    profileEditInput: (key: string) => `admin-profile-edit-input-${key}`,
    profileEditSave: (key: string) => `admin-profile-edit-save-${key}`,
    profileVerifyComplete: 'admin-profile-verify-complete',
    profileVerifyRationale: 'admin-profile-verify-rationale',
    profileVerifyConfirm: 'admin-profile-verify-confirm',
    // Cluster 8.1 Gap 3 — persistent CAD treatment-target note rendered on
    // the cardiac section of ProfileTab whenever profile.hasCAD. Documents
    // the AHA/ACC 130/80 target + the Q2-ramp default thresholds the
    // engine alerts on.
    profileCadTreatmentNote: 'admin-profile-cad-treatment-note',

    // MedicationsTab (cards keyed by med.id; tests filter by visible drugName)
    medGroup: (drugClass: string) => `admin-med-group-${drugClass}`,
    medCard: (medId: string) => `admin-med-card-${medId}`,
    medStatus: (medId: string) => `admin-med-status-${medId}`,
    medVerify: (medId: string) => `admin-med-verify-${medId}`,
    medReject: (medId: string) => `admin-med-reject-${medId}`,
    medHold: (medId: string) => `admin-med-hold-${medId}`,
    medEmpty: 'admin-med-empty',
    // MedicationRejectModal
    medRejectModal: 'admin-med-reject-modal',
    medRejectQuickPick: (key: string) => `admin-med-reject-pick-${key}`,
    medRejectRationale: 'admin-med-reject-rationale',
    medRejectConfirm: 'admin-med-reject-confirm',

    // ThresholdsTab
    thresholdReadonlyBanner: 'admin-threshold-readonly',
    thresholdSbpUpper: 'admin-threshold-sbp-upper',
    thresholdSbpLower: 'admin-threshold-sbp-lower',
    thresholdDbpUpper: 'admin-threshold-dbp-upper',
    thresholdDbpLower: 'admin-threshold-dbp-lower',
    thresholdHrUpper: 'admin-threshold-hr-upper',
    thresholdHrLower: 'admin-threshold-hr-lower',
    thresholdNotes: 'admin-threshold-notes',
    thresholdSave: 'admin-threshold-save',

    // CareTeamTab (inline <select> editor, NOT a modal)
    careTeamStatus: 'admin-careteam-status',
    careTeamPracticeSelect: 'admin-careteam-practice-select',
    careTeamPrimarySelect: 'admin-careteam-primary-select',
    careTeamBackupSelect: 'admin-careteam-backup-select',
    careTeamMdSelect: 'admin-careteam-md-select',
    careTeamSave: 'admin-careteam-save',
    careTeamReadonly: 'admin-careteam-readonly',
    careTeamCurrent: (role: 'primary' | 'backup' | 'md' | 'practice') =>
      `admin-careteam-current-${role}`,
    // May 2026 role-scope refactor — inline validation banners.
    // Red: hard collision (backend rejects, Save disabled).
    // Amber: soft warning (Save still enabled — small-practice realism).
    careTeamPrimaryBackupCollision: 'admin-careteam-primary-backup-collision',
    careTeamMdCollision: 'admin-careteam-md-provider-collision',

    // EnrollmentCard (no unenroll affordance — Category C, see report)
    enrollmentCard: 'admin-enrollment-card',
    enrollmentStatus: 'admin-enrollment-status',
    enrollmentEnrollBtn: 'admin-enrollment-enroll-button',

    // ReadingsTab (cards, NOT a table)
    readingsList: 'admin-readings-list',
    readingsCard: (entryId: string) => `admin-readings-card-${entryId}`,
    readingsDateFilter: (key: 'ALL' | '7D' | '30D' | '90D') =>
      `admin-readings-date-filter-${key}`,
    readingsTierFilter: (
      key: 'ALL' | 'BP_L2' | 'TIER_1' | 'TIER_2' | 'BP_L1' | 'TIER_3',
    ) => `admin-readings-tier-filter-${key}`,
    readingsEmpty: 'admin-readings-empty',
    // Cluster 8.1 Gap 5 — yellow-dot surveillance pill rendered on a reading
    // whose deviation is RULE_BRADY_SURVEILLANCE (physician-only chart event,
    // no patient-facing alarm). Surfaced on ReadingsTab.tsx.
    readingsBradySurveillancePill: 'admin-readings-brady-surveillance-pill',

    // TimelineTab
    timelineList: 'admin-timeline-list',
    timelineEntry: (id: string) => `admin-timeline-entry-${id}`,
    timelineFilter: (key: 'ALL' | 'PROFILE' | 'MEDICATION' | 'ALERT') =>
      `admin-timeline-filter-${key}`,
    timelineEmpty: 'admin-timeline-empty',

    // AlertsTab + shared AlertCard
    alertsStatusFilter: (
      key: 'OPEN' | 'ACKNOWLEDGED' | 'RESOLVED' | 'ALL',
    ) => `admin-alerts-status-filter-${key}`,
    alertsTierFilter: (
      key: 'ALL' | 'BP_L2' | 'TIER_1' | 'TIER_2' | 'BP_L1',
    ) => `admin-alerts-tier-filter-${key}`,
    alertsEmpty: 'admin-alerts-empty',
    alertCard: (id: string) => `admin-alert-card-${id}`,
    alertRow: (id: string) => `admin-alert-row-${id}`,
    alertTierBadge: (id: string) => `admin-alert-tier-badge-${id}`,
    alertStatusBadge: (id: string) => `admin-alert-status-badge-${id}`,
    alertAckBtn: (id: string) => `admin-alert-ack-button-${id}`,
    alertResolveBtnFor: (id: string) => `admin-alert-resolve-button-${id}`,
    alertExpand: (id: string) => `admin-alert-expand-${id}`,
    alertMsgPatient: (id: string) => `admin-alert-msg-patient-${id}`,
    alertMsgCaregiver: (id: string) => `admin-alert-msg-caregiver-${id}`,
    alertMsgPhysician: (id: string) => `admin-alert-msg-physician-${id}`,

    // AlertResolutionModal (patient-facing message + action catalog only)
    resolveModal: 'admin-resolve-modal',
    resolvePatientMessage: 'admin-resolve-patient-message',
    resolveAction: (key: string) => `admin-resolve-action-${key}`,
    alertResolveRationale: 'admin-resolve-rationale',
    alertResolveBtn: 'admin-resolve-confirm',
    resolveCancel: 'admin-resolve-cancel',
    // Legacy alias kept so api.ts's defensive helper keeps compiling; the
    // real action picker is a button list (resolveAction(key)), not a select.
    alertResolveAction: 'admin-resolve-action-select',

    // EscalationAuditTrail — rungs keyed by ladder CODE; footer/fields
    // already shipped pre-Phase-3 (kept verbatim).
    escalationRung: (code: string) => `admin-escalation-rung-${code}`,
    escalationRungStatus: (code: string) => `admin-escalation-rung-status-${code}`,
    auditFooter: 'alert-audit-footer',
    auditHeader: 'alert-audit-header',
    auditField: (key: string) => `audit-field-${key}`,
    auditRationale: 'audit-field-resolutionRationale',
    auditAttributionSystem: 'audit-attribution-system',
    auditAttributionRetry: 'audit-attribution-retry',

    // Practices list (/practices)
    practiceList: 'admin-practice-list',
    practiceListRow: (practiceId: string) => `admin-practice-row-${practiceId}`,
    practiceCreateButton: 'admin-practice-create-button',
    practiceCreateModal: 'admin-practice-create-modal',
    practiceCreateName: 'admin-practice-create-name',
    practiceCreateHoursStart: 'admin-practice-create-hours-start',
    practiceCreateHoursEnd: 'admin-practice-create-hours-end',
    practiceCreateTz: 'admin-practice-create-tz',
    practiceCreateProtocol: 'admin-practice-create-protocol',
    practiceCreateSubmit: 'admin-practice-create-submit',
    // Practice detail (/practices/[id])
    practiceNameInput: 'admin-practice-name-input',
    practiceHoursStart: 'admin-practice-hours-start',
    practiceHoursEnd: 'admin-practice-hours-end',
    practiceTzInput: 'admin-practice-tz-input',
    practiceProtocolInput: 'admin-practice-protocol-input',
    practiceSave: 'admin-practice-save',
    practiceReadonly: 'admin-practice-readonly',
    practiceStaffList: 'admin-practice-staff-list',

    // NotificationsScreen (/notifications)
    notificationRow: (notifId: string) => `admin-notification-row-${notifId}`,
    notificationsList: 'admin-notifications-list',
  },
} as const

export type TestId = string

/** Helper: convert a testid string to a Playwright locator selector. */
export function byTestId(id: TestId): string {
  return `[data-testid="${id}"]`
}
