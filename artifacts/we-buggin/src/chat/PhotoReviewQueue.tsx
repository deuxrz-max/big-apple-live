import { useQueryClient } from '@tanstack/react-query';
import {
  useGetPhotoReviewQueue, useReviewProfilePhoto, getGetPhotoReviewQueueQueryKey,
} from '@workspace/api-client-react';
import { UserPhoto } from '@/components/user-photo';
import { errMessage } from '@/lib/errors';

export function PhotoReviewQueue() {
  const qc = useQueryClient();
  const q = useGetPhotoReviewQueue({ query: { queryKey: getGetPhotoReviewQueueQueryKey(), refetchInterval: 15_000 } });
  const review = useReviewProfilePhoto();
  return <section aria-label="Profile photo review">
    <h2>Profile photo review</h2>
    <p className="ch-note">No sexual or explicit photos. Keep profiles appropriate for a professional university.</p>
    {q.isLoading && <p role="status">Loading photos…</p>}
    {q.isError && <p role="alert">{errMessage(q.error)} <button className="bm-btn bm-btn-sm" onClick={() => q.refetch()}>Retry</button></p>}
    {review.isError && <p role="alert">{errMessage(review.error)}</p>}
    {q.data?.length === 0 && <p>No photos awaiting review.</p>}
    <ul className="ch-list">{q.data?.map(photo => <li key={photo.id}>
      <div><UserPhoto photoUrl={photo.photoUrl} displayName={photo.displayName ?? photo.username} size={96} />
        <p><b>{photo.displayName ?? photo.username ?? 'Profile setup not finished'}</b> — Pending review</p></div>
      <div>{(['approve', 'reject'] as const).map(action => <button key={action} className="bm-btn bm-btn-sm"
        disabled={review.isPending} onClick={() => review.mutate({ photoId: photo.id, data: { action } }, {
          onSuccess: () => { void qc.invalidateQueries(); },
        })}>{action === 'approve' ? 'Approve' : 'Reject'}</button>)}</div>
    </li>)}</ul>
  </section>;
}
