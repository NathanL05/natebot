// Parsing the "Always allowed / Never allowed tools" fields. Rules are separated
// by spaces or commas, except inside parentheses, so "Bash(git commit:*)" stays
// one rule instead of becoming "Bash(git" and "commit:*)".

export function splitToolRules(text: string): string[] {
  const rules: string[] = []
  let current = ''
  let depth = 0
  for (const ch of text) {
    if (ch === '(') depth++
    else if (ch === ')') depth = Math.max(0, depth - 1)
    if (depth === 0 && (ch === ',' || /\s/.test(ch))) {
      if (current.trim()) rules.push(current.trim())
      current = ''
    } else {
      current += ch
    }
  }
  if (current.trim()) rules.push(current.trim())
  return rules
}
