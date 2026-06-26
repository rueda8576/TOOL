export const WIKI_WORD_PATTERN = /[\p{L}\p{N}]+(?:[-_'][\p{L}\p{N}]+)*/gu;

export type WikiWordMatch = {
  word: string;
  normalized: string;
  occurrenceIndex: number;
  start: number;
  end: number;
};

export function normalizeWikiWordToken(word: string): string {
  return word.toLocaleLowerCase();
}

export function findWikiWordAtOffset(text: string, offset: number): WikiWordMatch | null {
  const boundedOffset = Math.max(0, Math.min(offset, text.length));
  const occurrenceCountsByWord = new Map<string, number>();
  for (const match of text.matchAll(WIKI_WORD_PATTERN)) {
    const word = match[0];
    const normalized = normalizeWikiWordToken(word);
    const occurrenceIndex = occurrenceCountsByWord.get(normalized) ?? 0;
    occurrenceCountsByWord.set(normalized, occurrenceIndex + 1);
    const start = match.index ?? 0;
    const end = start + word.length;
    if (boundedOffset >= start && boundedOffset <= end) {
      return {
        word,
        normalized,
        occurrenceIndex,
        start,
        end
      };
    }
  }
  return null;
}

export function findFirstWikiWordMatch(text: string, normalizedWord: string, occurrenceIndex = 0): WikiWordMatch | null {
  let currentOccurrenceIndex = 0;
  for (const match of text.matchAll(WIKI_WORD_PATTERN)) {
    const word = match[0];
    if (normalizeWikiWordToken(word) === normalizedWord) {
      const start = match.index ?? 0;
      if (currentOccurrenceIndex === occurrenceIndex) {
        return {
          word,
          normalized: normalizedWord,
          occurrenceIndex: currentOccurrenceIndex,
          start,
          end: start + word.length
        };
      }
      currentOccurrenceIndex += 1;
    }
  }
  return null;
}

export function countWikiWordOccurrencesBeforeOffset(text: string, normalizedWord: string, offset: number): number {
  const boundedOffset = Math.max(0, Math.min(offset, text.length));
  let count = 0;
  for (const match of text.matchAll(WIKI_WORD_PATTERN)) {
    const word = match[0];
    const start = match.index ?? 0;
    if (start >= boundedOffset) {
      break;
    }
    if (normalizeWikiWordToken(word) === normalizedWord) {
      count += 1;
    }
  }
  return count;
}
