import { KINDS, validateRules } from './shared.js';

/** Reconstruct ALL model groups, including O, in order. Never search for an
 * entity's word: repeated names and Unicode can otherwise redact the wrong text.
 * Transformers.js 4.2 has no offsets. Any non-lossless decoding blocks the paste.
 */
export function redact(text, groups, rules = []) {
  const allowed = validateRules(rules);
  if (!Array.isArray(groups)) throw new Error('ALIGNMENT');
  let cursor = 0, hidden = 0, characters = 0, result = '';
  for (const group of groups) {
    if (!group || typeof group.word !== 'string' || !group.word.length ||
        !text.startsWith(group.word, cursor)) throw new Error('ALIGNMENT');
    const kind = group.entity_group;
    if (kind !== 'O' && !Object.hasOwn(KINDS, kind)) throw new Error('ALIGNMENT');
    const word = group.word;
    const value = word.trim();
    const keep = kind === 'O' || !value || allowed.some(r => r.kind === kind && r.value === value);
    if (keep) result += word;
    else {
      const prefix = word.match(/^\s*/u)[0];
      const suffix = word.match(/\s*$/u)[0];
      result += `${prefix}[${KINDS[kind].toUpperCase().replaceAll(' ', '_')}]${suffix}`;
      hidden++;
      characters += [...value].length;
    }
    cursor += word.length;
  }
  if (cursor !== text.length) throw new Error('ALIGNMENT');
  return { text: result, hidden, characters };
}
