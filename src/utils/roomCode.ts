/** Socket room IDs are never changed or truncated. -- For the user view only... */
export function formatRoomCode(roomId: string): string {
  const compact = roomId.replace(/^game_/, '').replace(/[^a-zA-Z0-9]/g, '').toUpperCase();
  if (compact.length <= 6) return compact.replace(/(.{4})/, '$1-');
  return `${compact.slice(0, 4)}-${compact.slice(-2)}`;
}

export function normaliseRoomId(code: string): string {
  const trimmed = code.trim();
  return trimmed.startsWith('game_') ? trimmed : `game_${trimmed}`;
}
