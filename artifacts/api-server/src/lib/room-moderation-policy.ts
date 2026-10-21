export function mayModerateRoom(hostAccountId: string, actorAccountId: string, isModerator: boolean): boolean {
  return hostAccountId === actorAccountId || isModerator;
}

/** Public app-run rooms have no creator, so only existing moderators may act. */
export function mayModerateAppRunRoom(isModerator: boolean): boolean {
  return isModerator;
}

export function mayModerateAnotherAccount(actorAccountId: string, targetAccountId: string): boolean {
  return actorAccountId !== targetAccountId;
}
