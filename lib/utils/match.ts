/**
 * Get the match segment only (e.g. "2025cacc_qm1" -> "qm1").
 * If no underscore, returns the key as-is.
 */
function getMatchPart(matchKey: string): string {
  // split on undersscore and take last part
  const parts = matchKey.split("_");
  // make sure format is recognizable
  if (parts.length >= 2) {
    return parts[1]!;
  }
  else {
    // no underscore, return as-is
    return matchKey;
  }
}

/**
 * Parse a match key into a sort-order tuple for ordering matches:
 * qm1, qm2, ... (qualification), then sf1m1, sf2m1, ... (semifinals), then f1m1, f1m2 (finals).
 * Handles keys with or without event prefix (e.g. "qm1" or "2025casf_qm1").
 */
export function getMatchSortOrder(matchKey: string): number[] {
  const part = getMatchPart(matchKey);

  // parsing qual matches as [0, matchNum]
  // e.g. "qm2" -> [0, 2]
  const qmMatch = part.match(/^qm(\d+)$/i);
  if (qmMatch) return [0, parseInt(qmMatch[1], 10) || 0];

  // parsing sf matches as [1, sfNum, matchNum]
  // e.g. "sf1m2" -> [1, 1, 2]
  const sfMatch = part.match(/^sf(\d+)m(\d+)$/i);
  if (sfMatch)
    return [
      1,
      parseInt(sfMatch[1], 10) || 0,
      parseInt(sfMatch[2], 10) || 0,
    ];
  
  // parsing final matches as [2, fnum, matchNum]
  // e.g. "f1m2" -> [2, 1, 2]
  const fMatch = part.match(/^f(\d+)m(\d+)$/i);
  if (fMatch)
    return [2, parseInt(fMatch[1], 10) || 0, parseInt(fMatch[2], 10) || 0];

  // default to [3, 0] for unrecognized formats, which will sort after all recognized matches
  return [3, 0];
}

export const getMatchLabel = (matchKey: string): string => {
  const matchPart = getMatchPart(matchKey);

  const qmMatch = matchPart.match(/^qm(\d+)$/i);
  if (qmMatch) return `QM ${qmMatch[1]}`;

  const finalMatch = matchPart.match(/^f(\d+)m(\d+)$/i);
  if (finalMatch) return `F${finalMatch[1]}M${finalMatch[2]}`;

  const sfMatch = matchPart.match(/^sf(\d+)m(\d+)$/i);
  if (sfMatch) return `SF${sfMatch[1]}M${sfMatch[2]}`;

  return matchPart.toUpperCase();
};
