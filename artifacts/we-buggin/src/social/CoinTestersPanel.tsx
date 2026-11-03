import { useState, type FormEvent } from 'react';
import { Link } from 'wouter';
import { useQueryClient } from '@tanstack/react-query';
import {
  getGetSocialPeopleQueryKey, useGetCoinTesters, useGetSocialPeople,
  useSetCoinTester, useGetTestCoinLaunchStatus,
} from '@workspace/api-client-react';
import { ErrorBox, Loading, PersonCard, errMsg } from './common';
import { TestCoinLaunchReset } from './TestCoinLaunchReset';

/** Owner-only management; being on this list grants no moderation/admin access. */
export function CoinTestersPanel() {
  const query = useGetCoinTesters({ query: { refetchInterval: 15000 } });
  const mutation = useSetCoinTester();
  const launch = useGetTestCoinLaunchStatus({ query: { refetchInterval: 15000 } });
  const qc = useQueryClient();
  const [draft, setDraft] = useState('');
  const [search, setSearch] = useState('');
  const [message, setMessage] = useState('');
  const searchParams = search ? { search } : {};
  const people = useGetSocialPeople(searchParams, { query: {
    queryKey: getGetSocialPeopleQueryKey(searchParams),
    enabled: search.length > 0,
  } });
  const enabledTesters = new Set(query.data?.testers.filter(tester => tester.enabled).map(tester => tester.username.toLowerCase()) ?? []);
  const change = (name: string, enabled: boolean) => {
    setMessage('');
    mutation.mutate({ data: { username: name.trim(), enabled } }, {
      onSuccess: () => {
        setMessage(enabled ? `${name} is now a coin tester with unlimited non-redeemable test coins.` : `${name} is no longer a tester. Test inventory is cleared; real funds are unchanged.`);
        void qc.invalidateQueries();
      },
      onError: error => setMessage(errMsg(error)),
    });
  };
  const submit = (event: FormEvent) => { event.preventDefault(); setSearch(draft.trim()); };
  return <section className="sc-form" data-testid="coin-tester-management">
    <Link href="/community/profile" className="bm-btn">Back to Me</Link>
    <h1 className="sc-h2">Owner tools · Coin testers</h1>
    <p className="sc-sub">Only accounts you explicitly enable get unlimited test coins, on the website and Android wrapper. This does not grant admin access.</p>
    <p className="sc-sub">Test sends play animations but give no real coins, cash-out value, XP or PK points. Test purchases use a separate My Bag (7-day expiry). Paid balances and paid inventory stay untouched. Revoking clears test inventory and test-only effects.</p>
    <form onSubmit={submit} className="sc-form">
      <label>Find an account by name or @ID
        <input value={draft} onChange={event => setDraft(event.target.value)} required autoComplete="off" maxLength={80} placeholder="Name or @ID" />
      </label>
      <button className="bm-btn bm-btn-primary" type="submit">Search</button>
    </form>
    {message && <p role="status">{message}</p>}
    {search && (people.isLoading ? <Loading /> : people.isError ? <ErrorBox error={people.error} retry={() => people.refetch()} /> :
      people.data && (people.data.people.length ? <div className="sc-grid" data-testid="coin-tester-search-results">
        {people.data.people.map(person => {
          const enabled = enabledTesters.has(person.username.toLowerCase());
          return <PersonCard key={person.username} p={person} extra={
            <button type="button" className="bm-btn bm-btn-primary" disabled={mutation.isPending || !launch.data || !!launch.data.closedAt}
              onClick={() => change(person.username, !enabled)} data-testid={`button-coin-tester-${person.username}`}>
              {enabled ? 'Remove coin tester' : 'Make coin tester'}
            </button>
          } />;
        })}
      </div> : <p className="sc-sub">No accounts match that name or @ID.</p>))}
    {query.isLoading ? <Loading /> : query.isError ? <ErrorBox error={query.error} retry={() => query.refetch()} /> :
      <div>{!query.data?.testers.some(tester => tester.enabled) && <p>No testers enabled.</p>}
        {query.data?.testers.map(tester => <div key={tester.username} className="sc-panel" style={{ padding: 12, marginTop: 10 }}>
          <b>{tester.username}</b> · {tester.enabled ? 'Test coins enabled' : 'Revoked'}
          {tester.enabled && <button type="button" className="bm-btn" style={{ marginLeft: 12 }} disabled={mutation.isPending} onClick={() => change(tester.username, false)}>Revoke</button>}
        </div>)}
      </div>}
    <TestCoinLaunchReset />
  </section>;
}
