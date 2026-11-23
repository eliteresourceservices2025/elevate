/**
 * The people to pre-tick when HR opens "Who can pick it": those listed on the project who are still assigned to the client. Someone who
 * left has no checkbox, so keeping them would make the list impossible to save (the server only accepts people assigned today).
 */
export function keepCurrentPeople(listed: readonly string[] | undefined, current: readonly { id: string }[]): string[] {
  return (listed ?? []).filter((id) => current.some((p) => p.id === id));
}
