import { useState } from 'react';
import { X, Sparkles, Check, Loader2, ChevronDown, ChevronUp } from 'lucide-react';
import { Link } from 'react-router-dom';
import { api } from '../../services/api';
import type { DiscoveryResult } from '../../services/api';
import toast from 'react-hot-toast';

interface AiDiscoveryModalProps {
  dbId: string;
  onClose: () => void;
  onComplete: () => void;
}

export function AiDiscoveryModal({ dbId, onClose, onComplete }: AiDiscoveryModalProps) {
  const [status, setStatus] = useState<'idle' | 'running' | 'completed' | 'error'>('idle');
  const [result, setResult] = useState<DiscoveryResult | null>(null);
  const [selectedCandidates, setSelectedCandidates] = useState<Set<string>>(new Set());
  const [expandedCandidates, setExpandedCandidates] = useState<Set<string>>(new Set());
  const [sampleSize, setSampleSize] = useState(100);
  const [excludeBiblical, setExcludeBiblical] = useState(true);
  const [customPrompt, setCustomPrompt] = useState('');
  const [applying, setApplying] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const startDiscovery = async () => {
    setStatus('running');
    setError(null);

    api.quickDiscovery(dbId, sampleSize, { excludeBiblical, customPrompt: customPrompt || undefined })
      .then(data => {
        setResult(data);
        setStatus('completed');
        // Pre-select high confidence candidates
        const highConfidence = data.candidates
          .filter(c => c.confidence === 'high')
          .map(c => c.personId);
        setSelectedCandidates(new Set(highConfidence));
      })
      .catch(err => {
        setError(err.message);
        setStatus('error');
      });
  };

  const toggleCandidate = (personId: string) => {
    const newSelected = new Set(selectedCandidates);
    if (newSelected.has(personId)) {
      newSelected.delete(personId);
    } else {
      newSelected.add(personId);
    }
    setSelectedCandidates(newSelected);
  };

  const toggleExpanded = (personId: string) => {
    const newExpanded = new Set(expandedCandidates);
    if (newExpanded.has(personId)) {
      newExpanded.delete(personId);
    } else {
      newExpanded.add(personId);
    }
    setExpandedCandidates(newExpanded);
  };

  const selectAll = () => {
    if (result) {
      setSelectedCandidates(new Set(result.candidates.map(c => c.personId)));
    }
  };

  const selectNone = () => {
    setSelectedCandidates(new Set());
  };

  const applySelected = async () => {
    if (!result) return;

    setApplying(true);
    const candidatesToApply = result.candidates.filter(c => selectedCandidates.has(c.personId));

    api.applyDiscoveryBatch(dbId, candidatesToApply)
      .then(data => {
        toast.success(`Added ${data.applied} ancestors to favorites`);
        onComplete();
        onClose();
      })
      .catch(err => {
        toast.error(`Failed to apply: ${err.message}`);
      })
      .finally(() => {
        setApplying(false);
      });
  };

  const getConfidenceColor = (confidence: 'high' | 'medium' | 'low') => {
    switch (confidence) {
      case 'high': return 'bg-green-500/20 text-green-400 border-green-500/30';
      case 'medium': return 'bg-yellow-500/20 text-yellow-400 border-yellow-500/30';
      case 'low': return 'bg-gray-500/20 text-gray-400 border-gray-500/30';
    }
  };

  return (
    <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
      <div className="bg-app-card border border-app-border rounded-lg w-full max-w-3xl max-h-[90vh] flex flex-col">
        {/* Header */}
        <div className="flex items-center justify-between p-4 border-b border-app-border">
          <div className="flex items-center gap-2">
            <Sparkles className="text-app-accent" size={20} />
            <h2 className="text-lg font-semibold text-app-text">AI Ancestor Discovery</h2>
          </div>
          <button
            onClick={onClose}
            className="p-1 text-app-text-muted hover:text-app-text transition-colors"
          >
            <X size={20} />
          </button>
        </div>

        {/* Content */}
        <div className="flex-1 overflow-y-auto p-4">
          {status === 'idle' && (
            <div className="space-y-4">
              <p className="text-app-text-secondary">
                Use AI to analyze your family tree and discover interesting ancestors worth
                adding to your favorites. The AI will look for notable occupations, unusual
                life stories, significant migrations, and connections to historical events.
              </p>

              <div className="bg-app-bg border border-app-border rounded-lg p-4 space-y-4">
                <div>
                  <label className="block text-sm font-medium text-app-text mb-2">
                    Sample Size
                  </label>
                  <div className="flex items-center gap-4">
                    <input
                      type="range"
                      min="25"
                      max="200"
                      step="25"
                      value={sampleSize}
                      onChange={e => setSampleSize(parseInt(e.target.value))}
                      className="flex-1"
                    />
                    <span className="text-app-text-muted w-16 text-right">{sampleSize} people</span>
                  </div>
                  <p className="text-xs text-app-text-subtle mt-2">
                    Prioritizes ancestors with biographical information and listed occupations.
                  </p>
                </div>

                <label className="flex items-center gap-2 text-sm text-app-text cursor-pointer">
                  <input
                    type="checkbox"
                    checked={excludeBiblical}
                    onChange={e => setExcludeBiblical(e.target.checked)}
                    className="rounded border-app-border"
                  />
                  Exclude biblical/ancient characters
                  <span className="text-app-text-subtle">(born before 500 AD)</span>
                </label>

                <div>
                  <label className="block text-sm font-medium text-app-text mb-2">
                    Custom Search (optional)
                  </label>
                  <textarea
                    value={customPrompt}
                    onChange={e => setCustomPrompt(e.target.value)}
                    placeholder="e.g., Find ancestors accused of witchcraft, or who served in the Revolutionary War..."
                    className="w-full px-3 py-2 text-sm border border-app-border rounded-md bg-app-bg text-app-text placeholder-app-text-subtle resize-none"
                    rows={2}
                  />
                  <p className="text-xs text-app-text-subtle mt-1">
                    Give the AI specific criteria to look for in your ancestors.
                  </p>
                </div>
              </div>

              <button
                onClick={startDiscovery}
                className="w-full py-3 bg-app-accent text-app-text rounded-lg hover:bg-app-accent/80 transition-colors flex items-center justify-center gap-2"
              >
                <Sparkles size={18} />
                Start Discovery
              </button>
            </div>
          )}

          {status === 'running' && (
            <div className="flex flex-col items-center justify-center py-12">
              <Loader2 size={48} className="animate-spin text-app-accent mb-4" />
              <p className="text-app-text-secondary text-center">
                Analyzing {sampleSize} ancestors for interesting stories...
              </p>
              <p className="text-app-text-subtle text-sm mt-2">
                This may take a minute or two
              </p>
            </div>
          )}

          {status === 'error' && (
            <div className="space-y-4">
              <div className="bg-app-error/10 border border-app-error/30 rounded-lg p-4">
                <p className="text-app-error">{error}</p>
              </div>
              <button
                onClick={() => setStatus('idle')}
                className="w-full py-2 bg-app-border text-app-text rounded hover:bg-app-hover transition-colors"
              >
                Try Again
              </button>
            </div>
          )}

          {status === 'completed' && result && (
            <div className="space-y-4">
              {result.candidates.length === 0 ? (
                <div className="text-center py-8">
                  <p className="text-app-text-muted">
                    No particularly interesting ancestors were found in this sample.
                  </p>
                  <p className="text-app-text-subtle text-sm mt-2">
                    Try increasing the sample size or running discovery again.
                  </p>
                  <button
                    onClick={() => setStatus('idle')}
                    className="mt-4 px-4 py-2 bg-app-border text-app-text rounded hover:bg-app-hover transition-colors"
                  >
                    Run Again
                  </button>
                </div>
              ) : (
                <>
                  <div className="flex items-center justify-between">
                    <p className="text-app-text-secondary">
                      Found <span className="text-app-accent font-medium">{result.candidates.length}</span> interesting
                      ancestors out of {result.totalAnalyzed} analyzed.
                    </p>
                    <div className="flex gap-2">
                      <button
                        onClick={selectAll}
                        className="text-xs text-app-accent hover:underline"
                      >
                        Select All
                      </button>
                      <span className="text-app-text-subtle">|</span>
                      <button
                        onClick={selectNone}
                        className="text-xs text-app-text-muted hover:underline"
                      >
                        Select None
                      </button>
                    </div>
                  </div>

                  <div className="space-y-2">
                    {result.candidates.map(candidate => (
                      <div
                        key={candidate.personId}
                        className={`border rounded-lg transition-colors ${
                          selectedCandidates.has(candidate.personId)
                            ? 'border-app-accent bg-app-accent/5'
                            : 'border-app-border bg-app-bg'
                        }`}
                      >
                        <div
                          className="flex items-start gap-3 p-3 cursor-pointer"
                          onClick={() => toggleCandidate(candidate.personId)}
                        >
                          {/* Checkbox */}
                          <div className={`mt-0.5 w-5 h-5 rounded border flex items-center justify-center flex-shrink-0 ${
                            selectedCandidates.has(candidate.personId)
                              ? 'bg-app-accent border-app-accent'
                              : 'border-app-border'
                          }`}>
                            {selectedCandidates.has(candidate.personId) && (
                              <Check size={14} className="text-white" />
                            )}
                          </div>

                          {/* Info */}
                          <div className="flex-1 min-w-0">
                            <div className="flex items-center gap-2 flex-wrap">
                              <Link
                                to={`/person/${dbId}/${candidate.personId}`}
                                onClick={e => e.stopPropagation()}
                                className="font-medium text-app-text hover:text-app-accent transition-colors"
                              >
                                {candidate.name}
                              </Link>
                              <span className="text-app-text-muted text-sm">{candidate.lifespan}</span>
                              <span className={`px-2 py-0.5 text-xs rounded border ${getConfidenceColor(candidate.confidence)}`}>
                                {candidate.confidence}
                              </span>
                            </div>
                            <p className="text-sm text-app-text-secondary mt-1">
                              {candidate.whyInteresting}
                            </p>
                            <div className="flex flex-wrap gap-1 mt-2">
                              {candidate.suggestedTags.map(tag => (
                                <span
                                  key={tag}
                                  className="px-2 py-0.5 bg-app-accent/10 text-app-accent rounded text-xs"
                                >
                                  {tag}
                                </span>
                              ))}
                            </div>
                          </div>

                          {/* Expand toggle */}
                          <button
                            onClick={e => {
                              e.stopPropagation();
                              toggleExpanded(candidate.personId);
                            }}
                            className="p-1 text-app-text-muted hover:text-app-text transition-colors"
                          >
                            {expandedCandidates.has(candidate.personId) ? (
                              <ChevronUp size={16} />
                            ) : (
                              <ChevronDown size={16} />
                            )}
                          </button>
                        </div>

                        {/* Expanded details */}
                        {expandedCandidates.has(candidate.personId) && (
                          <div className="px-3 pb-3 pl-11 text-sm text-app-text-muted space-y-1">
                            {candidate.birthPlace && (
                              <p>Birth: {candidate.birthPlace}</p>
                            )}
                            {candidate.deathPlace && (
                              <p>Death: {candidate.deathPlace}</p>
                            )}
                            {candidate.occupations && candidate.occupations.length > 0 && (
                              <p>Occupations: {candidate.occupations.join(', ')}</p>
                            )}
                            {candidate.bio && (
                              <p className="text-app-text-subtle line-clamp-3">{candidate.bio}</p>
                            )}
                          </div>
                        )}
                      </div>
                    ))}
                  </div>
                </>
              )}
            </div>
          )}
        </div>

        {/* Footer */}
        {status === 'completed' && result && result.candidates.length > 0 && (
          <div className="p-4 border-t border-app-border flex items-center justify-between">
            <span className="text-app-text-muted">
              {selectedCandidates.size} selected
            </span>
            <div className="flex gap-2">
              <button
                onClick={() => setStatus('idle')}
                className="px-4 py-2 bg-app-border text-app-text rounded hover:bg-app-hover transition-colors"
              >
                Run Again
              </button>
              <button
                onClick={applySelected}
                disabled={selectedCandidates.size === 0 || applying}
                className="px-4 py-2 bg-app-accent text-app-text rounded hover:bg-app-accent/80 transition-colors disabled:opacity-50 disabled:cursor-not-allowed flex items-center gap-2"
              >
                {applying ? (
                  <>
                    <Loader2 size={16} className="animate-spin" />
                    Applying...
                  </>
                ) : (
                  <>
                    <Check size={16} />
                    Add to Favorites
                  </>
                )}
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
