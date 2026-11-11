/**
 * The action of the "Test pop-up window" button: Use this user gesture to apply for system notification permission,
 * and directly send a test notification after success. One button serves as both "get permission" and "verify link":
 * if it fails, the reason and guidance will be returned to the caller and displayed locally, never silently. No state
 * is held, and feedback is given to the settings page through callback (it only knows where to put the red text).
 * @module dsh-pet/src/client/settings/notify-test
 */
import { NOTIFY_ICONS, requestNotificationPermission, wireNotificationClick } from '../notify.ts';
import type { Feedback } from './actions.ts';

/** Dependence of {@link runNotificationTest}. */
export interface NotificationTestDeps {
  /** Copy translation. */
  t: (key: string) => string;
  /** Send the results to the settings page for display; empty text means clearing the last red text. */
  report: (feedback: Feedback) => void;
}

/**
 * Run the "test pop-up window" once.
 *
 * @param deps - Translation and feedback callback.
 * @returns has no return value; all results are returned via `report` .
 */
export async function runNotificationTest(deps: NotificationTestDeps): Promise<void> {
  const { t, report } = deps;
  report({ kind: '', text: '' });
  const result = await requestNotificationPermission();
  if (!result.ok) {
    // Reason for failure + boot; unsupported has no boot (it only makes sense to change the environment).
    const reason =
      result.reason === 'unsupported'
        ? t('notifyDenyUnsupported')
        : result.reason === 'denied'
          ? t('notifyDenyBlocked')
          : result.reason === 'rejected'
            ? t('notifyDenyRejected')
            : t('notifyDenyError') + (result.message ? '：' + result.message : '');
    report({ kind: 'err', text: reason + (result.reason === 'unsupported' ? '' : ' ' + t('notifyGuide')) });
    return;
  }
  try {
    // Send a test notification directly, bypassing the focus gate; click behavior and real event notification share wireNotificationClick.
    wireNotificationClick(
      new Notification('测试通知', { body: '【dsh-pet】系统通知已就绪。', icon: NOTIFY_ICONS.test }),
    );
  } catch {
    /* Some environment construction failed: still press the authorized prompt. */
  }
  report({ kind: 'ok', text: t('notifyTestOk') });
}
