// Single source of truth for the staff "Rules of Behavior" (ROB) version a
// care-team reviewer must acknowledge before the HIPAA audit console (L2) lets
// them in (§164.312(b) audit controls, sprint L1). Bump this string whenever the
// ROB text changes — reviewers then re-acknowledge, and getTrainingAckStatus
// reports them as un-acknowledged until they do. The ROB wording itself is owned
// by Humaira (compliance); this constant only versions it.
export const TRAINING_ACK_VERSION = '2026-07-06';
