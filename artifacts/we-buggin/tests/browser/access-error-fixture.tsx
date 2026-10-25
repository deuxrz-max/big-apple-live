import { useState } from 'react';
import { AccessCheckError } from '../../src/chat/AccessCheckError';

export function AccessErrorFixture() {
  const [result, setResult] = useState('');
  return <div className="ch"><div className="ch-in">
    <AccessCheckError
      retry={() => setResult('Retried')}
      goBack={() => setResult('Went back')}
      signOut={async () => {
        if (new URLSearchParams(location.search).has('fail-signout')) throw new Error('Offline');
        setResult('Signed out');
      }}
    />
    <output role="status">{result}</output>
  </div></div>;
}
