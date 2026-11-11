/**
 * Browser side assembly layer: inject react, assemble pet overlay and settings page, register into DSH slot. Not
 * responsible for the page business: the pet page is at pet.ts and the settings page is at settings.ts. Cordis
 * services such as slots / locale / remote / commandUi that rely on DSH injection. Any missing optional capabilities
 * will only downgrade the functionality, never causing the entire plugin to fail to load.
 * @module dsh-pet/src/client/app
 */
import { makePetUI } from './pet.ts';
import { readPose } from './pose.ts';
import { readProgress } from './progress.ts';
import { takeMenuEvents } from './menu-service.ts';
import { getStateSnapshot } from './state-service.ts';
import { dicts, makePetConfigSection, NS, petBridge } from './settings.ts';
import { initNotify } from './notify.ts';
import { mountBaifan } from './baifan.ts';
import { makeBaifanLayer } from './baifan/layer.ts';
import { installCommandFaces, type CommandFace, type CommandUiLike } from './command-faces.ts';
import { installSectionNavIcon } from './nav-icon.ts';
import { registerPetChatTab, openPetChatTab } from './chat/register.ts';
import { PET_CHAT_COMMAND_ID, registerPetChatShortcut } from './chat/shortcut.ts';
import { dicts as chatDicts, NS as CHAT_NS } from './chat/locales/index.ts';
import { registerPetCardShortcuts } from './pet/card/shortcut.ts';
import type * as ReactNS from 'react';
import type * as PrimitivesNS from '@deepseek-ai/dsh-client-ui-primitives';

/** Create DSH plugin factory and return modules with name / inject / apply. */
// eslint-disable-next-line @typescript-eslint/no-explicit-any -- DSH __ModuleLoader__ uses the untyped f(require) => module contract.
export function makeFactory(): (require: (mod: string) => any) => any {
  return (require) => {
    const module = { exports: {} };

    const react: typeof ReactNS = require('react');
    const { useEffect, useRef, useState, useCallback } = react;
    const { jsx: h } = require('react/jsx-runtime');

    // primitives is the platform seed module; failure to obtain it only affects the command icon and does not affect plugin loading.
    let primitives: typeof PrimitivesNS | undefined;
    try {
      primitives = require('@deepseek-ai/dsh-client-ui-primitives');
    } catch (error) {
      console.warn('[dsh-pet] Icon module unavailable:' + (error instanceof Error ? error.message : String(error)));
    }

    // react-dom is also a platform seed module, which is only used to synchronously render icons into SVG for use by
    // CSS mask. If it cannot be retrieved, it will degenerate into a state icon, which will not affect plugin loading.
    let renderIconSvg: ((icon: ReactNS.ComponentType<PrimitivesNS.IconProps>) => string) | undefined;
    try {
      const { createRoot } = require('react-dom/client');
      const { flushSync } = require('react-dom');
      renderIconSvg = (icon) => {
        const holder = document.createElement('div');
        const root = createRoot(holder);
        try {
          // flushSync: root.render is asynchronously scheduled, and DOM cannot be obtained by brushing once without synchronization.
          flushSync(() => root.render(h(icon, { size: 16 })));
          return holder.innerHTML;
        } finally {
          root.unmount();
        }
      };
    } catch (error) {
      console.warn(
        '[dsh-pet] Icon renderer unavailable (react-dom missing):' +
          (error instanceof Error ? error.message : String(error)),
      );
    }

    // Pet overlay and settings page are separate files, only assembly and register are done here.
    const PetMulti = makePetUI({ h, useState, useEffect, useRef });

    const name = 'pet';
    // commandUi is declared as a service dependency. Make sure that the "/" command service is ready before apply. The / pet decoration must register successfully.
    const inject = ['slots', 'locale', 'connection', 'remote', 'remote.commands', 'commandUi'];
    // eslint-disable-next-line @typescript-eslint/no-explicit-any -- DSH-injected locale/slots/webServer services have no static types.
    function apply(ctx: any) {
      // Set page copy dictionary.
      ctx.effect(() => ctx.locale.register(NS, dicts), 'dsh-pet: dictionaries');
      const t = ctx.locale.bind(NS);
      // The copy of the sidebar conversation is separated into a namespace: it only covers the conversation panel and is not mixed with the settings page dictionary.
      ctx.effect(() => ctx.locale.register(CHAT_NS, chatDicts), 'dsh-pet: chat dictionaries');
      const chatT = ctx.locale.bind(CHAT_NS);

      // The third-party plugin on the same page can use the Cordis service petApi7340 to read the live broadcast,
      // playback progress, latest shot status and menu click of the pet on this page. Only reading is enabled, and the
      // control still goes through HTTP to avoid two control channels. The service name has a 7340 suffix to avoid
      // conflicts with services of the same name in the ecosystem; Cordis with the same name as provide will directly
      // throw an error. Consumers use ctx.get (' petApi7340 ') to detect, and if they cannot get it, they have to use
      // the old version; `getState` / `menuEvents` must also be detected separately (the old version does not have
      // them).
      ctx.provide('petApi7340', {
        getState: getStateSnapshot,
        menuEvents: takeMenuEvents,
        pose: readPose,
        progress: readProgress,
      });

      // The built-in gameplay is "free rice": the overlay register enters shell.overlay (the same slot as the desktop
      // pet). If you don't hang body yourself - the direct child of body will hit the macOS no-drag rule of the host,
      // and will also skip the level and cover the host modal box.
      const BaifanLayer = makeBaifanLayer({ h, useRef, useEffect }, (host) => mountBaifan(ctx, host));
      ctx.slots.inject('shell.overlay', function* () {
        yield ctx.slots.register({ name: 'shell.overlay', id: 'baifan', order: 1100 }, BaifanLayer);
      });

      // System notification: host writes the notification frame into sections.notify of / state, and then polls toast after discovering the change.
      ctx.effect(
        () =>
          initNotify({
            // Resolve the service lazily because it may register later. If absent, only bring the window forward.
            // eslint-disable-next-line @typescript-eslint/no-explicit-any -- DSH-injected services have no static types.
            openSession: (sessionId: string) => (ctx as any).get?.('uiWorkspace')?.openSession?.(sessionId),
            // The notification title uses the session name: title in that row in the session list; if a blank session/unnamed session gets an empty string, it returns undefined.
            sessionTitle: (sessionId: string) => {
              // eslint-disable-next-line @typescript-eslint/no-explicit-any -- DSH-injected services have no static types.
              const row = (ctx as any).get?.('sessions')?.list?.getSnapshot?.()?.byId?.[sessionId];
              const name = typeof row?.title === 'string' ? row.title.trim() : '';
              return name || undefined;
            },
          }),
        'dsh-pet: notifications',
      );

      // / pet selection box: Select and submit / pet < id >, implemented by host command. commandUi is already a
      // service dependency, but the downgrade prompt when missing is still retained.
      ctx.effect(() => {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any -- DSH-injected services have no static types.
        const commandUi = (ctx as any).get?.('commandUi');
        if (!commandUi || typeof commandUi.decorate !== 'function') {
          console.warn(
            '[dsh-pet] Command picker unavailable: commandUi service missing (/pet still accepts IDs or names)',
          );
          return () => {};
        }
        return commandUi.decorate({
          name: 'pet',
          available: () => true,
          ui: {
            kind: 'popupSelect',
            // The option comes from the currently active pet list, name has fallen back.
            options: async () =>
              petBridge.current.map((p) => ({
                id: p.id,
                label: p.name || p.id,
                detail: (p.assetRoot && p.assetRoot !== p.id ? p.assetRoot + ' / ' : '') + p.id,
              })),
            // Select and submit / pet < id >, and host will verify and set the current desktop pet.
            onSelect: async (option: { id: string }, session: { sessionId: string }) => {
              // eslint-disable-next-line @typescript-eslint/no-explicit-any -- remote has no static type.
              await (ctx as any).remote?.commands?.execute(session.sessionId, '/pet ' + option.id, []);
            },
          },
        });
      }, 'dsh-pet: /pet picker');

      // Add the row title and icon of the "/" menu to / chat / pet / balance. DSH has no official entry point, and
      // commandUi.candidates is wrapped here; the behavior of the command itself is not affected. See command-faces.ts
      // for the basis and downgrade strategy.
      ctx.effect(() => {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any -- DSH-injected services have no static types.
        const commandUi = (ctx as any).get?.('commandUi') as CommandUiLike | undefined;
        const icons = primitives;
        if (commandUi === undefined || icons === undefined) {
          console.warn('[dsh-pet] Command icon unavailable; the command remains usable');
          return () => {};
        }
        return installCommandFaces(
          commandUi,
          new Map<string, CommandFace>([
            // Dialogue bubble: The only pure dialogue bubble among the 94 built-in icons.
            ['chat', { label: () => t('cmd.chat'), icon: icons.IconQueueOutlineRegular }],
            // Duo: Choose from multiple desktop pets.
            ['pet', { label: () => t('cmd.pet'), icon: icons.IconUsersOutlineRegular }],
            // Dashboard: quota and usage.
            ['balance', { label: () => t('cmd.balance'), icon: icons.IconGaugeOutlineRegular }],
          ]),
        );
      }, 'dsh-pet: command faces');

      // The icon of "desktop pet configuration" in the settings page navigation: DSH only assigns the icon to the
      // whitelist partition, and can only be added at the DOM layer. See nav-icon.ts for the basis and downgrade
      // strategy.
      ctx.effect(() => {
        const renderIcon = renderIconSvg;
        const icon = primitives?.IconSlidersTwoOutlineMedium;
        if (renderIcon === undefined || icon === undefined) {
          console.warn('[dsh-pet] Settings navigation icon unavailable; retaining the default gear');
          return () => {};
        }
        return installSectionNavIcon({ label: () => t('nav'), renderSvg: () => renderIcon(icon) });
      }, 'dsh-pet: settings nav icon');

      // Pet overlay: Container renders multiple PetCard .
      ctx.slots.inject('shell.overlay', function* () {
        yield ctx.slots.register({ name: 'shell.overlay', id: 'pet', order: 1000 }, () => h(PetMulti, {}));
      });

      // Setting page "desktop pet configuration": size, position, model, save and take effect immediately. useRef is
      // used for the floating layer positioning and external click determination of the "AI model" drop-down.
      const PetConfigSection = makePetConfigSection({ h, useState, useEffect, useRef, useCallback, t }, ctx);
      ctx.slots.inject('settings.section', function* () {
        yield ctx.slots.register(
          { name: 'settings.section', id: 'pet-config', order: 30, label: () => t('nav'), inject: () => ({ t }) },
          PetConfigSection,
        );
      });

      // Independent register of shortcut keys: not hung in the sidebar register - when the sidebar service is missing,
      // the sidebar disappears, and the shortcut keys should not disappear with it. The three commands share the
      // app-shortcut register shell. If any one of them fails, it will only lose itself.
      let sidebarChatReady = false;
      ctx.effect(() => {
        const sidebarChat = registerPetChatShortcut(
          ctx,
          () => t('shortcut.open'),
          () => openPetChatTab(ctx),
        );
        sidebarChatReady = sidebarChat.registered;
        const card = registerPetCardShortcuts(ctx, (key) => t(key));
        return () => {
          sidebarChatReady = false;
          sidebarChat.dispose();
          card.dispose();
        };
      }, 'dsh-pet: shortcuts');

      // "Desktop Pet Dialogue" in the right column: Optional capability. It only alerts when the service is missing
      // and does not affect other parts. The confirmation pop-up window uses platform primitives (when primitives is
      // missing, the interior of the panel degenerates into an inline confirmation bar). One more layer of detail: any
      // register exception must not bring down plugin activation (otherwise the entire Web end cannot be accessed).
      ctx.effect(() => {
        try {
          return registerPetChatTab(
            ctx,
            {
              h,
              useEffect,
              useRef,
              useState,
              t: chatT,
              ...(primitives === undefined
                ? {}
                : {
                    ui: {
                      Modal: primitives.Modal,
                      Button: primitives.Button,
                      ImageLightbox: primitives.ImageLightbox,
                    },
                  }),
            },
            // commandId will not be included if the command is not successfully registered: pointing to a non-existent command will cause the sidebar register to throw an error
            sidebarChatReady ? { commandId: PET_CHAT_COMMAND_ID } : {},
          );
        } catch (error) {
          console.error('[dsh-pet] Chat sidebar registration failed; startup will continue:', error);
          return () => {};
        }
      }, 'dsh-pet: sidebar chat tab');
    }

    module.exports = { apply, inject, name };
    return module.exports;
  };
}
