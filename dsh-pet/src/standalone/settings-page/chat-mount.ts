/**
 * Browser entry point for the "Conversation" partition in standalone mode: Hang the set of panels in the right column
 * of DSH to the settings page.
 *
 * Components, states and rendering trees all come from client/chat. Only the host side is added here: react runtime is
 * packaged by this package itself (the independent environment does not have DSH injection), the text is from
 * the zh dictionary in the package (no locale service), and the style is from the external link CSS (the page CSP is
 * style-src' self ', inline style will be blocked). The platform UI primitive is in standalone mode. The panel
 * downgrades itself according to the existing branch.
 * @module dsh-pet/src/standalone/settings-page/chat-mount
 */
import { createElement, useEffect, useRef, useState, type FC } from 'react';
import { createRoot } from 'react-dom/client';
import { jsx } from 'react/jsx-runtime';
import { zh } from '../../client/chat/locales/index.ts';
import { makePetChatPanel } from '../../client/chat/panel.ts';
import type { ChatPanelRuntime } from '../../client/chat/runtime.ts';
import { createTranslator } from './translate.ts';

/** The mount point id of the dialog panel in the settings page is consistent with the container of chrome.ts. */
const HOST_ID = 'pet-chat-root';

/**
 * The react capability and copy injected into the panel; in standalone mode, there is no host to inject, so use the
 * react imported from this package.
 *
 * Only make assertions for `h` : The parameter type of jsx is `ElementType` , which is incompatible with `unknown` of
 * the runtime contract, but the two are the same function at runtime. The remaining fields remain type-checked, and
 * missing fields will directly report an error during compilation.
 */
const runtime: ChatPanelRuntime = {
  h: jsx as ChatPanelRuntime['h'],
  useState,
  useEffect,
  useRef,
  t: createTranslator(zh),
};

const host = document.getElementById(HOST_ID);
if (host !== null) {
  const Panel = makePetChatPanel(runtime) as unknown as FC;
  createRoot(host).render(createElement(Panel));
}
