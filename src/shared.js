export const MODEL = 'openai/privacy-filter';
export const REVISION = '7ffa9a043d54d1be65afb281eddf0ffbe629385b';
export const MAX_CHARS = 16000;
export const MAX_TOKENS = 2048;
export const KINDS = {
  private_person: 'Name', private_email: 'Email', private_phone: 'Phone',
  private_address: 'Address', private_date: 'Date', private_url: 'Private URL',
  account_number: 'Account number', secret: 'Secret',
};
export const SITES = [
  'chatgpt.com', 'chat.openai.com', 'claude.ai', 'perplexity.ai', 'www.perplexity.ai',
  'gemini.google.com', 'copilot.microsoft.com', 'grok.com', 'poe.com',
  'chat.mistral.ai', 'chat.deepseek.com', 'chat.qwen.ai',
];
export const MATCHES = SITES.map(host => `https://${host}/*`);
export const EMPTY_STATS = { hidden: 0, characters: 0, pastes: 0, last: 0 };

export function validateRules(rules) {
  if (!Array.isArray(rules) || rules.length > 100) throw new Error('Use at most 100 exceptions.');
  return rules.map(rule => {
    if (!rule || !Object.hasOwn(KINDS, rule.kind) || typeof rule.value !== 'string' ||
        !rule.value.trim() || rule.value.length > 200) throw new Error('Invalid exception.');
    return { kind: rule.kind, value: rule.value.trim() };
  });
}

export function supportedUrl(url, extra = []) {
  try {
    const u = new URL(url);
    return (u.protocol === 'https:' && SITES.includes(u.hostname)) || extra.includes(`${u.protocol}//${u.hostname}/*`);
  } catch { return false; }
}

export function originPattern(url) {
  const u = new URL(url);
  if (u.protocol !== 'https:' && !(u.protocol === 'http:' && ['localhost', '127.0.0.1'].includes(u.hostname))) {
    throw new Error('Choose an HTTPS website (or localhost for testing).');
  }
  // Match patterns do not support a port; permissions apply to every port on this host.
  return `${u.protocol}//${u.hostname}/*`;
}
