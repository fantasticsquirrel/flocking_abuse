export const timelineGapRem = (elapsedMonths: number): number =>
  Math.min(Math.max(elapsedMonths - 1, 0) * 1.5, 12);

