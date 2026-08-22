export const TEAM_PROFILE_UPDATED_EVENT = 'team:profile-updated';

export function publishTeamProfileUpdate(detail) {
  if (typeof window !== 'undefined') {
    window.dispatchEvent(new CustomEvent(TEAM_PROFILE_UPDATED_EVENT, { detail }));
  }
}

export function subscribeToTeamProfileUpdates(listener) {
  if (typeof window === 'undefined') return () => {};
  const handleUpdate = (event) => listener(event.detail);
  window.addEventListener(TEAM_PROFILE_UPDATED_EVENT, handleUpdate);
  return () => window.removeEventListener(TEAM_PROFILE_UPDATED_EVENT, handleUpdate);
}

export function applyTeamProfileUpdate(team, update, keys = {}) {
  if (!team) return team;
  const {
    id = 'teamId',
    name = 'name',
    avatarUrl = 'avatarUrl',
    avatarStaticUrl = 'avatarStaticUrl',
  } = keys;
  if (Number(team[id]) !== Number(update.teamId)) return team;

  return {
    ...team,
    ...(Object.prototype.hasOwnProperty.call(update, 'name') ? { [name]: update.name } : {}),
    ...(Object.prototype.hasOwnProperty.call(update, 'avatarUrl') ? { [avatarUrl]: update.avatarUrl } : {}),
    ...(Object.prototype.hasOwnProperty.call(update, 'avatarStaticUrl')
      ? { [avatarStaticUrl]: update.avatarStaticUrl }
      : {}),
  };
}
