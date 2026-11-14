import { useGetSocialMe, getGetSocialMeQueryKey } from '@workspace/api-client-react';
import '@/beam/beam.css';
import '@/social/social.css';
import { ErrorBox, Loading } from '@/social/common';
import { ProfileView } from './ProfileView';

export function OwnProfile() {
  const me = useGetSocialMe({ query: { queryKey: getGetSocialMeQueryKey(), refetchInterval: 15000 } });
  if (me.isLoading) return <div className="pf pf-panel pf-panel-solo"><Loading /></div>;
  if (me.isError || !me.data) return <div className="pf pf-panel pf-panel-solo"><ErrorBox error={me.error} retry={() => me.refetch()} /></div>;
  return <ProfileView person={me.data.profile} own backHref="/home" />;
}
