export type LineFormat = { bom: string; breaks: string[]; preferred: string }

export function sourceText(raw: string): { text: string; format: LineFormat } {
  const bom = raw.startsWith('\uFEFF') ? '\uFEFF' : ''
  const breaks: string[] = []
  const text = raw.slice(bom.length).replace(/\r\n?|\n/g, (separator) => {
    breaks.push(separator)
    return '\n'
  })
  return { text, format: { bom, breaks, preferred: breaks[0] ?? '\n' } }
}
