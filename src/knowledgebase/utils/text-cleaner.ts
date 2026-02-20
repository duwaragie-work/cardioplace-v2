export const document_cleaner = (text: string) => {
  return text
    .replace(/\s+/g, ' ')
    .replace('/n', ' ')
    .replace('/t', ' ')
    .replace('/r', ' ')
    .trim()
}
