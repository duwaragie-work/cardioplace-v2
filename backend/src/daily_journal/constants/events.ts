export const JOURNAL_EVENTS = {
  ENTRY_CREATED: 'journal.entry.created',
  // Patient/admin EDIT or DELETE of an existing reading. Per the signed CTO
  // 2026-06-09 "no re-trigger" policy (Manisha 2026-06-12 Q2 "we cannot
  // un-page"), the rule engine MUST NOT re-evaluate on this event — edits are
  // audit-log only and the corrected value rides into the NEXT new entry's
  // batch. This event is consumed ONLY by context-refresh listeners (chat /
  // voice). The engine deliberately does NOT subscribe to it.
  ENTRY_UPDATED: 'journal.entry.updated',
  // FIRST evaluation of a HELD reading (not a re-trigger): the Cluster 6 Q2
  // single-reading finalize + the Option D UNCONFIRMED finalize emit this so
  // the engine fires the previously-held alert. The engine subscribes to this
  // (and ENTRY_CREATED) — never to ENTRY_UPDATED — so a patient edit can never
  // re-fire while a legitimate held-alert release still does.
  ENTRY_FINALIZED: 'journal.entry.finalized',
  DEVIATION_DETECTED: 'journal.deviation.detected',
  // Phase/7 — renamed from v1 'ANOMALY_TRACKED'. Fires after the rule engine
  // persists a DeviationAlert row; carries the alert id so escalation +
  // notification services can route by tier / ruleId.
  ALERT_CREATED: 'journal.alert.created',
  // Gap 1 fix (2026-07-13) — emitted by AlertEngineService.handleEntryCreated
  // AFTER evaluate() has finished (including all DeviationAlert commits). Carries
  // the ENTRY_CREATED payload plus `alertsFired` / `alertCount` so downstream
  // listeners (LoggedConfirmationListener) can decide whether a reading tripped
  // any rule WITHOUT querying DeviationAlert themselves or racing the engine.
  // Not consumed by the escalation ladder — that keeps listening on ALERT_CREATED.
  ENTRY_EVALUATED: 'journal.entry.evaluated',
  ESCALATION_CREATED: 'journal.escalation.created',
  // Phase/7 — fires at each ladder step dispatch (T+0, T+4h, etc.). Payload
  // carries recipient IDs, roles, channels, and afterHours flag so downstream
  // consumers (phase/19 analytics, future dashboards) can trace the ladder.
  ESCALATION_DISPATCHED: 'journal.escalation.dispatched',
} as const
