/**
 * The Slack app the settings page tells the user to create ("From an app manifest"): Socket Mode
 * on, so no Request URL; the two events the bot answers (`app_mention` in channels, `message.im`
 * in DMs) and no channel history, so it never reads what nobody said to it; interactivity for its
 * buttons; the Messages tab so people can DM it. Each scope is for one call the bot makes.
 */
export const SLACK_BOT_SCOPES = [
  'app_mentions:read',
  'chat:write',
  'im:history',
  'im:read',
  'im:write',
  'users:read',
  'channels:read',
  'groups:read',
  'files:write',
] as const;

export const SLACK_BOT_EVENTS = ['app_mention', 'message.im'] as const;

export function slackAppManifest(name = 'Yobi'): string {
  return JSON.stringify({
    display_information: { name },
    features: {
      app_home: { home_tab_enabled: false, messages_tab_enabled: true, messages_tab_read_only_enabled: false },
      bot_user: { display_name: name, always_online: true },
    },
    oauth_config: { scopes: { bot: [...SLACK_BOT_SCOPES] } },
    settings: {
      event_subscriptions: { bot_events: [...SLACK_BOT_EVENTS] },
      interactivity: { is_enabled: true },
      org_deploy_enabled: false,
      socket_mode_enabled: true,
      token_rotation_enabled: false,
    },
  }, null, 2);
}
