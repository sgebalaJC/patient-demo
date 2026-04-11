/**
 * Slack channel management for the OpenClaw agent.
 *
 * All logic is browser-side: the sidecar exposes generic /config PATCH +
 * /restart, and we compose the Slack-specific patch here. This keeps the
 * sidecar binary untouched when adding new channels.
 *
 * Binding: channels.slack.accounts.main → agent `main` (Aurelia).
 * Tokens live only in openclaw.json on the OpenClaw host.
 *
 * IMPORTANT: OpenClaw's schema validator rejects unknown fields under
 * channels.slack.accounts.<id>. Never write cache/metadata fields there —
 * only the schema-known keys (botToken, appToken, dmPolicy, allowFrom,
 * groupPolicy, etc). Workspace name is fetched fresh from Slack on demand.
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
  /** Only populated after an auth.test round-trip. Undefined if fetch failed. */
  workspace?: SlackWorkspace;
}

interface OpenClawConfigShape {
  bindings?: Array<Record<string, unknown>>;
  channels?: {
    slack?: {
      enabled?: boolean;
      accounts?: Record<string, {
        botToken?: string;
        appToken?: string;
      }>;
    };
  };
}

/**
 * Read current Slack channel state. If Slack is enabled, round-trips to
 * Slack (via the sidecarProxy CF) to fetch a fresh workspace name — we do
 * NOT cache the workspace name in the config because OpenClaw's schema
 * validator rejects unknown fields under accounts.<id>.
 */
export async function readSlackStatus(
  config: Record<string, unknown>,
): Promise<SlackChannelStatus> {
  const slack = (config as OpenClawConfigShape).channels?.slack;
  const account = slack?.accounts?.[SLACK_ACCOUNT_ID];
  const botToken = account?.botToken;
  const enabled = slack?.enabled === true && !!botToken;
  if (!enabled || !botToken) return { enabled: false };

  try {
    const workspace = await validateSlackToken(botToken);
    return { enabled: true, workspace };
  } catch {
    // Token saved but Slack rejected or was unreachable — still show connected.
    return { enabled: true };
  }
}

/**
 * Validate a Slack bot token and fetch workspace metadata.
 *
 * Routed through the sidecarProxy Cloud Function (server-side fetch), because
 * slack.com/api/auth.test blocks browser CORS preflight requests carrying an
 * Authorization header. See functions/src/index.ts sidecarProxy /slack/auth-test.
 */
export async function validateSlackToken(botToken: string): Promise<SlackWorkspace> {
  const data = await sidecar.slackAuthTest(botToken);
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

  // NOTE: only write schema-known fields (botToken, appToken, dmPolicy,
  // allowFrom, groupPolicy). OpenClaw's validator rejects unknown properties
  // under accounts.<id> and refuses to load the gateway.
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
            groupPolicy: 'open',
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
