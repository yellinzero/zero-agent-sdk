import { findJsonSliceEnd } from './json-slice.js';

function repairPartialJson(input: string): string | null {
  const start = input.search(/[{[]/);
  if (start === -1) return null;

  let text = input.slice(start);
  const sliceEnd = findJsonSliceEnd(text);
  if (sliceEnd !== undefined) {
    text = text.slice(0, sliceEnd);
  }
  const stack: string[] = [];
  let inString = false;
  let escaping = false;
  let unicodeDigitsRemaining = 0;
  let lastSafeIndex = -1;
  let numberStart = -1;
  let numberState:
    | 'sign'
    | 'int'
    | 'decimal_point'
    | 'fraction'
    | 'exp'
    | 'exp_sign'
    | 'exp_digits'
    | null = null;

  for (let i = 0; i < text.length; i++) {
    const ch = text[i]!;

    if (escaping) {
      if (unicodeDigitsRemaining > 0) {
        if (/^[0-9a-fA-F]$/.test(ch)) {
          unicodeDigitsRemaining--;
        } else {
          text = text.slice(0, i);
          break;
        }
      } else if (ch === 'u') {
        unicodeDigitsRemaining = 4;
      }

      if (unicodeDigitsRemaining === 0) escaping = false;
      lastSafeIndex = i;
      continue;
    }

    if (ch === '\\') {
      if (inString) {
        escaping = true;
        unicodeDigitsRemaining = 0;
      }
      lastSafeIndex = i;
      continue;
    }

    if (ch === '"') {
      inString = !inString;
      lastSafeIndex = i;
      continue;
    }

    if (inString) {
      lastSafeIndex = i;
      continue;
    }

    if (numberState) {
      const nextState = advanceNumberState(numberState, ch);
      if (nextState === 'done') {
        numberState = null;
        numberStart = -1;
      } else if (nextState === null) {
        if (isNumberTerminator(ch)) {
          numberState = null;
          numberStart = -1;
        } else {
          text = text.slice(0, numberStart);
          break;
        }
      } else {
        numberState = nextState;
      }
    } else if (ch === '-' || /\d/.test(ch)) {
      numberStart = i;
      numberState = ch === '-' ? 'sign' : 'int';
      lastSafeIndex = i;
      continue;
    }

    if (/\s/.test(ch)) {
      lastSafeIndex = i;
      continue;
    }

    if (ch === '{') stack.push('}');
    else if (ch === '[') stack.push(']');
    else if ((ch === '}' || ch === ']') && stack[stack.length - 1] === ch) {
      stack.pop();
    }

    lastSafeIndex = i;
  }

  if (numberState && numberStart >= 0) {
    text = text.slice(0, numberStart);
  } else if (lastSafeIndex >= 0 && lastSafeIndex < text.length - 1) {
    text = text.slice(0, lastSafeIndex + 1);
  }

  text = text.replace(/,\s*$/, '');
  text = text.replace(/(?:,\s*)?"(?:[^"\\]|\\.)*"\s*:\s*$/, '');
  text = text.replace(/,\s*([}\]])/g, '$1');

  if (inString) {
    text = text.replace(/(?:,\s*)?"(?:[^"\\]|\\.)*"\s*:\s*"[^"\\]*$/, '');
  }

  while (stack.length > 0) {
    text += stack.pop();
  }

  return text;
}

function isNumberTerminator(ch: string): boolean {
  return ch === ',' || ch === '}' || ch === ']' || /\s/.test(ch);
}

function advanceNumberState(
  state: 'sign' | 'int' | 'decimal_point' | 'fraction' | 'exp' | 'exp_sign' | 'exp_digits',
  ch: string
):
  | 'sign'
  | 'int'
  | 'decimal_point'
  | 'fraction'
  | 'exp'
  | 'exp_sign'
  | 'exp_digits'
  | 'done'
  | null {
  switch (state) {
    case 'sign':
      return /\d/.test(ch) ? 'int' : null;
    case 'int':
      if (/\d/.test(ch)) return 'int';
      if (ch === '.') return 'decimal_point';
      if (ch === 'e' || ch === 'E') return 'exp';
      return null;
    case 'decimal_point':
      return /\d/.test(ch) ? 'fraction' : null;
    case 'fraction':
      if (/\d/.test(ch)) return 'fraction';
      if (ch === 'e' || ch === 'E') return 'exp';
      return null;
    case 'exp':
      if (ch === '+' || ch === '-') return 'exp_sign';
      if (/\d/.test(ch)) return 'exp_digits';
      return null;
    case 'exp_sign':
      return /\d/.test(ch) ? 'exp_digits' : null;
    case 'exp_digits':
      return /\d/.test(ch) ? 'exp_digits' : null;
  }
}

export function parsePartialJson(text: string): unknown | undefined {
  if (!text.trim()) return undefined;

  try {
    return JSON.parse(text);
  } catch {
    const repairedDirect = repairPartialJson(text);
    if (repairedDirect) {
      try {
        return JSON.parse(repairedDirect);
      } catch {
        // fall through to nested extraction
      }
    }

    const trimmed = text.trimStart();
    if (!trimmed.startsWith('{') && !trimmed.startsWith('[')) {
      const startCandidates = [...text.matchAll(/[{[]/g)]
        .map((match) => match.index ?? -1)
        .filter((index) => index >= 0);
      for (const start of startCandidates) {
        const repairedSlice = repairPartialJson(text.slice(start));
        if (!repairedSlice) continue;
        try {
          return JSON.parse(repairedSlice);
        } catch {
          // try next candidate
        }
      }
    }
    return undefined;
  }
}
