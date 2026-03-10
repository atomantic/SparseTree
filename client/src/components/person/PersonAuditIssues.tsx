/**
 * Person Audit Issues Panel
 *
 * Shows audit issues for a specific person on their detail page.
 * Allows accept/reject/dismiss directly from the person context.
 */
import { useEffect, useState, useCallback } from 'react';
import {
  AlertCircle,
  AlertTriangle,
  Info,
  HelpCircle,
  Check,
  Loader2,
  Scan,
} from 'lucide-react';
import toast from 'react-hot-toast';
import { api } from '../../services/api';
import type { AuditIssue, AuditIssueSeverity } from '@fsf/shared';

const SEVERITY_ICONS: Record<AuditIssueSeverity, typeof AlertCircle> = {
  error: AlertCircle,
  warning: AlertTriangle,
  info: Info,
  hint: HelpCircle,
};

const SEVERITY_COLORS: Record<AuditIssueSeverity, string> = {
  error: 'text-red-500',
  warning: 'text-yellow-500',
  info: 'text-blue-400',
  hint: 'text-gray-400',
};

const SEVERITY_BG: Record<AuditIssueSeverity, string> = {
  error: 'bg-red-500/10 border-red-500/30',
  warning: 'bg-yellow-500/10 border-yellow-500/30',
  info: 'bg-blue-400/10 border-blue-400/30',
  hint: 'bg-gray-500/10 border-gray-500/30',
};

const STATUS_BADGE: Record<string, string> = {
  open: 'bg-yellow-500/20 text-yellow-400',
  accepted: 'bg-green-500/20 text-green-400',
  rejected: 'bg-red-500/20 text-red-400',
  auto_applied: 'bg-blue-500/20 text-blue-400',
};

const ISSUE_TYPE_LABELS: Record<string, string> = {
  impossible_date: 'Impossible Date',
  parent_age_conflict: 'Parent Age Conflict',
  placeholder_name: 'Placeholder Name',
  missing_gender: 'Missing Gender',
  unlinked_provider: 'Unlinked Provider',
  date_mismatch: 'Date Mismatch',
  place_mismatch: 'Place Mismatch',
  name_mismatch: 'Name Mismatch',
  missing_parents: 'Missing Parents',
  stale_record: 'Stale Record',
  orphaned_edge: 'Orphaned Edge',
  duplicate_suspect: 'Duplicate Suspect',
};

interface PersonAuditIssuesProps {
  dbId: string;
  personId: string;
}

export function PersonAuditIssues({ dbId, personId }: PersonAuditIssuesProps) {
  const [issues, setIssues] = useState<AuditIssue[]>([]);
  const [loading, setLoading] = useState(true);
  const [actionLoading, setActionLoading] = useState<string | null>(null);

  const loadIssues = useCallback(() => {
    setLoading(true);
    // Filter issues for this specific person by fetching all and filtering client-side
    // (the API filters by dbId; we filter by personId here)
    api.getAuditIssues(dbId, {})
      .then(all => setIssues(all.filter(i => i.personId === personId)))
      .catch(() => setIssues([]))
      .finally(() => setLoading(false));
  }, [dbId, personId]);

  useEffect(() => {
    loadIssues();
  }, [loadIssues]);

  const handleAccept = useCallback((issueId: string) => {
    setActionLoading(issueId);
    api.acceptAuditIssue(dbId, issueId)
      .then(() => {
        toast.success('Issue accepted');
        loadIssues();
      })
      .catch(err => toast.error(`Failed: ${err.message}`))
      .finally(() => setActionLoading(null));
  }, [dbId, loadIssues]);

  const handleReject = useCallback((issueId: string) => {
    setActionLoading(issueId);
    api.rejectAuditIssue(dbId, issueId)
      .then(() => {
        toast.success('Issue rejected');
        loadIssues();
      })
      .catch(err => toast.error(`Failed: ${err.message}`))
      .finally(() => setActionLoading(null));
  }, [dbId, loadIssues]);

  if (loading) {
    return (
      <div className="bg-app-card rounded-lg border border-app-border p-3">
        <div className="flex items-center gap-2 text-xs text-app-text-muted">
          <Loader2 size={14} className="animate-spin" />
          Loading audit issues...
        </div>
      </div>
    );
  }

  if (issues.length === 0) return null;

  const openIssues = issues.filter(i => i.status === 'open');
  const resolvedIssues = issues.filter(i => i.status !== 'open');

  return (
    <div className="bg-app-card rounded-lg border border-app-border p-3">
      <h3 className="flex items-center gap-1.5 text-xs font-semibold text-app-text-secondary mb-3">
        <Scan size={14} className="text-app-accent" />
        Audit Issues
        {openIssues.length > 0 && (
          <span className="px-1.5 py-0.5 rounded-full text-[10px] font-bold bg-red-500/20 text-red-400">
            {openIssues.length} open
          </span>
        )}
      </h3>

      <div className="space-y-2">
        {/* Open issues first */}
        {openIssues.map(issue => {
          const Icon = SEVERITY_ICONS[issue.severity];
          const isActioning = actionLoading === issue.issueId;

          return (
            <div
              key={issue.issueId}
              className={`rounded-lg border p-3 ${SEVERITY_BG[issue.severity]}`}
            >
              <div className="flex items-start gap-2">
                <Icon size={14} className={`flex-shrink-0 mt-0.5 ${SEVERITY_COLORS[issue.severity]}`} />
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2 mb-1">
                    <span className="text-[10px] font-medium text-app-text-muted uppercase tracking-wide">
                      {ISSUE_TYPE_LABELS[issue.issueType] || issue.issueType}
                    </span>
                  </div>
                  <p className="text-xs text-app-text leading-relaxed">{issue.description}</p>
                  {issue.suggestedValue && (
                    <div className="mt-1.5 flex items-center gap-2 text-xs">
                      <span className="text-app-text-muted">Current:</span>
                      <span className="text-red-400 line-through">{issue.currentValue}</span>
                      <span className="text-app-text-muted">→</span>
                      <span className="text-green-400 font-medium">{issue.suggestedValue}</span>
                      {issue.suggestedSource && (
                        <span className="text-app-text-subtle">({issue.suggestedSource})</span>
                      )}
                    </div>
                  )}
                  <div className="mt-2 flex items-center gap-2">
                    {issue.suggestedValue ? (
                      <button
                        onClick={() => handleAccept(issue.issueId)}
                        disabled={isActioning}
                        className="px-2.5 py-1 rounded text-[11px] font-medium bg-green-600/20 text-green-400 hover:bg-green-600/30 transition-colors flex items-center gap-1 disabled:opacity-50"
                      >
                        {isActioning ? <Loader2 size={10} className="animate-spin" /> : <Check size={10} />}
                        Apply Fix
                      </button>
                    ) : (
                      <button
                        onClick={() => handleAccept(issue.issueId)}
                        disabled={isActioning}
                        className="px-2.5 py-1 rounded text-[11px] font-medium bg-app-hover text-app-text-muted hover:bg-app-border transition-colors disabled:opacity-50"
                      >
                        {isActioning ? <Loader2 size={10} className="animate-spin" /> : null}
                        Dismiss
                      </button>
                    )}
                    <button
                      onClick={() => handleReject(issue.issueId)}
                      disabled={isActioning}
                      className="px-2.5 py-1 rounded text-[11px] font-medium bg-red-600/20 text-red-400 hover:bg-red-600/30 transition-colors disabled:opacity-50"
                    >
                      Not an issue
                    </button>
                  </div>
                </div>
              </div>
            </div>
          );
        })}

        {/* Resolved issues collapsed */}
        {resolvedIssues.length > 0 && (
          <div className="text-[10px] text-app-text-subtle pt-1">
            {resolvedIssues.length} resolved issue(s):
            {resolvedIssues.map(issue => (
              <span key={issue.issueId} className={`ml-1.5 px-1.5 py-0.5 rounded ${STATUS_BADGE[issue.status]}`}>
                {ISSUE_TYPE_LABELS[issue.issueType] || issue.issueType} — {issue.status}
              </span>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
