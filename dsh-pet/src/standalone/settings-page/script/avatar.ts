/**
 * Pet avatar line: Preview the current avatar, select the image and then compress and upload it. If successful, the
 * version number will be changed to refresh the preview.
 *
 * The backend is the plugin's own / logo and / pet-avatar - the standalone mode is mounted as is via apply()
 * without opening another interface. Pictures with extremely long sides will be reduced to the upper limit first and
 * then edited into PNG; if they are already within the upper limit, they will be uploaded as they are without losing
 * transparency and animation.
 * @module dsh-pet/src/standalone/settings-page/script/avatar
 */

/** Constants required to generate avatar fragments; both are taken from the plugin's own implementation to avoid the duplicate source of truth. */
export interface AvatarScriptConsts {
  /** Avatar reading address (LOGO_URL from shared/avatar.ts). */
  readonly logoUrl: string;
  /** Long side upper limit (AVATAR_MAX_SIDE from client/settings/avatar-upload.ts). */
  readonly maxSide: number;
}

/** Generate avatar fragment. */
export function avatarScript(consts: AvatarScriptConsts): string {
  return `
const AVATAR_LOGO_URL = ${JSON.stringify(consts.logoUrl)};
const AVATAR_MAX_SIDE = ${consts.maxSide};
let avatarVersion = Date.now();

function avatarSrc(assetRoot) {
  const root = String(assetRoot || '').trim();
  const query = root === '' ? '' : 'root=' + encodeURIComponent(root) + '&';
  return AVATAR_LOGO_URL + '?' + query + 'v=' + avatarVersion;
}

function fileToBase64(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      const url = String(reader.result || '');
      resolve(url.slice(url.indexOf(',') + 1));
    };
    reader.onerror = () => reject(new Error('读取图片失败'));
    reader.readAsDataURL(file);
  });
}

async function encodeAvatar(file) {
  const bitmap = await createImageBitmap(file);
  const longest = Math.max(bitmap.width, bitmap.height);
  if (longest <= AVATAR_MAX_SIDE) return fileToBase64(file);
  const scale = AVATAR_MAX_SIDE / longest;
  const canvas = document.createElement('canvas');
  canvas.width = Math.max(1, Math.round(bitmap.width * scale));
  canvas.height = Math.max(1, Math.round(bitmap.height * scale));
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('浏览器不支持缩放这张图');
  ctx.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
  const dataUrl = canvas.toDataURL('image/png');
  return dataUrl.slice(dataUrl.indexOf(',') + 1);
}

/**
 * Get the avatar and render it.
 *
 * You cannot put the address directly into img src: If the same source image request does not include
 * Origin, the packaged version will judge it as a file source and require a token, and the result will be a
 * 403 cracked image.
 * Therefore, change the token fetch to blob and then hang it up; if you cannot get it, leave it blank. If
 * the preview fails, other fields should not be blocked.
 */
async function loadAvatar(image, assetRoot) {
  try {
    const response = await fetch(avatarSrc(assetRoot), {
      credentials: 'same-origin',
      cache: 'no-store',
      headers: { 'X-DSH-Pet-Token': TOKEN },
    });
    if (!response.ok) return;
    const blob = await response.blob();
    const previous = image.dataset.blobUrl;
    if (previous) URL.revokeObjectURL(previous);
    const url = URL.createObjectURL(blob);
    image.dataset.blobUrl = url;
    image.src = url;
  } catch {
    // Preview fails and remains blank.
  }
}

async function uploadAvatar(assetRoot, file, result, image) {
  setStatus(result, '正在上传…');
  try {
    const base64 = await encodeAvatar(file);
    const response = await fetch(API + '/pet-avatar?root=' + encodeURIComponent(assetRoot), {
      method: 'POST',
      credentials: 'same-origin',
      cache: 'no-store',
      headers: { 'X-DSH-Pet-Token': TOKEN, 'Content-Type': 'application/json' },
      body: JSON.stringify({ base64: base64 }),
    });
    if (response.status === 403) throw new Error('打开凭据已失效。请从桌宠菜单重新打开设置。');
    const data = await response.json().catch(() => null);
    if (!data) throw new Error('本机接口没有返回结果，请重试。');
    if (data.ok !== true) throw new Error(data.message || '上传失败');
    // Use auto-increment instead of Date.now (): When two consecutive transmissions are sent in the same
    // millisecond, the version number must still change.
    avatarVersion += 1;
    await loadAvatar(image, assetRoot);
    setStatus(result, '头像已更新。', 'ok');
  } catch (error) {
    setStatus(result, error && error.message ? error.message : String(error), 'error');
  }
}

function avatarRow(pet) {
  // The entry name is the asset root (there is no assetRoot on pets of config, which is added by the client
  // during shooting).
  const assetRoot = pet.assetRoot || state.entry;
  // pet / pet pack only: The built-in entry is in the package logo, which is only previewed and not uploaded,
  // consistent with the rejection of the server.
  const editable = assetRoot !== 'main';
  const image = make('img', { class: 'avatarImg', alt: '头像' });
  void loadAvatar(image, editable ? assetRoot : '');
  const result = make('p', { class: 'status' });
  const children = [
    make('p', {
      class: 'fieldHint',
      text: editable
        ? '头像按素材根保存，同一素材根的宠物共用一张；支持 PNG / JPEG / WebP / GIF，超过长边 ' + AVATAR_MAX_SIDE + ' 会自动缩小。'
        : '内置条目固定用包里的 logo，不能单独换；要给文件宠物换头像，请切到它所在的条目。',
    }),
  ];
  if (editable) {
    const input = make('input', { type: 'file', accept: 'image/png,image/jpeg,image/webp,image/gif', hidden: true });
    const upload = make('button', { class: 'btn', type: 'button', text: '上传头像' });
    upload.addEventListener('click', () => input.click());
    input.addEventListener('change', () => {
      const file = input.files && input.files[0];
      input.value = '';
      if (file) void uploadAvatar(assetRoot, file, result, image);
    });
    children.push(upload, input);
  }
  children.push(result);
  return make('div', { class: 'avatarRow' }, [image, make('div', { class: 'avatarBox' }, children)]);
}
`;
}
