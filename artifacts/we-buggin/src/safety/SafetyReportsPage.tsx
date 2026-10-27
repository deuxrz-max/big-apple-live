import { useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import {
  getGetChatReportsQueryKey,
  useGetChatReports,
  useReviewChatReport,
  type ChatReportRecord,
  type ChatReportReviewInputAction,
} from '@workspace/api-client-react';
import './safety.css';

const ACTIONS: { action: ChatReportReviewInputAction; label: string }[] = [
  { action: 'reviewed', label: 'Mark reviewed' },
  { action: 'warn', label: 'Warn' },
  { action: 'mute', label: 'Mute' },
  { action: 'ban', label: 'Ban' },
];

const REASON_LABELS: Record<string, string> = {
  harassment: 'Harassment or bullying',
  hate_speech: 'Hate speech',
  sexual_content: 'Sexual content',
  spam_scams: 'Spam or scams',
  violence_threats: 'Violence or threats',
  underage_user: 'Underage user',
  other: 'Other',
};

function errorStatus(error: unknown): number | undefined {
  if (typeof error === 'object' && error !== null && 'status' in error && typeof error.status === 'number') return error.status;
  return undefined;
}

function formatDate(value: string): string {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return new Intl.DateTimeFormat(undefined, { dateStyle: 'medium', timeStyle: 'short' }).format(date);
}

function ReviewActions({
  report,
  pending,
  onAction,
}: {
  report: ChatReportRecord;
  pending: boolean;
  onAction: (reportId: string, action: ChatReportReviewInputAction) => void;
}) {
  if (report.status !== 'pending') return null;
  return (
    <div className="st-report-card-actions" aria-label={`Review actions for report ${report.id}`}>
      {ACTIONS.map(({ action, label }) => (
        <button
          type="button"
          className={`st-safety-button${action === 'ban' ? ' st-safety-button-primary' : ''}`}
          key={action}
          disabled={pending}
          onClick={() => onAction(report.id, action)}
          data-testid={`button-review-${action}-${report.id}`}
        >
          {label}
        </button>
      ))}
    </div>
  );
}

function ReportCard({
  report,
  pending,
  onAction,
}: {
  report: ChatReportRecord;
  pending: boolean;
  onAction: (reportId: string, action: ChatReportReviewInputAction) => void;
}) {
  const context = [
    report.roomId ? `Room ${report.roomId}` : '',
    report.streamId ? `Stream ${report.streamId}` : '',
    report.messageId ? `Message ${report.messageId}` : '',
  ].filter(Boolean);
  return (
    <article className="st-report-card" data-testid={`card-chat-report-${report.id}`}>
      <div className="st-report-card-top">
        <div className="st-report-persons">
          <span>Reporter @{report.reporterUsername}</span><small>reported</small><span>@{report.reportedUsername}</span>
        </div>
        <span className="st-report-status" data-testid={`status-report-${report.id}`}>{report.status}</span>
      </div>
      <div className="st-report-card-content">
        <div>
          <div className="st-report-meta">
            <span className="st-report-tag">{report.targetType}</span>
            <span className="st-report-tag">{REASON_LABELS[report.reason] ?? report.reason}</span>
            <span className="st-report-tag">{report.source === 'moderator_bot' ? 'Automated signal' : 'Community report'}</span>
          </div>
          <p className="st-report-context">
            {context.length ? `${context.join(' · ')} · ` : ''}{formatDate(report.createdAt)}
          </p>
          {report.text && <blockquote className="st-report-text">{report.text}</blockquote>}
          {report.details && <p className="st-report-note"><strong>Reporter note:</strong> {report.details}</p>}
        </div>
        <ReviewActions report={report} pending={pending} onAction={onAction} />
      </div>
    </article>
  );
}

export function SafetyReportsPage() {
  const queryClient = useQueryClient();
  const reportsQuery = useGetChatReports({ query: { queryKey: getGetChatReportsQueryKey() } });
  const review = useReviewChatReport();
  const [feedback, setFeedback] = useState<{ kind: 'success' | 'error'; text: string } | null>(null);
  const forbidden = reportsQuery.isError && errorStatus(reportsQuery.error) === 403;
  const reviewForbidden = review.isError && errorStatus(review.error) === 403;

  const handleAction = (reportId: string, action: ChatReportReviewInputAction) => {
    setFeedback(null);
    review.mutate({ reportId, data: { action } }, {
      onSuccess: () => {
        setFeedback({ kind: 'success', text: 'Review action saved.' });
        void queryClient.invalidateQueries({ queryKey: getGetChatReportsQueryKey() });
      },
      onError: (error) => setFeedback({
        kind: 'error',
        text: errorStatus(error) === 403
          ? 'You do not have permission to review these reports.'
          : 'That action could not be saved. Please try again.',
      }),
    });
  };

  return (
    <main className="st-safety st-reports-page">
      <div className="st-reports-topline">Big Apple Live · trust & safety</div>
      <header className="st-reports-header">
        <h1>Community reports</h1>
        <p>A private review space for keeping conversations, audio beams, and streams respectful.</p>
      </header>

      {feedback && <p className={`st-report-feedback${feedback.kind === 'error' ? ' st-report-feedback-error' : ''}`} role={feedback.kind === 'error' ? 'alert' : 'status'} data-testid="status-review-feedback">{feedback.text}</p>}
      {reviewForbidden && !feedback && <p className="st-report-feedback st-report-feedback-error" role="alert">You do not have permission to review these reports.</p>}

      {reportsQuery.isLoading && (
        <div className="st-reports-list" aria-label="Loading reports" aria-busy="true" data-testid="status-reports-loading">
          <div className="st-reports-skeleton" /><div className="st-reports-skeleton" />
        </div>
      )}
      {forbidden && (
        <section className="st-reports-state" role="alert" data-testid="status-reports-forbidden">
          <h2>Owner access only</h2>
          <p>This private report queue is available to the Big Apple Live owner account.</p>
        </section>
      )}
      {reportsQuery.isError && !forbidden && (
        <section className="st-reports-state" role="alert" data-testid="status-reports-error">
          <h2>Reports could not load</h2>
          <p>Something interrupted the connection. Your queue has not been changed.</p>
          <button type="button" className="st-safety-button" onClick={() => { void reportsQuery.refetch(); }} data-testid="button-retry-reports">Try again</button>
        </section>
      )}
      {!reportsQuery.isLoading && !reportsQuery.isError && reportsQuery.data?.length === 0 && (
        <section className="st-reports-state" data-testid="status-reports-empty">
          <h2>Nothing waiting for review</h2>
          <p>When reports need attention, they will appear here with the context needed to make a considered decision.</p>
        </section>
      )}
      {!reportsQuery.isLoading && !reportsQuery.isError && !!reportsQuery.data?.length && (
        <div className="st-reports-list" aria-label="Chat reports" data-testid="list-chat-reports">
          {reportsQuery.data.map((report) => (
            <ReportCard key={report.id} report={report} pending={review.isPending} onAction={handleAction} />
          ))}
        </div>
      )}
    </main>
  );
}

export default SafetyReportsPage;
