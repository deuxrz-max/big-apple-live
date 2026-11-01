import { useState, type FormEvent } from 'react';
import { Link } from 'wouter';
import { useQueryClient } from '@tanstack/react-query';
import { useGetCoinTesters, useSetCoinTester, useGetTestCoinLaunchStatus } from '@workspace/api-client-react';
import { ErrorBox, Loading, errMsg } from './common';
import { TestCoinLaunchReset } from './TestCoinLaunchReset';

/** Owner-only management; being on this list grants no moderation/admin access. */
export function CoinTestersPanel() {
  const query = useGetCoinTesters({ query: { refetchInterval: 15000 } });
  const mutation = useSetCoinTester();
  const launch = useGetTestCoinLaunchStatus({ query: { refetchInterval: 15000 } });
  const qc = useQueryClient();
  const [username, setUsername] = useState('');
  const [message, setMessage] = useState('');
  const change = (name: string, enabled: boolean) => {
    setMessage('');
    mutation.mutate({ data: { username: name.trim(), enabled } }, {
      onSuccess: () => {
        setUsername('');
        setMessage(enabled ? 'Tester enabled. They can refresh to see Unlimited test coins.' : 'Tester revoked. Test inventory is cleared; real funds are unchanged.');
        void qc.invalidateQueries();
      },
      onError: error => setMessage(errMsg(error)),
    });
  };
  const submit = (event: FormEvent) => { event.preventDefault(); change(username, true); };
  return <section className="sc-form" data-testid="coin-tester-management">
    <Link href="/community/profile" className="bm-btn">Back to Me</Link>
    <h2 className="sc-h2">Coin testers</h2>
    <p className="sc-sub">Only accounts you explicitly enable get unlimited test coins, on the website and Android wrapper. This does not grant admin access.</p>
    <p className="sc-sub">Test sends play animations but give no real coins, cash-out value, XP or PK points. Test purchases use a separate My Bag (7-day expiry). Paid balances and paid inventory stay untouched. Revoking clears test inventory and test-only effects.</p>
    <form onSubmit={submit} className="sc-form">
      <label>Exact account username
        <input value={username} onChange={event => setUsername(event.target.value)} pattern="[A-Za-z0-9_]{3,24}" required autoComplete="off" maxLength={24} />
      </label>
      <button className="bm-btn bm-btn-primary" disabled={mutation.isPending || !launch.data || !!launch.data.closedAt} type="submit">Enable test coins</button>
    </form>
    {message && <p role="status">{message}</p>}
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
