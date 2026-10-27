import { useEffect, useId, useState } from 'react';
import { Check, X } from 'lucide-react';
import { ChatReportInputReason, useReportChatMessage } from '@workspace/api-client-react';
import './safety.css';

type ReportTargetType = 'user' | 'message' | 'stream';

interface SafetyReportDialogProps {
  targetType: ReportTargetType;
  targetUsername?: string;
  roomId?: string;
  messageId?: string;
  streamId?: string;
  messageText?: string;
  roomSessionId?: string;
  onClose: () => void;
  onSubmitted?: () => void;
}

const REASONS = [
  { value: ChatReportInputReason.harassment, label: 'Harassment or bullying' },
  { value: ChatReportInputReason.hate_speech, label: 'Hate speech' },
  { value: ChatReportInputReason.sexual_content, label: 'Sexual content' },
  { value: ChatReportInputReason.spam_scams, label: 'Spam or scams' },
  { value: ChatReportInputReason.violence_threats, label: 'Violence or threats' },
  { value: ChatReportInputReason.underage_user, label: 'Underage user' },
  { value: ChatReportInputReason.other, label: 'Other' },
] as const;

export function SafetyReportDialog({
  targetType,
  targetUsername,
  roomId,
  messageId,
  streamId,
  messageText,
  roomSessionId,
  onClose,
  onSubmitted,
}: SafetyReportDialogProps) {
  const titleId = useId();
  const reasonGroupId = useId();
  const [reason, setReason] = useState<ChatReportInputReason | ''>('');
  const [details, setDetails] = useState('');
  const [submitError, setSubmitError] = useState('');
  const [submitted, setSubmitted] = useState(false);
  const report = useReportChatMessage({
    request: roomSessionId ? { headers: { 'X-Room-Session': roomSessionId } } : undefined,
  });

  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape' && !report.isPending) onClose();
    };
    document.addEventListener('keydown', handleKeyDown);
    return () => document.removeEventListener('keydown', handleKeyDown);
  }, [onClose, report.isPending]);

  const submit = (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!reason || report.isPending) return;
    setSubmitError('');
    report.mutate({
      data: {
        targetType,
        ...(targetUsername ? { targetUsername } : {}),
        ...(roomId ? { roomId } : {}),
        ...(messageId ? { messageId } : {}),
        ...(streamId ? { streamId } : {}),
        ...(messageText ? { messageText } : {}),
        reason,
        ...(details.trim() ? { details: details.trim() } : {}),
      },
    }, {
      onSuccess: () => {
        setSubmitted(true);
        onSubmitted?.();
      },
      onError: () => setSubmitError('Your report could not be sent. Please try again.'),
    });
  };

  return (
    <div
      className="st-safety st-report-backdrop"
      onMouseDown={(event) => { if (event.target === event.currentTarget && !report.isPending) onClose(); }}
    >
      <section className="st-report-dialog" role="dialog" aria-modal="true" aria-labelledby={titleId}>
        {submitted ? (
          <div className="st-report-success" role="status" data-testid="status-report-confirmation">
            <span className="st-report-success-mark" aria-hidden="true"><Check size={22} /></span>
            <h2 id={titleId}>Report received</h2>
            <p>Thanks, we'll review this.</p>
            <button type="button" className="st-safety-button st-safety-button-primary" onClick={onClose} data-testid="button-close-report-success">Done</button>
          </div>
        ) : (
          <>
            <header className="st-report-heading">
              <div>
                <span className="st-report-eyebrow">Big Apple Live safety</span>
                <h2 id={titleId}>Report {targetType}</h2>
              </div>
              <button type="button" className="st-report-close" aria-label="Close report dialog" onClick={onClose} disabled={report.isPending} data-testid="button-close-report">
                <X size={18} aria-hidden="true" />
              </button>
            </header>
            <p className="st-report-copy">Tell us what happened. Reports are private and help keep Big Apple Live welcoming.</p>
            {targetUsername && <p className="st-report-target">Reporting <strong>@{targetUsername}</strong></p>}
            <form onSubmit={submit}>
              <fieldset style={{ border: 0, padding: 0, margin: 0 }} aria-labelledby={reasonGroupId}>
                <legend id={reasonGroupId} className="st-report-field-label">Choose a reason</legend>
                <div className="st-report-reasons" role="radiogroup" aria-labelledby={reasonGroupId}>
                  {REASONS.map((option) => (
                    <button
                      type="button"
                      role="radio"
                      aria-checked={reason === option.value}
                      className="st-report-reason"
                      key={option.value}
                      onClick={() => setReason(option.value)}
                      data-testid={`option-report-reason-${option.value}`}
                    >
                      <span className="st-report-radio" aria-hidden="true" />
                      {option.label}
                    </button>
                  ))}
                </div>
              </fieldset>
              <label className="st-report-field-label" htmlFor={`${titleId}-details`}>Add a note <span style={{ color: '#929292', fontWeight: 400 }}>· optional</span></label>
              <textarea
                id={`${titleId}-details`}
                className="st-report-textarea"
                value={details}
                onChange={(event) => setDetails(event.target.value.slice(0, 500))}
                maxLength={500}
                placeholder="Share any context that could help us understand."
                data-testid="input-report-details"
              />
              <div className="st-report-hint"><span>Keep it short and specific.</span><span>{details.length}/500</span></div>
              {submitError && <p className="st-report-error" role="alert" data-testid="status-report-error">{submitError}</p>}
              <div className="st-report-actions">
                <button type="button" className="st-safety-button" onClick={onClose} disabled={report.isPending} data-testid="button-cancel-report">Cancel</button>
                <button type="submit" className="st-safety-button st-safety-button-primary" disabled={!reason || report.isPending} data-testid="button-submit-report">
                  {report.isPending ? 'Sending…' : 'Send report'}
                </button>
              </div>
            </form>
          </>
        )}
      </section>
    </div>
  );
}

export default SafetyReportDialog;
