export function hasPhotoReviewAccess(access: {
  adultConfirmed: boolean;
  moderator: boolean;
  owner: boolean;
}) {
  return access.adultConfirmed && (access.owner || access.moderator);
}
