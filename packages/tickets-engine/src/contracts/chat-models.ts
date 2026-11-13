/**
 * req-293: the assistant's connection as Mission Control's persona's Model
 * choice reads it — `GET /api/chat/models` and the `chatModels` invoke.
 */
export type ChatModelsReply =
  | {
      readonly ok: true;
      /** Drey's provider id (`lmstudio`, `anthropic`, …). */
      readonly provider: string;
      /** The provider as a label (`LM Studio`). */
      readonly providerLabel: string;
      /** The assistant's own model (`chat.model`): what *Same as the assistant* means. */
      readonly assistantModel: string;
      /** The models the endpoint lists, sorted; empty when it lists none or could not be asked. */
      readonly models: readonly string[];
    }
  | { readonly ok: false; readonly error: string };
