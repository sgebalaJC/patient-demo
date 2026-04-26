import React, { useEffect, useRef, useState } from 'react';
import { httpsCallable } from 'firebase/functions';
import { CheckCircle2, AlertTriangle, Rocket, RefreshCw, Loader2 } from 'lucide-react';
import { functions } from '../../lib/firebase';
import { Button } from '../ui/Button';
import { installedIntegrationsOps, type InstalledIntegration } from '../../lib/firestore/installed-integrations';

/**
 * Per-integration deployment status + auto-deploy.
 *
 * Status check: which Cloud Functions for this integration group are present
 * in the project. "Deploy" button submits a Cloud Build job that runs
 * `firebase deploy --only functions:<list>` from the source bundle uploaded
 * by installer step 12b. UI polls build status until SUCCESS/FAILURE.
 *
 * Polling caps at MAX_POLL_MS — beyond that the UI surfaces a "still
 * running" message and stops paying for callable invocations. The
 * reconcileStuckIntegrationDeploys scheduled function will reconcile the
 * Firestore mirror within 30 minutes of staleness, so the live-subscription
 * picks up the terminal state without any UI poll.
 */

interface DeployStatus {
  integrationId: string;
  expected: string[];
  deployed: string[];
  missing: string[];
  deployCommand: string;
}

interface BuildStatus {
  buildId: string;
  status: string;
  logUrl?: string;
}

interface IntegrationDeployControlProps {
  /** Group id from installer/cli/lib/function-groups.ts (e.g. 'ehr-drchrono', 'signalwire'). */
  integrationId: string;
  /** Compact display when shown next to the integration's main controls. */
  compact?: boolean;
}

const TERMINAL_STATUSES = new Set(['SUCCESS', 'FAILURE', 'INTERNAL_ERROR', 'TIMEOUT', 'CANCELLED', 'EXPIRED']);
const POLL_INTERVAL_MS = 5_000;
const MAX_POLL_MS = 30 * 60 * 1000;

export const IntegrationDeployControl: React.FC<IntegrationDeployControlProps> = ({
  integrationId,
  compact,
}) => {
  const [status, setStatus] = useState<DeployStatus | null>(null);
  const [installed, setInstalled] = useState<InstalledIntegration | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string>('');
  const [build, setBuild] = useState<BuildStatus | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [pollExpired, setPollExpired] = useState(false);
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const pollDeadlineRef = useRef<number>(0);
  // `alive` guards async setStatus calls against an unmounted component or a
  // mid-flight integrationId change. Without it, a slow callable response
  // for a previous integration would land in the new component instance.
  const aliveRef = useRef(true);

  const stopPolling = () => {
    if (pollRef.current) {
      clearInterval(pollRef.current);
      pollRef.current = null;
    }
  };

  const refresh = async () => {
    setLoading(true);
    setError('');
    try {
      const fn = httpsCallable<{ integrationId: string }, DeployStatus>(
        functions!,
        'getIntegrationFunctionStatus',
      );
      const r = await fn({ integrationId });
      if (!aliveRef.current) return;
      setStatus(r.data);
    } catch (err) {
      if (!aliveRef.current) return;
      setError(err instanceof Error ? err.message : 'Failed to fetch status');
    } finally {
      if (aliveRef.current) setLoading(false);
    }
  };

  useEffect(() => {
    aliveRef.current = true;
    void refresh();
    // Live-subscribe to the installed-integrations doc so the build's
    // terminal status (deployed/failed + bundle version) appears as soon
    // as the Cloud Build's final step PATCHes Firestore — even if the UI
    // poll loop missed it.
    const unsub = installedIntegrationsOps.subscribe(integrationId, (next) => {
      if (aliveRef.current) setInstalled(next);
    });
    return () => {
      aliveRef.current = false;
      unsub();
      stopPolling();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [integrationId]);

  const handleDeploy = async () => {
    setSubmitting(true);
    setError('');
    setBuild(null);
    setPollExpired(false);
    try {
      const enableFn = httpsCallable<{ integrationId: string }, { buildId?: string }>(
        functions!,
        'enableIntegration',
      );
      const r = await enableFn({ integrationId });
      // The component may have unmounted (or integrationId changed) while
      // the callable was in flight. Don't update state in either case;
      // the next mount's effect will run its own status check.
      if (!aliveRef.current) return;
      const buildId = r.data?.buildId;
      if (!buildId || typeof buildId !== 'string' || buildId.length === 0) {
        throw new Error('enableIntegration returned no buildId');
      }
      const initial: BuildStatus = { buildId, status: 'QUEUED' };
      setBuild(initial);

      // Poll every 5s until terminal OR until MAX_POLL_MS elapses.
      // Always clear any prior interval before installing a new one — a
      // double-click race would otherwise leak the previous interval.
      stopPolling();
      pollDeadlineRef.current = Date.now() + MAX_POLL_MS;
      const statusFn = httpsCallable<{ buildId: string }, BuildStatus>(functions!, 'getDeployBuildStatus');
      pollRef.current = setInterval(async () => {
        if (!aliveRef.current) {
          stopPolling();
          return;
        }
        if (Date.now() > pollDeadlineRef.current) {
          stopPolling();
          setPollExpired(true);
          return;
        }
        try {
          const s = await statusFn({ buildId });
          if (!aliveRef.current) return;
          setBuild(s.data);
          if (TERMINAL_STATUSES.has(s.data.status)) {
            stopPolling();
            void refresh();
          }
        } catch (err) {
          if (!aliveRef.current) return;
          stopPolling();
          setError(err instanceof Error ? err.message : 'Status poll failed');
        }
      }, POLL_INTERVAL_MS);
    } catch (err) {
      if (!aliveRef.current) return;
      setError(err instanceof Error ? err.message : 'Deploy failed to start');
    } finally {
      if (aliveRef.current) setSubmitting(false);
    }
  };

  if (loading && !status) {
    return <span className="text-xs text-secondary-500">Checking deploy status…</span>;
  }
  if (error && !status) {
    return <span className="text-xs text-rose-600">Status check failed: {error}</span>;
  }
  if (!status) return null;

  const allDeployed = status.missing.length === 0;
  const partial = status.deployed.length > 0 && status.missing.length > 0;
  const buildInProgress = !!build && !TERMINAL_STATUSES.has(build.status);
  const buildSucceeded = build?.status === 'SUCCESS';
  const buildFailed = !!build && TERMINAL_STATUSES.has(build.status) && build.status !== 'SUCCESS';
  const remoteDeploying = installed?.status === 'deploying';
  // Disable the deploy button across every concurrent-deploy vector: the
  // local submit-in-progress AND the remote in-flight build (which the
  // installed-integrations live-sub surfaces). Without the second clause a
  // page reload mid-build would re-enable the button and let the operator
  // start a second deploy on top of an already-running one.
  const deployDisabled = submitting || buildInProgress || remoteDeploying;

  if (compact) {
    return (
      <span
        className={`inline-flex items-center gap-1 text-xs ${
          allDeployed ? 'text-emerald-700' : partial ? 'text-amber-700' : 'text-rose-700'
        }`}
      >
        {allDeployed ? (
          <CheckCircle2 className="h-3.5 w-3.5" />
        ) : (
          <AlertTriangle className="h-3.5 w-3.5" />
        )}
        {status.deployed.length}/{status.expected.length} fns
      </span>
    );
  }

  return (
    <div className="rounded-md border border-secondary-200 bg-secondary-50 p-3 space-y-2">
      <div className="flex items-center justify-between gap-2">
        <div className="flex items-center gap-2 text-sm">
          {allDeployed ? (
            <>
              <CheckCircle2 className="h-4 w-4 text-emerald-600" />
              <span className="text-emerald-700 font-medium">
                All {status.expected.length} functions deployed
              </span>
            </>
          ) : (
            <>
              <AlertTriangle className="h-4 w-4 text-amber-600" />
              <span className="text-amber-700 font-medium">
                {status.deployed.length} of {status.expected.length} functions deployed
              </span>
            </>
          )}
        </div>
        <Button variant="ghost" onClick={refresh} disabled={loading || buildInProgress}>
          <RefreshCw className={`h-4 w-4 ${loading ? 'animate-spin' : ''}`} />
        </Button>
      </div>

      {!allDeployed && !buildInProgress && !buildSucceeded && (
        <div className="space-y-2">
          <p className="text-xs text-secondary-600">
            Click Deploy to auto-install the {status.missing.length} missing function(s) — runs in
            Cloud Build (~3 min). Source pulled from{' '}
            <code className="bg-secondary-100 px-1 py-0.5 rounded">
              gs://&lt;project&gt;-installer-source/functions-source.tar.gz
            </code>{' '}
            (uploaded by installer step 12b).
          </p>
          <div className="flex items-center gap-2">
            <Button onClick={handleDeploy} disabled={deployDisabled}>
              <Rocket className="h-4 w-4 mr-1" />
              Deploy {status.missing.length} function{status.missing.length !== 1 ? 's' : ''}
            </Button>
            <details className="text-xs text-secondary-500">
              <summary className="cursor-pointer">Or run locally</summary>
              <pre className="bg-secondary-900 text-secondary-100 text-xs p-2 rounded mt-1 overflow-x-auto">
                {status.deployCommand}
              </pre>
            </details>
          </div>
          {remoteDeploying && (
            <p className="text-xs text-amber-700">
              A deploy submitted from another tab is still in progress. Wait for it to
              finish before starting another.
            </p>
          )}
        </div>
      )}

      {buildInProgress && build && (
        <div className="flex items-center gap-2 text-sm text-blue-700">
          <Loader2 className="h-4 w-4 animate-spin" />
          <span>
            Cloud Build {build.buildId ? build.buildId.slice(0, 12) : '?'}… status:{' '}
            <strong>{build.status}</strong>
          </span>
          {build.logUrl && (
            <a href={build.logUrl} target="_blank" rel="noreferrer" className="text-blue-600 underline text-xs">
              logs ↗
            </a>
          )}
        </div>
      )}

      {pollExpired && (
        <p className="text-xs text-amber-700">
          Build still running after 30 minutes — UI stopped polling. Check the Cloud
          Build console; the live status will update automatically when it finishes.
        </p>
      )}

      {buildSucceeded && build && (
        <div className="flex items-center gap-2 text-sm text-emerald-700">
          <CheckCircle2 className="h-4 w-4" />
          <span>Deploy succeeded.</span>
          {build.logUrl && (
            <a href={build.logUrl} target="_blank" rel="noreferrer" className="text-blue-600 underline text-xs">
              logs ↗
            </a>
          )}
        </div>
      )}

      {installed && allDeployed && (
        <div className="text-xs text-secondary-500 space-y-0.5">
          {installed.deployedAt && (
            <div>
              Deployed {installed.deployedAt.toDate().toLocaleString()}
              {installed.deployedFromBundle && (
                <>
                  {' '}from bundle{' '}
                  <code className="bg-secondary-100 px-1 py-0.5 rounded">{installed.deployedFromBundle}</code>
                </>
              )}
            </div>
          )}
          {installed.lastBuildId && installed.lastBuildStatus && (
            <div>
              Last build {installed.lastBuildId.slice(0, 12)}: <strong>{installed.lastBuildStatus}</strong>
            </div>
          )}
        </div>
      )}

      {buildFailed && build && (
        <div className="text-sm text-rose-700">
          <div className="flex items-center gap-2">
            <AlertTriangle className="h-4 w-4" />
            <span>
              Deploy failed: <strong>{build.status}</strong>
            </span>
            {build.logUrl && (
              <a href={build.logUrl} target="_blank" rel="noreferrer" className="text-blue-600 underline text-xs">
                logs ↗
              </a>
            )}
          </div>
          <p className="text-xs mt-1">Re-run via the Deploy button or run the command locally.</p>
        </div>
      )}

      {error && status && (
        <p className="text-xs text-rose-600">Note: {error}</p>
      )}
    </div>
  );
};
