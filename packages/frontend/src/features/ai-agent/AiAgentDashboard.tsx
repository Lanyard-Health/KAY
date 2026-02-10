import { useState } from 'react';
import toast from 'react-hot-toast';
import { SparklesIcon, ChatBubbleLeftRightIcon } from '@heroicons/react/24/outline';
import {
  useAiStatus,
  useAiUsage,
  useAiRecommendations,
  useAnalyzePortfolio,
  useGenerateEmail,
  useUpdateRecommendation,
} from '../../hooks/useAi';
import type { PortfolioItem, AiRecommendation } from '../../hooks/useAi';
import AiEmailPreviewModal from './AiEmailPreviewModal';
import ChatPanel from './ChatPanel';

// ===========================
// Helpers
// ===========================

function urgencyColor(score: number): string {
  if (score >= 8) return 'bg-red-100 text-red-800';
  if (score >= 6) return 'bg-orange-100 text-orange-800';
  if (score >= 4) return 'bg-yellow-100 text-yellow-800';
  return 'bg-green-100 text-green-800';
}

function riskBadgeColor(level: string): string {
  switch (level) {
    case 'critical': return 'bg-red-100 text-red-800';
    case 'high': return 'bg-orange-100 text-orange-800';
    case 'medium': return 'bg-yellow-100 text-yellow-800';
    case 'low': return 'bg-green-100 text-green-800';
    default: return 'bg-gray-100 text-gray-800';
  }
}

// ===========================
// Main Dashboard
// ===========================

export default function AiAgentDashboard() {
  const { data: statusResp, isLoading: statusLoading } = useAiStatus();
  const { data: usageResp } = useAiUsage();
  const { data: recsResp, isLoading: recsLoading } = useAiRecommendations({ status: 'pending' });

  const analyzePortfolio = useAnalyzePortfolio();
  const generateEmail = useGenerateEmail();
  const updateRecommendation = useUpdateRecommendation();

  const [portfolioResults, setPortfolioResults] = useState<PortfolioItem[] | null>(null);
  const [portfolioSummary, setPortfolioSummary] = useState('');

  const [activeTab, setActiveTab] = useState<'dashboard' | 'chat'>('dashboard');

  const [emailModal, setEmailModal] = useState<{
    isOpen: boolean;
    enrollmentId: string;
    recommendationId: string;
    providerName: string;
    payerName: string;
    email: any;
  } | null>(null);

  const status = statusResp?.data;
  const usage = usageResp?.data;
  const recommendations = recsResp?.data || [];

  const handleRunPortfolioAnalysis = async () => {
    try {
      const result = await analyzePortfolio.mutateAsync();
      setPortfolioResults(result.data.analysis.enrollments);
      setPortfolioSummary(result.data.analysis.summary);
    } catch (err: unknown) {
      toast.error(`Analysis failed: ${err instanceof Error ? err.message : 'Unknown error'}`);
    }
  };

  const handleGenerateEmail = async (enrollmentId: string, providerName: string, payerName: string) => {
    try {
      const result = await generateEmail.mutateAsync({ enrollmentId });
      setEmailModal({
        isOpen: true,
        enrollmentId,
        recommendationId: result.data.recommendation.id,
        providerName,
        payerName,
        email: result.data.email,
      });
    } catch (err: unknown) {
      toast.error(`Email generation failed: ${err instanceof Error ? err.message : 'Unknown error'}`);
    }
  };

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center gap-3">
        <SparklesIcon className="h-8 w-8 text-purple-600" />
        <div>
          <h1 className="text-2xl font-bold text-gray-900">AI Enrollment Agent</h1>
          <p className="text-sm text-gray-500">
            AI-powered recommendations for follow-up emails, enrollment strategy, and priority management
          </p>
        </div>
      </div>

      {/* Status Bar */}
      <div className="rounded-lg bg-white shadow p-4">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-4">
            <div className="flex items-center gap-2">
              <div className={`h-2.5 w-2.5 rounded-full ${status?.configured ? 'bg-green-500' : 'bg-red-500'}`} />
              <span className="text-sm text-gray-600">
                {statusLoading ? 'Checking...' : status?.configured ? 'AI Connected' : 'AI Not Configured'}
              </span>
            </div>
            {status?.configured && <span className="text-xs text-gray-400">Model: {status.model}</span>}
          </div>
          {usage && (
            <div className="flex items-center gap-3">
              <span className="text-xs text-gray-500">
                Today: {usage.budget.used.toLocaleString()} / {usage.budget.daily.toLocaleString()} tokens
              </span>
              <div className="w-32 h-2 bg-gray-200 rounded-full overflow-hidden">
                <div
                  className={`h-full rounded-full transition-all ${
                    usage.budget.percentUsed > 90 ? 'bg-red-500' : usage.budget.percentUsed > 70 ? 'bg-yellow-500' : 'bg-green-500'
                  }`}
                  style={{ width: `${Math.min(100, usage.budget.percentUsed)}%` }}
                />
              </div>
              <span className="text-xs text-gray-400">{usage.budget.percentUsed}%</span>
            </div>
          )}
        </div>
      </div>

      {/* Tabs */}
      <div className="border-b border-gray-200">
        <nav className="-mb-px flex gap-6">
          <button
            onClick={() => setActiveTab('dashboard')}
            className={`flex items-center gap-2 border-b-2 px-1 py-3 text-sm font-medium transition-colors ${
              activeTab === 'dashboard'
                ? 'border-purple-600 text-purple-600'
                : 'border-transparent text-gray-500 hover:border-gray-300 hover:text-gray-700'
            }`}
          >
            <SparklesIcon className="h-4 w-4" />
            Dashboard
          </button>
          <button
            onClick={() => setActiveTab('chat')}
            className={`flex items-center gap-2 border-b-2 px-1 py-3 text-sm font-medium transition-colors ${
              activeTab === 'chat'
                ? 'border-purple-600 text-purple-600'
                : 'border-transparent text-gray-500 hover:border-gray-300 hover:text-gray-700'
            }`}
          >
            <ChatBubbleLeftRightIcon className="h-4 w-4" />
            Chat
          </button>
        </nav>
      </div>

      {/* Tab Content */}
      {activeTab === 'chat' ? (
        <ChatPanel />
      ) : (
      <>
      {/* Portfolio Priority List */}
      <div className="rounded-lg bg-white shadow">
        <div className="flex items-center justify-between border-b border-gray-200 px-6 py-4">
          <h2 className="text-lg font-semibold text-gray-900">Portfolio Priority List</h2>
          <button
            onClick={handleRunPortfolioAnalysis}
            disabled={analyzePortfolio.isPending || !status?.configured}
            className="inline-flex items-center gap-2 rounded-md bg-purple-600 px-4 py-2 text-sm font-medium text-white hover:bg-purple-700 disabled:opacity-50"
          >
            {analyzePortfolio.isPending ? (
              <>
                <div className="animate-spin rounded-full h-4 w-4 border-b-2 border-white" />
                Analyzing...
              </>
            ) : (
              <>
                <SparklesIcon className="h-4 w-4" />
                Run Analysis
              </>
            )}
          </button>
        </div>

        {portfolioSummary && (
          <div className="px-6 py-3 bg-purple-50 border-b border-purple-100">
            <p className="text-sm text-purple-800">{portfolioSummary}</p>
          </div>
        )}

        {portfolioResults && portfolioResults.length > 0 ? (
          <div className="overflow-x-auto">
            <table className="min-w-full divide-y divide-gray-200">
              <thead className="bg-gray-50">
                <tr>
                  <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Priority</th>
                  <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Provider</th>
                  <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Payer</th>
                  <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Status</th>
                  <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Days Since App</th>
                  <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Recommendation</th>
                  <th className="px-6 py-3 text-right text-xs font-medium text-gray-500 uppercase tracking-wider">Actions</th>
                </tr>
              </thead>
              <tbody className="bg-white divide-y divide-gray-200">
                {portfolioResults.map((item, index) => (
                  <tr key={item.enrollmentId} className="hover:bg-gray-50">
                    <td className="px-6 py-4 whitespace-nowrap">
                      <div className="flex items-center gap-2">
                        <span className="text-sm text-gray-400 font-mono">#{index + 1}</span>
                        <span className={`inline-flex items-center justify-center w-8 h-8 rounded-full text-sm font-bold ${urgencyColor(item.urgencyScore)}`}>
                          {item.urgencyScore}
                        </span>
                        <span className={`inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium ${riskBadgeColor(item.riskLevel)}`}>
                          {item.riskLevel}
                        </span>
                      </div>
                    </td>
                    <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-900">{item.providerName}</td>
                    <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-900">{item.payerName}</td>
                    <td className="px-6 py-4 whitespace-nowrap">
                      <span className="inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-medium bg-blue-100 text-blue-800">
                        {item.status.replace('_', ' ')}
                      </span>
                    </td>
                    <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-500">{item.daysSinceApplication ?? '-'}</td>
                    <td className="px-6 py-4 text-sm text-gray-600 max-w-xs truncate" title={item.recommendation}>
                      {item.recommendation}
                    </td>
                    <td className="px-6 py-4 whitespace-nowrap text-right">
                      <button
                        onClick={() => handleGenerateEmail(item.enrollmentId, item.providerName, item.payerName)}
                        disabled={generateEmail.isPending}
                        className="inline-flex items-center gap-1 text-sm text-purple-600 hover:text-purple-800 font-medium disabled:opacity-50"
                      >
                        <SparklesIcon className="h-4 w-4" />
                        Draft Email
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : portfolioResults && portfolioResults.length === 0 ? (
          <div className="px-6 py-12 text-center text-gray-500">No active enrollments to analyze.</div>
        ) : (
          <div className="px-6 py-12 text-center text-gray-400">
            Click "Run Analysis" to prioritize your enrollment portfolio.
          </div>
        )}
      </div>

      {/* Pending Recommendations */}
      <div className="rounded-lg bg-white shadow">
        <div className="border-b border-gray-200 px-6 py-4">
          <h2 className="text-lg font-semibold text-gray-900">
            Pending Recommendations
            {recommendations.length > 0 && (
              <span className="ml-2 inline-flex items-center rounded-full bg-purple-100 px-2.5 py-0.5 text-xs font-medium text-purple-800">
                {recommendations.length}
              </span>
            )}
          </h2>
        </div>

        {recsLoading ? (
          <div className="flex items-center justify-center py-8">
            <div className="animate-spin rounded-full h-6 w-6 border-b-2 border-primary-600" />
          </div>
        ) : recommendations.length > 0 ? (
          <div className="divide-y divide-gray-200">
            {recommendations.map((rec: AiRecommendation) => (
              <RecommendationCard
                key={rec.id}
                recommendation={rec}
                onAccept={() => updateRecommendation.mutate({ id: rec.id, status: 'accepted' })}
                onDismiss={() => updateRecommendation.mutate({ id: rec.id, status: 'dismissed' })}
              />
            ))}
          </div>
        ) : (
          <div className="px-6 py-8 text-center text-gray-400">
            No pending recommendations. Generate emails or run analysis to create some.
          </div>
        )}
      </div>

      </>
      )}

      {/* Email Modal */}
      {emailModal?.isOpen && (
        <AiEmailPreviewModal
          isOpen
          onClose={() => setEmailModal(null)}
          email={emailModal.email}
          enrollmentId={emailModal.enrollmentId}
          recommendationId={emailModal.recommendationId}
          providerName={emailModal.providerName}
          payerName={emailModal.payerName}
        />
      )}
    </div>
  );
}

// ===========================
// Recommendation Card
// ===========================

function RecommendationCard({
  recommendation,
  onAccept,
  onDismiss,
}: {
  recommendation: AiRecommendation;
  onAccept: () => void;
  onDismiss: () => void;
}) {
  const [expanded, setExpanded] = useState(false);

  const typeLabels: Record<string, string> = {
    follow_up_email: 'Follow-Up Email',
    strategy: 'Strategy',
    priority_alert: 'Priority Alert',
  };

  const typeColors: Record<string, string> = {
    follow_up_email: 'bg-blue-100 text-blue-800',
    strategy: 'bg-green-100 text-green-800',
    priority_alert: 'bg-orange-100 text-orange-800',
  };

  return (
    <div className="px-6 py-4">
      <div className="flex items-start justify-between">
        <div className="flex-1">
          <div className="flex items-center gap-2 mb-1">
            <span className={`inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium ${typeColors[recommendation.type] || 'bg-gray-100 text-gray-800'}`}>
              {typeLabels[recommendation.type] || recommendation.type}
            </span>
            <span className="text-xs text-gray-400">
              {new Date(recommendation.createdAt).toLocaleDateString()}{' '}
              {new Date(recommendation.createdAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
            </span>
          </div>
          <h3 className="text-sm font-medium text-gray-900">{recommendation.title}</h3>
          <p className="text-xs text-gray-500 mt-0.5">
            {recommendation.enrollment.provider.firstName} {recommendation.enrollment.provider.lastName} →{' '}
            {recommendation.enrollment.payer.name}
          </p>

          {recommendation.reasoning && (
            <button onClick={() => setExpanded(!expanded)} className="mt-1 text-xs text-gray-400 hover:text-gray-600">
              {expanded ? 'Hide details' : 'Show details'}
            </button>
          )}

          {expanded && recommendation.reasoning && (
            <div className="mt-2 text-xs text-gray-600 bg-gray-50 rounded p-2">{recommendation.reasoning}</div>
          )}
        </div>

        <div className="flex items-center gap-2 ml-4">
          <button
            onClick={onAccept}
            className="inline-flex items-center rounded-md bg-green-50 px-2.5 py-1.5 text-xs font-medium text-green-700 hover:bg-green-100"
          >
            Accept
          </button>
          <button
            onClick={onDismiss}
            className="inline-flex items-center rounded-md bg-gray-50 px-2.5 py-1.5 text-xs font-medium text-gray-700 hover:bg-gray-100"
          >
            Dismiss
          </button>
        </div>
      </div>
    </div>
  );
}
