import { useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { useGetTestCoinLaunchStatus, usePrepareTestCoinLaunchReset, useConfirmTestCoinLaunchReset } from '@workspace/api-client-react';
import { ErrorBox, errMsg } from './common';

export function TestCoinLaunchReset() {
  const status = useGetTestCoinLaunchStatus({ query: { refetchInterval: 15000 } });
  const preview = usePrepareTestCoinLaunchReset();
  const confirm = useConfirmTestCoinLaunchReset();
  const qc = useQueryClient();
  const [phrase, setPhrase] = useState('');
  const [ending, setEnding] = useState(false);
  const [message, setMessage] = useState('');
  const prepare = () => {
    setMessage(''); setPhrase(''); setEnding(false);
    preview.mutate(undefined, { onError: error => setMessage(errMsg(error)) });
  };
  const execute = () => {
    if (!preview.data || phrase !== 'END FREE TEST COINS' || !ending) return;
    setMessage('');
    confirm.mutate({ data: { planId: preview.data.planId, confirmation: 'END FREE TEST COINS', endingTesting: true } }, {
      onSuccess: () => {
        preview.reset(); setPhrase(''); setEnding(false);
        setMessage('Free test coins retired. Earned levels, XP and progress to the next level are kept. Real balances and purchase records were not changed. Payments are not enabled by this action.');
        void qc.invalidateQueries();
      },
      onError: error => { setMessage(errMsg(error)); preview.reset(); },
    });
  };
  return <section className="sc-panel" style={{ padding: 16, marginTop: 24 }} data-testid="test-coin-launch-reset">
    <h3>Launch reset — end free test coins</h3>
    <p>This is not automatic. Publishing, restarting and opening this page do not run it. Use it only when testing is over and you are preparing to enable real coin purchases.</p>
    <p>It permanently retires unlimited access and removes all test-only bag gifts and effects. Test coins become zero. Paid coins, legitimate rewards, paid inventory, purchase records and audit receipts remain intact.</p>
    <p><b>Keep earned levels:</b> account levels, gifting XP and progress toward the next level are not reset. Keeping a level does not make test coins or test rewards withdrawable.</p>
    <p>Balances without a reliable test label are not guessed or erased. This control does not enable payments.</p>
    {status.isError && <ErrorBox error={status.error} retry={() => status.refetch()} />}
    {status.data?.closedAt
      ? <p role="status">Test coins retired on {new Date(status.data.closedAt).toLocaleString()}. New tester grants are disabled.</p>
      : <>
        <button type="button" className="bm-btn" disabled={status.isLoading || status.isError || preview.isPending || confirm.isPending}
          onClick={prepare}>Preview launch reset</button>
        {preview.data && <div className="sc-form" style={{ marginTop: 16 }}>
          <p>Will revoke {preview.data.activeTesters} tester(s), remove {preview.data.testGiftQuantity} test gift(s) and {preview.data.testEffects} test effect(s). Free test coins afterward: <b>0</b>. Real wallet balances: <b>preserved</b>.</p>
          {preview.data.levelsAndXpPreserved && <p>Earned levels, gifting XP and next-level progress: <b>kept unchanged</b>. No cash-out value is created.</p>}
          <p>Preview expires at {new Date(preview.data.expiresAt).toLocaleTimeString()}. Changes to testers or test inventory require a fresh preview.</p>
          <label><input type="checkbox" checked={ending} onChange={event => setEnding(event.target.checked)} /> I am ending testing and preparing for paid launch.</label>
          <label>Type END FREE TEST COINS
            <input value={phrase} onChange={event => setPhrase(event.target.value)} autoComplete="off" spellCheck={false} />
          </label>
          <button type="button" className="bm-btn" disabled={phrase !== 'END FREE TEST COINS' || !ending || confirm.isPending}
            onClick={execute}>Confirm launch reset</button>
          <button type="button" className="bm-btn" disabled={confirm.isPending} onClick={() => { preview.reset(); setPhrase(''); setEnding(false); }}>Cancel</button>
        </div>}
      </>}
    {message && <p role="status">{message}</p>}
  </section>;
}
