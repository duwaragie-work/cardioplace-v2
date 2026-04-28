-- phase/23-bp-l1-dispatch
-- Adds the BP Level 1 ladder steps. Same wall-clock offsets as Tier 1
-- (T72H = MEDICAL_DIRECTOR, T7D = HEALPLACE_OPS) but a non-emergent
-- cadence + yellow display. Router picks BP_L1_HIGH vs BP_L1_LOW via
-- alert.tier, so a single ladder shape covers both.

ALTER TYPE "LadderStep" ADD VALUE IF NOT EXISTS 'T72H';
ALTER TYPE "LadderStep" ADD VALUE IF NOT EXISTS 'T7D';
