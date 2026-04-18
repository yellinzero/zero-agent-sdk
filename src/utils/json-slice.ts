export function findJsonSliceRange(text: string): { start: number; end: number } | undefined {
  let start = -1;
  const stack: string[] = [];
  let inString = false;
  let escaping = false;

  for (let i = 0; i < text.length; i++) {
    const ch = text[i]!;

    if (start === -1) {
      if (ch === '{' || ch === '[') {
        start = i;
        stack.push(ch === '{' ? '}' : ']');
      }
      continue;
    }

    if (escaping) {
      escaping = false;
      continue;
    }

    if (ch === '\\') {
      if (inString) escaping = true;
      continue;
    }

    if (ch === '"') {
      inString = !inString;
      continue;
    }

    if (inString) continue;

    if (ch === '{') stack.push('}');
    else if (ch === '[') stack.push(']');
    else if ((ch === '}' || ch === ']') && stack[stack.length - 1] === ch) {
      stack.pop();
      if (stack.length === 0) {
        return { start, end: i + 1 };
      }
    }
  }

  return start >= 0 ? { start, end: text.length } : undefined;
}

export function findJsonSlice(text: string): string | undefined {
  const range = findJsonSliceRange(text);
  return range ? text.slice(range.start, range.end) : undefined;
}

export function findJsonSliceEnd(text: string): number | undefined {
  return findJsonSliceRange(text)?.end;
}
