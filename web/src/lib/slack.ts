/**
 * Slack channel management for the OpenClaw agent.
 *
 * All logic is browser-side: the sidecar exposes generic /config PATCH +
 * /restart, and we compose the Slack-specific patch here. This keeps the
 * sidecar binary untouched when adding new channels.
 *
 * Binding: channels.slack.accounts.main → agent `main` (Aurelia).
 * Tokens live only in openclaw.json on the OpenClaw host.
 */

import { sidecar } from './sidecar';

export const SLACK_ACCOUNT_ID = 'main';
export const SLACK_AGENT_ID = 'main';

export interface SlackWorkspace {
  name?: string;
  teamId?: string;
}

export interface SlackChannelStatus {
  enabled: boolean;
  workspace?: SlackWorkspace;
}

interface SlackAuthTestResponse {
  ok: boolean;
  team?: string;
  team_id?: string;
  error?: string;
}

interface OpenClawConfigShape {
  bindings?: Array<Record<string, unknown>>;
  channels?: {
    slack?: {
      enabled?: boolean;
      accounts?: Record<string, {
        botToken?: string;
        appToken?: string;
        workspaceName?: string;
        workspaceTeamId?: string;
      }>;
    };
  };
}

/** Read current Slack channel state from the OpenClaw config. No network cost beyond getConfig. */
export function readSlackStatus(config: Record<string, unknown>): SlackChannelStatus {
  const slack = (config as OpenClawConfigShape).channels?.slack;
  const account = slack?.accounts?.[SLACK_ACCOUNT_ID];
  const enabled = slack?.enabled === true && !!account?.botToken;
  if (!enabled) return { enabled: false };
  return {
    enabled: true,
    workspace: {
      name: account?.workspaceName,
      teamId: account?.workspaceTeamId,
    },
  };
}

/** Call slack.com/api/auth.test to validate a bot token and fetch workspace metadata. */
export async function validateSlackToken(botToken: string): Promise<SlackWorkspace> {
  let res: Response;
  try {
    res = await fetch('https://slack.com/api/auth.test', {
      method: 'POST',
      headers: { Authorization: `Bearer ${botToken}` },
      signal: AbortSignal.timeout(10_000),
    });
  } catch (err) {
    if (err instanceof DOMException && err.name === 'TimeoutError') {
      throw new Error('Slack took too long to respond');
    }
    throw new Error('Could not reach Slack. Check your network and CORS.');
  }

  const data = (await res.json().catch(() => ({}))) as SlackAuthTestResponse;
  if (!data.ok) {
    throw new Error(`Slack rejected the bot token${data.error ? `: ${data.error}` : ''}`);
  }
  return { name: data.team, teamId: data.team_id };
}

/** Upsert the slack/main binding, preserving any other bindings verbatim. */
function upsertSlackBinding(
  current: Array<Record<string, unknown>> | undefined,
): Array<Record<string, unknown>> {
  const kept = (current ?? []).filter((b) => {
    const match = b.match as { channel?: string; accountId?: string } | undefined;
    return !(match?.channel === 'slack' && match?.accountId === SLACK_ACCOUNT_ID);
  });
  return [
    ...kept,
    {
      type: 'route',
      agentId: SLACK_AGENT_ID,
      match: { channel: 'slack', accountId: SLACK_ACCOUNT_ID },
    },
  ];
}

/** Strip any slack binding — used on disconnect. */
function stripSlackBindings(
  current: Array<Record<string, unknown>> | undefined,
): Array<Record<string, unknown>> {
  return (current ?? []).filter((b) => {
    const match = b.match as { channel?: string } | undefined;
    return match?.channel !== 'slack';
  });
}

/**
 * End-to-end Slack connect: validate tokens, read config, compose patch, restart gateway.
 * Returns the resolved workspace info from Slack.
 */
export async function configureSlack(
  botToken: string,
  appToken: string,
): Promise<SlackWorkspace> {
  const trimmedBot = botToken.trim();
  const trimmedApp = appToken.trim();
  if (!trimmedBot.startsWith('xoxb-')) {
    throw new Error('Bot token must start with xoxb-');
  }
  if (!trimmedApp.startsWith('xapp-')) {
    throw new Error('App token must start with xapp-');
  }

  const workspace = await validateSlackToken(trimmedBot);

  const current = (await sidecar.getConfig()) as OpenClawConfigShape;
  const bindings = upsertSlackBinding(current.bindings);

  await sidecar.patchConfig({
    channels: {
      slack: {
        enabled: true,
        groupPolicy: 'open',
        accounts: {
          [SLACK_ACCOUNT_ID]: {
            botToken: trimmedBot,
            appToken: trimmedApp,
            dmPolicy: 'open',
            allowFrom: ['*'],
            // Cached workspace metadata so the status read is free.
            workspaceName: workspace.name,
            workspaceTeamId: workspace.teamId,
          },
        },
      },
    },
    bindings,
  });

  // Fire-and-forget restart — gateway picks up the new channel config on boot.
  // We don't await health because /restart already waits up to 30s internally;
  // the caller polls getConfig afterwards to confirm.
  await sidecar.restart();

  return workspace;
}

/** Disconnect: wipe tokens, flip enabled:false, strip binding, restart. */
export async function disconnectSlack(): Promise<void> {
  const current = (await sidecar.getConfig()) as OpenClawConfigShape;
  const bindings = stripSlackBindings(current.bindings);

  await sidecar.patchConfig({
    channels: {
      slack: {
        enabled: false,
        accounts: {
          [SLACK_ACCOUNT_ID]: {
            botToken: '',
            appToken: '',
            workspaceName: '',
            workspaceTeamId: '',
            allowFrom: [],
          },
        },
      },
    },
    bindings,
  });

  await sidecar.restart();
}

/**
 * Slack app manifest — admin copies this into api.slack.com/apps when creating
 * a new Slack app via "From a manifest". Keep scopes in sync with what the
 * OpenClaw slack extension actually uses.
 */
export function buildSlackManifest(displayName: string): Record<string, unknown> {
  return {
    display_information: {
      name: displayName,
      description: `${displayName} — practice assistant`,
      background_color: '#1a1d27',
    },
    features: {
      app_home: {
        messages_tab_enabled: true,
        messages_tab_read_only_enabled: false,
      },
      bot_user: { display_name: displayName, always_online: true },
    },
    oauth_config: {
      scopes: {
        bot: [
          'app_mentions:read',
          'channels:history',
          'channels:join',
          'channels:read',
          'chat:write',
          'groups:history',
          'groups:read',
          'im:history',
          'im:read',
          'im:write',
          'mpim:history',
          'mpim:read',
          'reactions:read',
          'reactions:write',
          'users:read',
          'files:read',
          'files:write',
        ],
      },
    },
    settings: {
      event_subscriptions: {
        bot_events: [
          'app_mention',
          'message.channels',
          'message.groups',
          'message.im',
          'message.mpim',
          'reaction_added',
        ],
      },
      interactivity: { is_enabled: false },
      org_deploy_enabled: false,
      socket_mode_enabled: true,
      token_rotation_enabled: false,
    },
  };
}
