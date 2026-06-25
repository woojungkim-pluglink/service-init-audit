const IMAGE_EXT = ['.jpg', '.jpeg', '.png', '.gif', '.webp', '.heic', '.bmp'];

export function extractTicketId(mCell) {
  if (!mCell || typeof mCell !== 'string') return null;
  // 1) 'T-숫자' 접두사 형식 우선
  const tdash = mCell.match(/\bT-(\d+)\b/i);
  if (tdash) return tdash[1];
  // 2) 접두사 없는 숫자형 티켓ID(6자리 이상). 이관 'A > B' 등 복수면 마지막(활성) 티켓.
  const nums = mCell.match(/\d{6,}/g);
  return nums && nums.length ? nums[nums.length - 1] : null;
}

export function isImageFile(file) {
  if (!file) return false;
  const s = String(file.name || file.url || '').toLowerCase();
  return IMAGE_EXT.some((ext) => s.endsWith(ext));
}

export function hasImage(files) {
  return Array.isArray(files) && files.some(isImageFile);
}

export function toDateOnly(dt) {
  if (!dt || typeof dt !== 'string') return null;
  const m = dt.match(/^(\d{4}-\d{2}-\d{2})/);
  return m ? m[1] : null;
}

export function decideWrite(ticket) {
  if (!ticket || ticket.status !== 'COMPLETED') return { ok: false, reason: 'wait' };
  if (!hasImage(ticket.files)) return { ok: false, reason: 'no_image' };
  const value = toDateOnly(ticket.completedAt);
  if (!value) return { ok: false, reason: 'bad_date' };
  return { ok: true, value, reason: 'write' };
}
