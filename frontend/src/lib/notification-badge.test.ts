import { countInAppNotifications } from './notification-badge';

/**
 * Regression cover for the bell badge. The bug this replaces: the badge counted
 * PUSH rows only, so DASHBOARD-channel notifications — the entire SUPPORT_*
 * family — never incremented it. Support could reply to a patient and the bell
 * stayed dark.
 */
describe('countInAppNotifications', () => {
  it('counts DASHBOARD rows — the SUPPORT_* regression', () => {
    const count = countInAppNotifications([
      { channel: 'DASHBOARD', title: 'Support replied to your request', body: 'Ticket CP-SUP-1' },
    ]);
    expect(count).toBe(1);
  });

  it('excludes EMAIL rows (delivery tracking, not an inbox item)', () => {
    const count = countInAppNotifications([
      { channel: 'EMAIL', title: 'Support replied', body: 'Ticket CP-SUP-1' },
      { channel: 'DASHBOARD', title: 'Support replied', body: 'Ticket CP-SUP-1' },
    ]);
    expect(count).toBe(1);
  });

  it('counts a dual-dispatched notification once, not twice', () => {
    // Same content pushed to both channels must not double the badge.
    const count = countInAppNotifications([
      { channel: 'DASHBOARD', title: 'Gap reminder', body: 'Log a reading' },
      { channel: 'PUSH', title: 'Gap reminder', body: 'Log a reading' },
    ]);
    expect(count).toBe(1);
  });

  it('still counts a PUSH row that has no DASHBOARD twin', () => {
    const count = countInAppNotifications([
      { channel: 'PUSH', title: 'Gap reminder', body: 'Log a reading' },
      { channel: 'DASHBOARD', title: 'Support replied', body: 'Ticket CP-SUP-1' },
    ]);
    expect(count).toBe(2);
  });

  it('counts rows with no channel set (legacy rows)', () => {
    expect(countInAppNotifications([{ title: 'x', body: 'y' }])).toBe(1);
  });

  it('is zero for an empty inbox', () => {
    expect(countInAppNotifications([])).toBe(0);
  });
});
