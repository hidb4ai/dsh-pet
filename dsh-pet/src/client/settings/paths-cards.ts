/**
 * Two "persist to disk location" display cards: advanced configuration (configuration files, emoticons, log paths) and
 * unmount and storage (list + unmount command). The data originates from `GET /config/meta` . When it cannot be read,
 * the two cards will not appear in one block - it is safer to give a missing path prompt than to give the wrong path.
 * read-only display, no editable controls, so busy is not needed. Both cards are "title row + folded text" and are
 * collapsed by default: these two blocks at the end of the page do not need to be read every time. After being
 * collapsed, the entire page will be less scrolled. The open and closed state only lives in the component. Close the
 * settings page and then open or close it - it does not write to the disk, and it is not related to any field in the
 * configuration.
 * @module dsh-pet/src/client/settings/paths-cards
 */
import type { FunctionComponent } from 'react';
import type { ConfigMeta } from './config/index.ts';
import type { SettingsRuntime } from './runtime.ts';
import { MONO_STACK, makeUiKit } from './ui.ts';

/** Common input of two cards. */
export interface PathsCardProps {
  /** The path and storage list given by host. */
  paths: ConfigMeta;
}

/** A pair of persist to disk location cards. */
export interface PathsCards {
  /** Advanced configuration: default configuration, user configuration, animation directory, emoticon directory and log file path. */
  ConfigMetaCard: FunctionComponent<PathsCardProps>;
  /** unmount and storage: All locations of the plugin persist to disk + unmount steps and commands. */
  StorageCard: FunctionComponent<PathsCardProps>;
}

/** id of the folded text: paired with `aria-controls` of the button, one copy for each of the two cards. */
const BODY_ID = {
  meta: 'pet-cfg-paths-meta',
  storage: 'pet-cfg-paths-storage',
} as const;

/**
 * Create two persist to disk location cards.
 *
 * @param rt - Injected react capabilities and translation functions.
 * @returns Two card components.
 */
export function makePathsCards(rt: SettingsRuntime): PathsCards {
  const { h, t, useState } = rt;
  const { foldCard } = makeUiKit({ h, t });

  function ConfigMetaCard(props: PathsCardProps) {
    const { paths } = props;
    const [open, setOpen] = useState(false);
    const line = (key: string, value: string | undefined, suffix = '') =>
      value === undefined
        ? null
        : h('div', { key, className: 'dsh-pet-cfg__path', children: t(key) + '：' + value + suffix });
    const body = [
      line('defaultConfig', paths.default),
      line('userConfig', paths.user),
      line('todosFile', paths.todos),
      line('animationDir', paths.animations),
      line('memesDir', paths.memes),
      // Log file path + a description; the purpose of the rest of the positions are all in question marks, but this one is written on the surface - you should look for it first when reporting problems.
      line('logFile', paths.logs),
      paths.logs ? h('div', { key: 'logNote', className: 'dsh-pet-cfg__note', children: t('logFileNote') }) : null,
    ];
    return foldCard({
      id: BODY_ID.meta,
      title: t('configMeta'),
      hint: t('configMetaHint'),
      body,
      open,
      onToggle: () => setOpen(!open),
    });
  }

  function StorageCard(props: PathsCardProps) {
    const { paths } = props;
    // hook must precede early exit: When storage is empty, the entire card will not render, but it will also take the same hook path at that time.
    const [open, setOpen] = useState(false);
    const storage = paths.storage ?? [];
    if (storage.length === 0) return null;
    const body = [
      // Storage location list: Each item is "path (same width, optional copy) to function".
      ...storage.map((entry) =>
        h('div', {
          key: entry.key,
          className: 'dsh-pet-cfg__path',
          children: [
            h('b', { key: 'p', style: { fontFamily: MONO_STACK }, children: entry.path }),
            // Mark directories that have not yet been created to prevent users from looking for non-existent folders.
            h('span', {
              key: 'd',
              children: ' — ' + t('storage.' + entry.key) + (entry.exists === false ? t('storageMissing') : ''),
            }),
          ],
        }),
      ),
      h('div', {
        key: 'ut',
        className: 'dsh-pet-cfg__cardTitle',
        style: { marginTop: '4px' },
        children: t('uninstallTitle'),
      }),
      h('div', { key: 'u1', className: 'dsh-pet-cfg__note', children: t('uninstallStep1') }),
      h('div', { key: 'u2', className: 'dsh-pet-cfg__note', children: t('uninstallStep2') }),
      h('div', {
        key: 'cmd',
        className: 'dsh-pet-cfg__cmd',
        children: t('uninstallCmd').replace('{profile}', paths.profile || '<profile>'),
      }),
      h('div', { key: 'u3', className: 'dsh-pet-cfg__note', children: t('uninstallStep3') }),
    ];
    return foldCard({
      id: BODY_ID.storage,
      title: t('storageTitle'),
      hint: t('storageHint'),
      body,
      open,
      onToggle: () => setOpen(!open),
    });
  }

  return { ConfigMetaCard, StorageCard };
}
