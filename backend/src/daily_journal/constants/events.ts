export const JOURNAL_EVENTS = {
  ENTRY_CREATED: 'journal.entry.created',
  ENTRY_UPDATED: 'journal.entry.updated',
  DEVIATION_DETECTED: 'journal.deviation.detected',
  // Phase/7 — renamed from v1 'ANOMALY_TRACKED'. Fires after the rule engine
  // persists a DeviationAlert row; carries the alert id so escalation +
  // notification services can route by tier / ruleId.
  ALERT_CREATED: 'journal.alert.created',
  ESCALATION_CREATED: 'journal.escalation.created',
  // Phase/7 — fires at each ladder step dispatch (T+0, T+4h, etc.). Payload
  // carries recipient IDs, roles, channels, and afterHours flag so downstream
  // consumers (phase/19 analytics, future dashboards) can trace the ladder.
  ESCALATION_DISPATCHED: 'journal.escalation.dispatched',
} as const
