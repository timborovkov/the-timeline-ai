/**
 * Telegram Bot API command catalog.
 *
 * Typing `/` in a Telegram chat only shows commands registered with
 * `setMyCommands` (or BotFather `/setcommands`). The webhook dispatcher still
 * parses typed commands from message text; this catalog is what Telegram's UI
 * advertises, and it is also the source for `/help` copy so the menu and the
 * in-chat list cannot drift.
 */

export interface TelegramBotCommand {
  /** Command name without a leading slash. Telegram allows `[a-z0-9_]{1,32}`. */
  command: string;
  /** Menu description. Telegram allows 1–256 characters. */
  description: string;
  /** Full `/help` line, including the slash, usage, and summary. */
  helpLine: string;
}

export type TelegramBotCommandScopeType = 'default' | 'all_private_chats' | 'all_group_chats';

export interface TelegramBotCommandScope {
  type: TelegramBotCommandScopeType;
}

export interface TelegramBotCommandRegistration {
  scope: TelegramBotCommandScope;
  commands: Pick<TelegramBotCommand, 'command' | 'description'>[];
}

export const TELEGRAM_DM_COMMANDS: readonly TelegramBotCommand[] = [
  {
    command: 'start',
    description: 'Show connection guidance',
    helpLine: '/start           show connection guidance',
  },
  {
    command: 'ask',
    description: 'Ask the timeline',
    helpLine: '/ask <question>  backward-compatible agent alias',
  },
  {
    command: 'note',
    description: 'Save a text note',
    helpLine: '/note <text>     explicitly save a text note',
  },
  {
    command: 'new',
    description: 'Start a new agent conversation',
    helpLine: '/new             start a new agent conversation',
  },
  {
    command: 'join',
    description: 'Capture a meeting now',
    helpLine: '/join <alias-or-url> [title]  capture a meeting now',
  },
  {
    command: 'link',
    description: 'Connect this chat to a team',
    helpLine: '/link <token>    connect this DM to a team',
  },
  {
    command: 'team',
    description: 'List or switch teams',
    helpLine: '/team            list teams; /team N switches',
  },
  {
    command: 'whereami',
    description: 'Show the current team',
    helpLine: '/whereami        show current active team',
  },
  {
    command: 'unlink',
    description: 'Disconnect all teams',
    helpLine: '/unlink          disconnect all teams',
  },
  {
    command: 'help',
    description: 'Show available commands',
    helpLine: '/help            this message',
  },
];

export const TELEGRAM_GROUP_COMMANDS: readonly TelegramBotCommand[] = [
  {
    command: 'start',
    description: 'Show binding guidance',
    helpLine: '/start           show binding guidance; /start <token> binds',
  },
  {
    command: 'ask',
    description: 'Ask the timeline',
    helpLine: '/ask <question>  ask the timeline',
  },
  {
    command: 'join',
    description: 'Capture a meeting now',
    helpLine: '/join <alias-or-url> [title]  capture a meeting now',
  },
  {
    command: 'link',
    description: 'Bind this group to a team',
    helpLine: '/link <token>    bind this group to a team (admin only)',
  },
  {
    command: 'team',
    description: 'How to switch teams in a DM',
    helpLine: '/team            explain how to switch teams in a DM',
  },
  {
    command: 'whereami',
    description: 'Show the bound team',
    helpLine: '/whereami        show the bound team',
  },
  {
    command: 'unlink',
    description: 'Unbind this group',
    helpLine: '/unlink          unbind (admin only)',
  },
  {
    command: 'help',
    description: 'Show available commands',
    helpLine: '/help            this message',
  },
];

export const TELEGRAM_DM_HELP =
  `Plain text here is a private agent conversation (🤔 = answering).\n` +
  `Voice, images, and files are saved to your team's timeline (👀 = received).\n\n` +
  `Commands (DM):\n` +
  TELEGRAM_DM_COMMANDS.map((command) => command.helpLine).join('\n');

export const TELEGRAM_GROUP_HELP =
  `Plain messages here are saved to the bound team's timeline (👀 = received).\n` +
  `Use /ask to query the timeline.\n\n` +
  `Commands (group):\n` +
  TELEGRAM_GROUP_COMMANDS.map((command) => command.helpLine).join('\n');

function botApiCommands(
  specs: readonly TelegramBotCommand[],
): Pick<TelegramBotCommand, 'command' | 'description'>[] {
  return specs.map(({ command, description }) => ({ command, description }));
}

/**
 * Scopes Telegram consults when building the `/` menu. Specific scopes win over
 * `default`, so private chats get the DM list and groups get the group list.
 */
export const TELEGRAM_BOT_COMMAND_REGISTRATIONS: readonly TelegramBotCommandRegistration[] = [
  { scope: { type: 'default' }, commands: botApiCommands(TELEGRAM_DM_COMMANDS) },
  { scope: { type: 'all_private_chats' }, commands: botApiCommands(TELEGRAM_DM_COMMANDS) },
  { scope: { type: 'all_group_chats' }, commands: botApiCommands(TELEGRAM_GROUP_COMMANDS) },
];

export async function registerTelegramBotCommands(
  setMyCommands: (registration: TelegramBotCommandRegistration) => Promise<void>,
): Promise<void> {
  for (const registration of TELEGRAM_BOT_COMMAND_REGISTRATIONS) {
    await setMyCommands(registration);
  }
}
