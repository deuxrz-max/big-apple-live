import * as Dialog from '@radix-ui/react-dialog';
import type { Participant } from '../types';

interface Props {
  participant: Participant | undefined;
  selfId: string;
  busy: boolean;
  error: string | null;
  onClose(): void;
  onMute(): Promise<boolean>;
  onUnmute(): Promise<boolean>;
}

export function BeamMicrophoneMenu({ participant, selfId, busy, error, onClose, onMute, onUnmute }: Props) {
  const own = participant?.id === selfId;
  const act = async (action: () => Promise<boolean>) => {
    if (await action()) onClose();
  };
  return (
    <Dialog.Root open={!!participant} onOpenChange={open => !open && !busy && onClose()}>
      <Dialog.Portal>
        <div className="beam-app bm-mic-surface">
          <Dialog.Overlay className="bm-mic-overlay" />
          <Dialog.Content className="bm-mic-panel" data-testid="dialog-beam-microphone">
            <Dialog.Title>{participant?.handle}’s microphone</Dialog.Title>
            <Dialog.Description className="bm-mic-description">
              {own ? 'Only you can allow your microphone to start.' : 'Turning their mic on sends a request. They must accept before audio starts.'}
            </Dialog.Description>
            <p className="bm-label" role="status">{participant?.micEnabled ? 'Mic on' : participant?.hostMuted ? 'Muted by creator' : 'Mic off'}</p>
            <div className="bm-mic-buttons">
              <button type="button" className="bm-btn" disabled={busy || (own && (!participant?.micEnabled && !participant?.unmuteRequested))}
                onClick={() => void act(onMute)} data-testid="button-beam-mic-off">Turn mic off</button>
              <button type="button" className="bm-btn bm-btn-primary" disabled={busy || (own && (!!participant?.hostMuted || !!participant?.micEnabled))}
                onClick={() => void act(onUnmute)} data-testid="button-beam-mic-on">
                {busy ? 'Please wait…' : own ? 'Turn mic on' : 'Request mic on'}
              </button>
            </div>
            {error && <p className="bm-error" role="alert">{error}</p>}
            <Dialog.Close className="bm-link-btn" disabled={busy} data-testid="button-close-mic-menu">Close</Dialog.Close>
          </Dialog.Content>
        </div>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
