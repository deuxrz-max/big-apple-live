import { createRoot } from 'react-dom/client';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { ChessRoom } from '../../src/chess/ChessRoom';
import '../../src/app-shapes.css';
import '../../src/joker-finish.css';
import '../../src/index.css';

const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
createRoot(document.getElementById('root')!).render(
  <QueryClientProvider client={client}>
    <ChessRoom roomId="fx-chess" accountKey="fixture-account" onExit={() => { document.body.dataset.exited = '1'; }} />
  </QueryClientProvider>,
);
