export const getMatchLabel = (matchKey: string): string => {
  const parts = matchKey.split("_");
  if (parts.length < 2) return matchKey;

  const matchPart = parts[1];

  const qmMatch = matchPart.match(/^qm(\d+)$/i);
  if (qmMatch) return `QM ${qmMatch[1]}`;

  const finalMatch = matchPart.match(/^f(\d+)m(\d+)$/i);
  if (finalMatch) return `F${finalMatch[1]}M${finalMatch[2]}`;

  const sfMatch = matchPart.match(/^sf(\d+)m(\d+)$/i);
  if (sfMatch) return `SF${sfMatch[1]}M${sfMatch[2]}`;

  return matchPart.toUpperCase();
};
