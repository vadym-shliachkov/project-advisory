import fs from 'node:fs';

const REFERENCES = new URL('../../references/', import.meta.url);
const cache = new Map();

export function loadSchema(name) {
  if (!cache.has(name)) {
    cache.set(name, JSON.parse(fs.readFileSync(new URL(`${name}.schema.json`, REFERENCES), 'utf8')));
  }
  return cache.get(name);
}

export function validate(schema, value, at = '$') {
  const errors = [];
  check(schema, value, at, errors);
  return errors;
}

function typeOf(v) {
  if (v === null) return 'null';
  if (Array.isArray(v)) return 'array';
  if (typeof v === 'number' && Number.isInteger(v)) return 'integer';
  return typeof v;
}

function matchesType(type, v) {
  const actual = typeOf(v);
  return type === actual || (type === 'number' && actual === 'integer');
}

function check(s, v, at, errors) {
  if (s.type) {
    const types = [].concat(s.type);
    if (!types.some((t) => matchesType(t, v))) {
      errors.push(`${at}: expected ${types.join(' or ')}, got ${typeOf(v)}`);
      return;
    }
  }
  if (s.enum && !s.enum.includes(v)) errors.push(`${at}: must be one of ${s.enum.join(', ')}`);
  if (typeof v === 'string') {
    if (s.minLength != null && v.length < s.minLength) errors.push(`${at}: must be at least ${s.minLength} characters`);
    if (s.pattern && !new RegExp(s.pattern).test(v)) errors.push(`${at}: must match ${s.pattern}`);
  }
  if (Array.isArray(v)) {
    if (s.minItems != null && v.length < s.minItems) errors.push(`${at}: must have at least ${s.minItems} item(s)`);
    if (s.maxItems != null && v.length > s.maxItems) errors.push(`${at}: must have at most ${s.maxItems} item(s)`);
    if (s.items) v.forEach((item, i) => check(s.items, item, `${at}[${i}]`, errors));
  }
  if (typeOf(v) === 'object') {
    for (const key of s.required ?? []) if (!(key in v)) errors.push(`${at}: missing required property "${key}"`);
    for (const [key, child] of Object.entries(v)) {
      const sub = s.properties?.[key];
      if (sub) check(sub, child, `${at}.${key}`, errors);
      else if (s.additionalProperties === false) errors.push(`${at}: unknown property "${key}"`);
    }
  }
}
