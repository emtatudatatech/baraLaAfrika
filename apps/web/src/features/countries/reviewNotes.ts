/*
 * `review_notes` is one note per line, written by the extraction pipeline and the seed review.
 * Some lines start with a tag: [corrected] (a fix applied to the document's text), [status]
 * (the animal status was reviewed) or a severity ([low], [medium], [high]) for an issue found
 * in the document. Untagged lines explain why a field needs verification.
 */

export type ReviewNoteKind = 'correction' | 'status' | 'issue' | 'note';

export interface ReviewNote {
  kind: ReviewNoteKind;
  text: string;
}

const TAGS: Readonly<Record<string, ReviewNoteKind>> = {
  corrected: 'correction',
  status: 'status',
  low: 'issue',
  medium: 'issue',
  high: 'issue',
};

export function parseReviewNotes(notes: string | null): ReviewNote[] {
  if (notes === null) return [];
  return notes
    .split('\n')
    .map((line) => line.trim())
    .filter(Boolean)
    .map((line) => {
      const match = /^\[([a-z ]+)\]\s*(.*)$/.exec(line);
      const kind = match?.[1] === undefined ? undefined : TAGS[match[1]];
      if (match?.[2] === undefined || kind === undefined) return { kind: 'note', text: line };
      // Capitalise the field name that follows the tag ("national animal: …").
      const text = match[2];
      return { kind, text: text.charAt(0).toUpperCase() + text.slice(1) };
    });
}
