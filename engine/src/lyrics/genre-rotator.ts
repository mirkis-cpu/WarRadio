import { GENRES, type GenreDefinition } from './genres.js';

export class GenreRotator {
  private lastGenreName: string | null = null;

  /**
   * Weighted random genre selection that avoids repeating the same genre twice in a row.
   */
  next(): GenreDefinition {
    const pool = this.lastGenreName
      ? GENRES.filter(g => g.name !== this.lastGenreName)
      : GENRES;

    const totalWeight = pool.reduce((sum, g) => sum + g.weight, 0);
    let roll = Math.random() * totalWeight;

    for (const genre of pool) {
      roll -= genre.weight;
      if (roll <= 0) {
        this.lastGenreName = genre.name;
        return genre;
      }
    }

    // Fallback - should not be reached
    const selected = pool[pool.length - 1];
    this.lastGenreName = selected.name;
    return selected;
  }

  /** Reset rotation state (e.g. after a restart). */
  reset(): void {
    this.lastGenreName = null;
  }
}
