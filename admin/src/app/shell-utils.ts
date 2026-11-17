/** Up to two initials for the avatar: "Stephanie Kang" -> "SK", "jane.doe@x.com" -> "JD". */
export function initials(name: string, email: string): string {
  const source = name && name !== email ? name : email.split('@')[0]!;
  const parts = source
    .split(/[\s._-]+/)
    .filter(Boolean)
    .map((p) => p[0]!.toUpperCase());
  return (parts.length > 1 ? parts[0]! + parts[parts.length - 1]! : (parts[0] ?? '?')).slice(0, 2);
}
