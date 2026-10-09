type Photos = { photoUrl?: string | null; photoUrls?: string[]; photoReviews?: { photoUrl: string; status: string }[] };

/** Other-member URLs are already approval-filtered by the server. Own URLs are not. */
export function approvedPhotos(p: Photos, own = false): string[] {
  const pool = [...new Set(p.photoUrls?.length ? p.photoUrls : p.photoUrl ? [p.photoUrl] : [])];
  const approved = new Set((p.photoReviews ?? []).filter(r => r.status === 'approved').map(r => r.photoUrl));
  const list = own || p.photoReviews !== undefined ? pool.filter(url => approved.has(url)) : pool;
  return p.photoUrl && list.includes(p.photoUrl) ? [p.photoUrl, ...list.filter(url => url !== p.photoUrl)] : list;
}
