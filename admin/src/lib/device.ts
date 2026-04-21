export function getOrCreateDeviceId(): string {
  if (typeof window === 'undefined') return 'web-guest';
  const key = 'healplace_device_id';
  let id = localStorage.getItem(key);
  if (!id) {
    id = crypto.randomUUID
      ? crypto.randomUUID()
      : `guest-${Math.random().toString(36).slice(2)}`;
    localStorage.setItem(key, id);
  }
  return id;
}
