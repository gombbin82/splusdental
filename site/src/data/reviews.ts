/**
 * Patient reviews shown on /reviews.
 *
 * Only paste real reviews, copied word for word from the practice's Google Business Profile or
 * Facebook page, with the reviewer's name exactly as it appears there. Never edit, combine or
 * invent reviews, and leave out anything that describes a patient's health condition.
 *
 * Example entry:
 *   { author: 'First L.', rating: 5, text: 'Exact review text…', source: 'Google' },
 */

export interface Review {
  author: string;
  rating: 1 | 2 | 3 | 4 | 5;
  text: string;
  source: 'Google' | 'Facebook';
}

export const reviews: Review[] = [];
