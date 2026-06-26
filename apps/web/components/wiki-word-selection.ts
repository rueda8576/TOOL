export const WIKI_WORD_PATTERN = /[\p{L}\p{N}]+(?:[-_'][\p{L}\p{N}]+)*/gu;

export type WikiWordMatch = {
  word: string;
  normalized: string;
  start: number;
  end: number;
};

export function normalizeWikiWordToken(word: string): string {
  return word.toLocaleLowerCase();
}

export function findWikiWordAtOffset(text: string, offset: number): WikiWordMatch | null {
  const boundedOffset = Math.max(0, Math.min(offset, text.length));
  for (const match of text.matchAll(WIKI_WORD_PATTERN)) {
    const word = match[0];
    const start = match.index ?? 0;
    const end = start + word.length;
    if (boundedOffset >= start && boundedOffset <= end) {
      return {
        word,
        normalized: normalizeWikiWordToken(word),
        start,
        end
      };
    }
  }
  return null;
}

export function findFirstWikiWordMatch(text: string, normalizedWord: string): WikiWordMatch | null {
  for (const match of text.matchAll(WIKI_WORD_PATTERN)) {
    const word = match[0];
    if (normalizeWikiWordToken(word) === normalizedWord) {
      const start = match.index ?? 0;
      return {
        word,
        normalized: normalizedWord,
        start,
        end: start + word.length
      };
    }
  }
  return null;
}
