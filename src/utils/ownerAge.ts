export function resolveOwnerAge(
  owner: 'self' | 'spouse',
  currentAge: number,
  spouseAge: number | null,
): number {
  return owner === 'spouse' && spouseAge !== null ? spouseAge : currentAge;
}
