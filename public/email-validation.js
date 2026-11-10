// Shared by the browser and API. This checks syntax, not mailbox ownership.
export function emailError(value) {
  const message = 'Enter a valid email address, such as name@example.com.';
  if (typeof value !== 'string') return message;
  const email = value.trim();
  if (!email) return 'Enter your email address.';
  if (email.length > 254) return message;
  const parts = email.split('@');
  if (parts.length !== 2) return message;
  const [local, domain] = parts;
  if (!local || local.length > 64 || local.startsWith('.') || local.endsWith('.') || local.includes('..')) return message;
  if (!/^[a-zA-Z0-9.!#$%&'*+/=?^_`{|}~-]+$/.test(local)) return message;
  const labels = domain.split('.');
  if (labels.length < 2 || !labels.every(label => label.length <= 63 && /^[a-zA-Z0-9](?:[a-zA-Z0-9-]*[a-zA-Z0-9])?$/.test(label))) return message;
  if (!/^(?:[a-zA-Z]{2,63}|xn--[a-zA-Z0-9-]+)$/.test(labels.at(-1))) return message;
  return '';
}
