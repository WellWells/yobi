import { boundaryForRisk, interpretGeneric } from '../toolContracts';
import type { ConfirmPolicy, ToolContract, ToolRisk } from '../toolContracts';

/*
 * The Yobi connector changes Yobi itself, so every change is confirmed, never decided by the model
 * alone: on the desktop a dialog, in a bot chat a question before it runs (`mcpAction.ts`; a bot run
 * reaches this connector only with the `manage` grant). A built-in connector has no "always allow",
 * so every change is asked each time; deleting conversations and clearing the statistics are marked
 * dangerous, and those two, installing an update and restarting stay "always" even if a built-in
 * ever gains that option. A restart
 * deletes nothing, so it stays a "modify" for the run's declared intent while still always asked.
 */

function contract(tool: string, risk: ToolRisk, confirm: ConfirmPolicy): ToolContract {
  return {
    risk: () => risk,
    boundary: () => boundaryForRisk(risk),
    confirm: () => confirm,
    interpret: (text, isError) => interpretGeneric(text, isError, tool),
    // Result lines name changes only; a read is named by `settings.mcp.tool.*` like every built-in.
    ...(risk === 'read' ? {} : { titleKey: `agent.tool.yobi.${tool}` }),
  };
}

type Args = Record<string, unknown>;

type Precheck = (args: Args) => Promise<string | null>;

let settingsPrecheck: Precheck | null = null;

/** Set by the live connection (`yobiConnection.ts`): checks setting ids and values against the catalog. */
export function setYobiSettingsPrecheck(check: Precheck): void {
  settingsPrecheck = check;
}

export const YOBI_CONTRACTS: Readonly<Record<string, ToolContract>> = {
  // Named here, not left to the verbs: "update" in yobi_check_update would read as a write.
  yobi_overview: contract('yobi_overview', 'read', 'never'),
  yobi_list_flows: contract('yobi_list_flows', 'read', 'never'),
  yobi_list_models: contract('yobi_list_models', 'read', 'never'),
  yobi_list_conversations: contract('yobi_list_conversations', 'read', 'never'),
  yobi_check_update: contract('yobi_check_update', 'read', 'never'),
  // Sends one tiny request per key and changes nothing; "test" alone says nothing about writing.
  yobi_test_api_keys: contract('yobi_test_api_keys', 'read', 'never'),
  yobi_set_flows_enabled: contract('yobi_set_flows_enabled', 'mutating', 'ask'),
  yobi_set_model: contract('yobi_set_model', 'mutating', 'ask'),
  yobi_get_settings: contract('yobi_get_settings', 'read', 'never'),
  // A wrong id or value is sent back before the user is asked, not after they approved it.
  yobi_set_settings: { ...contract('yobi_set_settings', 'mutating', 'ask'), precheck: async (args) => (settingsPrecheck ? settingsPrecheck(args) : null) },
  yobi_delete_conversations: contract('yobi_delete_conversations', 'destructive', 'always'),
  yobi_reset_statistics: contract('yobi_reset_statistics', 'destructive', 'always'),
  yobi_install_update: contract('yobi_install_update', 'mutating', 'always'),
  yobi_restart: contract('yobi_restart', 'mutating', 'always'),
};
