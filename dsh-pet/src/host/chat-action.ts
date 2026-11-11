/**
 * Pure logic of dialogue action linkage: list of actions that can be performed, instructions for injecting prompt
 * words, and analysis of action tags in replies.
 *
 * Do not generate and persist to disk (return to ./chat and ./plugin/chat-memory), nor write S; the list has the
 * same origin as animations.categories. Separate from ./anim: The other side answers "Should / anim be played and
 * which one should be played?", while this side only serves the trigger path of the dialogue.
 * @module dsh-pet/src/host/chat-action
 */

/**
 * Actions available for dialogue linkage: All actions under `animations.categories` (deduplicate, keep the
 * configuration order).
 *
 * Separate from animationNames: standby/turn/drag/click/move/event animations do not participate in dialogue linkage.
 *
 * @param animations - animations segment of finished configuration (invalid shape → empty list).
 * @returns Action names arranged in configuration order; when categories is not configured, it is an empty array.
 */
export function chatActionNames(animations: unknown): string[] {
  const a = (animations && typeof animations === 'object' ? animations : {}) as Record<string, unknown>;
  if (!Array.isArray(a.categories)) return [];
  const out: string[] = [];
  for (const category of a.categories) {
    if (!category || typeof category !== 'object') continue;
    const actions = (category as { actions?: unknown }).actions;
    if (!Array.isArray(actions)) continue;
    for (const name of actions) {
      // Same conventions as animationNames: non-character strings and empty strings are discarded
      if (typeof name !== 'string' || name === '') continue;
      if (!out.includes(name)) out.push(name);
    }
  }
  return out;
}

/**
 * Action command: attached to the user text in parallel with the picture command.
 *
 * The sentence pattern is the same as the one in the picture (omitting the subject, saying "do it" instead of "let the
 * pet perform"): the model itself is the pet, and the narrator says it will not do it.
 *
 * @param names - the name of the action that can be performed (result of {@link chatActionNames} ); the empty list is
 * skipped directly by the caller.
 */
export function actionInstruction(names: readonly string[]): string {
  return (
    '\n\n[动作] 回复结尾可选做一个动作给用户看，从下列清单里挑最贴合当前语境的：\n' +
    names.map((name) => '- ' + name).join('\n') +
    '\n挑中就在回复最后另起一行写 [动作:名称]（名称原样照抄）；没有合适的就完全不要写这个标记。'
  );
}

/**
 * Get actions from model responses (parsing side of dialogue linkage).
 *
 * All action tags are stripped (invalid names are also stripped - the tag does not belong to user-visible text), and
 * only the first whitelist hit is taken. When there is no text after stripping, an empty string is returned, and the
 * caller decides not to pop the bubble.
 *
 * @param text - Model replies to the original text.
 * @param names - white list ({@link chatActionNames}); empty list = switch is off, the mark is stripped but not
 * adopted.
 * @returns The text after stripping off the mark, and the first action name that hits the whitelist.
 */
export function extractChatAction(text: string, names: readonly string[]): { text: string; action?: string } {
  // The global regular pattern has lastIndex, and reuse will miss matches: create a new one each time.
  const tag = /\[动作[:：]\s*([^\]\n]+?)\s*\]/g;
  let action: string | undefined;
  let tagged = false;
  const cleaned = text.replace(tag, (_tag, raw: string) => {
    tagged = true;
    const name = raw.trim();
    if (action === undefined && names.includes(name)) action = name;
    return '';
  });
  if (!tagged) return { text };
  // The mark usually occupies its own line: after peeling, a blank line will be left, so press it, otherwise there will be an extra blank space at the top of the bubble.
  const body = cleaned
    .replace(/[ \t]+$/gm, '')
    .replace(/\n{2,}/g, '\n')
    .trim();
  return action === undefined ? { text: body } : { text: body, action };
}
