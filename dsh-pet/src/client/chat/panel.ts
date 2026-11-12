/**
 * The component entry point of the "desktop pet conversation" tab in the right column.
 *
 * Just connect the state hook to the rendering tree: the state is in ./state, the tree is in ./view, and the style is
 * in ./panel-css. The react capability is injected by the host (see ./runtime ).
 * @module dsh-pet/src/client/chat/panel
 */
import { createPetChatState } from './state.ts';
import { buildPanel } from './view.ts';
import type { ChatPanelRuntime } from './runtime.ts';
import { makeMemoryStatus } from './memory-status.ts';
import { makeRobotPanel } from '../robot/panel.ts';

export type { ChatPanelRuntime } from './runtime.ts';

/**
 * Manufacturing panel components.
 *
 * @param rt - Injected react capability.
 * @returns parameterless component: status and action are taken from ./state, and does not hold logic.
 */
export function makePetChatPanel(rt: ChatPanelRuntime): () => unknown {
  const useChatState = createPetChatState(rt);
  const MemoryStatus = makeMemoryStatus(rt);
  const RobotPanel = makeRobotPanel(rt);
  return function PetChatPanel(): unknown {
    const state = useChatState();
    return buildPanel(
      rt,
      state,
      rt.h(MemoryStatus, {
        petId: state.petId,
        revision: state.messages[state.messages.length - 1]?.ts ?? 0,
      }),
      rt.h(RobotPanel, { petId: state.petId }),
    );
  };
}
