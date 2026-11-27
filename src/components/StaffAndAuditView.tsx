import React, { useMemo, useState } from 'react';
import {
  KeyRound,
  Lock,
  Pencil,
  ShieldCheck,
  Trash2,
  Unlock,
  User,
  UserPlus,
} from 'lucide-react';
import { usePms } from '../context/PmsContext';
import type { StaffPermissions, StaffRole, StaffUser } from '../types/pms';
import { formatDateTimeVN, getRoleLabel } from '../lib/utils';
import {
  createStaffAccount,
  deleteStaffAccount,
  resetStaffPassword,
  updateOwnProfileAndPassword,
  updateStaffMember,
} from '../lib/pmsActions';

const PERM_LABELS: Array<{ key: keyof StaffPermissions; label: string }> = [
  { key: 'canViewProfit', label: 'Xem Lợi nhuận P&L' },
  { key: 'canEditPrice', label: 'Sửa giá phòng' },
  { key: 'canUndoAction', label: 'Hoàn tác thao tác' },
  { key: 'canManageStaff', label: 'Quản lý tài khoản NV' },
  { key: 'canEditFormTemplates', label: 'Sửa mẫu biểu mẫu' },
  { key: 'canManageConfig', label: 'Sửa phòng & nguồn' },
];

export const StaffAndAuditView: React.FC = () => {
  const { staffProfile, staffUsers, auditLogs, canManageStaff, actor, notify } = usePms();
  const [subTab, setSubTab] = useState<'account' | 'audit'>('account');

  // Manager: Create new staff (Firestore username + SHA-256 password)
  const [newUsername, setNewUsername] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [newFullName, setNewFullName] = useState('');
  const [newPhone, setNewPhone] = useState('');
  const [newRole, setNewRole] = useState<Exclude<StaffRole, 'superadmin'>>('receptionist');
  const [creating, setCreating] = useState(false);

  // Manager: Inline edit staff modal/state
  const [editingStaff, setEditingStaff] = useState<StaffUser | null>(null);

  // Self-service profile & password form (for ALL users, and the ONLY view for normal staff)
  const [myFullName, setMyFullName] = useState(staffProfile?.fullName || '');
  const [myPhone, setMyPhone] = useState(staffProfile?.phone || '');
  const [myCurPass, setMyCurPass] = useState('');
  const [myNewPass, setMyNewPass] = useState('');
  const [savingSelf, setSavingSelf] = useState(false);

  // Audit filter
  const [logSearch, setLogSearch] = useState('');

  const handleCreateStaff = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!canManageStaff) return;
    setCreating(true);
    try {
      const created = await createStaffAccount({
        username: newUsername,
        password: newPassword,
        fullName: newFullName,
        phone: newPhone,
        role: newRole,
        actor,
      });
      setNewUsername('');
      setNewPassword('');
      setNewFullName('');
      setNewPhone('');
      notify(`Đã tạo tài khoản @${created.username} (${created.fullName})`);
    } catch (err) {
      notify(err instanceof Error ? err.message : 'Lỗi tạo tài khoản', 'error');
    } finally {
      setCreating(false);
    }
  };

  const handleSaveEditedStaff = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!editingStaff || !canManageStaff) return;
    await updateStaffMember(editingStaff, actor);
    notify(`Đã cập nhật thông tin tài khoản @${editingStaff.username}`);
    setEditingStaff(null);
  };

  const handleResetPassword = async (staff: StaffUser) => {
    if (!canManageStaff || staff.role === 'superadmin') return;
    const pwd = window.prompt(
      `Nhập mật khẩu mới để đặt lại cho ${staff.fullName} (@${staff.username}):`
    );
    if (!pwd) return;
    try {
      await resetStaffPassword(staff, pwd, actor);
      notify(`Đã đặt lại mật khẩu cho @${staff.username}`);
    } catch (err) {
      notify(err instanceof Error ? err.message : 'Lỗi đặt lại mật khẩu', 'error');
    }
  };

  const handleDeleteStaff = async (staff: StaffUser) => {
    if (!canManageStaff || staff.role === 'superadmin' || staff.uid === actor.uid) return;
    if (
      !window.confirm(
        `Xác nhận XÓA vĩnh viễn tài khoản nhân viên ${staff.fullName} (@${staff.username})?`
      )
    ) {
      return;
    }
    try {
      await deleteStaffAccount(staff, actor);
      notify(`Đã xóa tài khoản @${staff.username}`, 'info');
    } catch (err) {
      notify(err instanceof Error ? err.message : 'Lỗi xóa tài khoản', 'error');
    }
  };

  const handleToggleActive = async (staff: StaffUser) => {
    if (!canManageStaff || staff.uid === actor.uid || staff.role === 'superadmin') return;
    await updateStaffMember({ ...staff, isActive: !staff.isActive }, actor);
    notify(
      staff.isActive
        ? `Đã khóa tài khoản @${staff.username} tức thì`
        : `Đã mở khóa tài khoản @${staff.username}`
    );
  };

  const handleTogglePerm = async (staff: StaffUser, key: keyof StaffPermissions) => {
    if (!canManageStaff || staff.role === 'superadmin') return;
    await updateStaffMember(
      {
        ...staff,
        permissions: { ...staff.permissions, [key]: !staff.permissions[key] },
      },
      actor
    );
    notify(`Đã cập nhật quyền cho ${staff.fullName}`, 'info');
  };

  const handleSelfUpdate = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!staffProfile) return;
    setSavingSelf(true);
    try {
      await updateOwnProfileAndPassword({
        staff: staffProfile,
        fullName: myFullName,
        phone: myPhone,
        currentPassword: myCurPass || undefined,
        newPassword: myNewPass || undefined,
        actor,
      });
      setMyCurPass('');
      setMyNewPass('');
      notify('Đã cập nhật thông tin tài khoản cá nhân thành công');
    } catch (err) {
      notify(err instanceof Error ? err.message : 'Lỗi cập nhật tài khoản', 'error');
    } finally {
      setSavingSelf(false);
    }
  };

  const filteredLogs = useMemo(() => {
    const q = logSearch.trim().toLowerCase();
    if (!q) return auditLogs;
    return auditLogs.filter(
      (l) =>
        l.actionType.toLowerCase().includes(q) ||
        l.targetLabel.toLowerCase().includes(q) ||
        l.reason.toLowerCase().includes(q) ||
        l.performedByName.toLowerCase().includes(q) ||
        (l.relatedTransactionIds || []).some((id) => id.toLowerCase().includes(q))
    );
  }, [auditLogs, logSearch]);

  return (
    <div className="space-y-4">
      <div className="inline-flex p-1 rounded-xl bg-[#EAE7E0]">
        <button
          type="button"
          onClick={() => setSubTab('account')}
          className={`h-8 px-3.5 rounded-lg text-[13px] font-medium ${
            subTab === 'account' ? 'bg-white text-[#1C1B18] shadow-xs' : 'text-[#57534E]'
          }`}
        >
          {canManageStaff
            ? `Quản lý Tài khoản Nhân viên (${staffUsers.length})`
            : 'Tài khoản cá nhân của tôi'}
        </button>
        <button
          type="button"
          onClick={() => setSubTab('audit')}
          className={`h-8 px-3.5 rounded-lg text-[13px] font-medium ${
            subTab === 'audit' ? 'bg-white text-[#1C1B18] shadow-xs' : 'text-[#57534E]'
          }`}
        >
          Nhật ký thao tác & Hoàn tác ({auditLogs.length})
        </button>
      </div>

      {subTab === 'account' && (
        <div className="space-y-5">
          {/* Self-service Profile & Password Box (always visible; ONLY box normal staff see!) */}
          {staffProfile && (
            <form
              onSubmit={handleSelfUpdate}
              className="bg-white border border-[#E5E2DC] rounded-2xl p-5 space-y-3"
            >
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2 text-[14px] font-semibold text-[#1C1B18]">
                  <User className="w-4 h-4 text-[#1B5E4B]" strokeWidth={1.5} />
                  Hồ sơ cá nhân của tôi (@{staffProfile.username} — {getRoleLabel(staffProfile.role)})
                </div>
                {!canManageStaff && (
                  <span className="text-[11px] text-[#8A847C]">
                    Nhân viên chỉ xem & chỉnh sửa tài khoản của chính mình
                  </span>
                )}
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-4 gap-2.5">
                <input
                  type="text"
                  required
                  value={myFullName}
                  onChange={(e) => setMyFullName(e.target.value)}
                  placeholder="Họ và tên"
                  className="h-9 px-3 rounded-lg border border-[#E5E2DC] text-[13px]"
                />
                <input
                  type="tel"
                  value={myPhone}
                  onChange={(e) => setMyPhone(e.target.value)}
                  placeholder="Số điện thoại"
                  className="h-9 px-3 rounded-lg border border-[#E5E2DC] font-mono-num text-[13px]"
                />
                {staffProfile.authSource === 'firestore_staff' && (
                  <>
                    <input
                      type="password"
                      value={myCurPass}
                      onChange={(e) => setMyCurPass(e.target.value)}
                      placeholder="Mật khẩu hiện tại (nếu đổi)"
                      className="h-9 px-3 rounded-lg border border-[#E5E2DC] text-[13px]"
                    />
                    <input
                      type="password"
                      value={myNewPass}
                      onChange={(e) => setMyNewPass(e.target.value)}
                      placeholder="Mật khẩu mới (tùy chọn)"
                      className="h-9 px-3 rounded-lg border border-[#E5E2DC] text-[13px]"
                    />
                  </>
                )}
              </div>
              <div className="flex justify-end">
                <button
                  type="submit"
                  disabled={savingSelf}
                  className="h-8 px-4 rounded-lg bg-[#1B5E4B] hover:bg-[#144839] text-white text-[12px] font-medium"
                >
                  {savingSelf ? 'Đang lưu...' : 'Lưu thông tin cá nhân'}
                </button>
              </div>
            </form>
          )}

          {/* Manager / SuperAdmin Full Staff Account CRUD */}
          {canManageStaff && (
            <>
              <form
                onSubmit={handleCreateStaff}
                className="bg-white border border-[#E5E2DC] rounded-2xl p-5 space-y-3"
              >
                <div className="flex items-center gap-2 text-[14px] font-semibold text-[#1C1B18]">
                  <UserPlus className="w-4 h-4 text-[#1B5E4B]" strokeWidth={1.5} />
                  Thêm mới tài khoản Chủ khách sạn / Nhân viên (Đăng nhập bằng Username & Password)
                </div>
                <div className="grid grid-cols-1 sm:grid-cols-6 gap-2.5">
                  <input
                    type="text"
                    required
                    value={newUsername}
                    onChange={(e) => setNewUsername(e.target.value)}
                    placeholder="Tên đăng nhập *"
                    className="h-9 px-3 rounded-lg border border-[#E5E2DC] font-mono-num text-[13px]"
                  />
                  <input
                    type="password"
                    required
                    minLength={4}
                    value={newPassword}
                    onChange={(e) => setNewPassword(e.target.value)}
                    placeholder="Mật khẩu *"
                    className="h-9 px-3 rounded-lg border border-[#E5E2DC] text-[13px]"
                  />
                  <input
                    type="text"
                    required
                    value={newFullName}
                    onChange={(e) => setNewFullName(e.target.value)}
                    placeholder="Họ và tên *"
                    className="h-9 px-3 rounded-lg border border-[#E5E2DC] text-[13px]"
                  />
                  <input
                    type="tel"
                    value={newPhone}
                    onChange={(e) => setNewPhone(e.target.value)}
                    placeholder="SĐT"
                    className="h-9 px-3 rounded-lg border border-[#E5E2DC] font-mono-num text-[13px]"
                  />
                  <select
                    value={newRole}
                    onChange={(e) => setNewRole(e.target.value as Exclude<StaffRole, 'superadmin'>)}
                    className="h-9 px-3 rounded-lg border border-[#E5E2DC] bg-white text-[13px]"
                  >
                    <option value="receptionist">Lễ tân</option>
                    <option value="housekeeping">Buồng phòng</option>
                    <option value="manager">Quản lý</option>
                    <option value="owner">Chủ khách sạn</option>
                  </select>
                  <button
                    type="submit"
                    disabled={creating}
                    className="h-9 px-4 rounded-lg bg-[#1B5E4B] hover:bg-[#144839] text-white text-[13px] font-medium"
                  >
                    {creating ? 'Đang tạo...' : 'Tạo tài khoản'}
                  </button>
                </div>
                <p className="text-[11px] text-[#8A847C]">
                  Mật khẩu được mã hóa SHA-256 an toàn trong Cloud Firestore (`staff_users`), không
                  cần tạo tài khoản Google hay Firebase Auth cho từng nhân viên.
                </p>
              </form>

              {/* Inline Edit Staff Modal */}
              {editingStaff && (
                <form
                  onSubmit={handleSaveEditedStaff}
                  className="bg-[#FAF9F6] border border-[#1B5E4B]/40 rounded-2xl p-4 space-y-3"
                >
                  <div className="text-[13px] font-semibold text-[#1B5E4B]">
                    Chỉnh sửa thông tin tài khoản @{editingStaff.username}
                  </div>
                  <div className="grid grid-cols-1 sm:grid-cols-4 gap-2.5">
                    <input
                      type="text"
                      required
                      value={editingStaff.fullName}
                      onChange={(e) =>
                        setEditingStaff({ ...editingStaff, fullName: e.target.value })
                      }
                      className="h-9 px-3 rounded-lg border border-[#E5E2DC] bg-white text-[13px]"
                    />
                    <input
                      type="tel"
                      value={editingStaff.phone}
                      onChange={(e) => setEditingStaff({ ...editingStaff, phone: e.target.value })}
                      className="h-9 px-3 rounded-lg border border-[#E5E2DC] bg-white font-mono-num text-[13px]"
                    />
                    <select
                      value={editingStaff.role}
                      disabled={editingStaff.role === 'superadmin'}
                      onChange={(e) =>
                        setEditingStaff({ ...editingStaff, role: e.target.value as StaffRole })
                      }
                      className="h-9 px-3 rounded-lg border border-[#E5E2DC] bg-white text-[13px]"
                    >
                      <option value="receptionist">Lễ tân</option>
                      <option value="housekeeping">Buồng phòng</option>
                      <option value="manager">Quản lý</option>
                      <option value="owner">Chủ khách sạn</option>
                    </select>
                    <div className="flex gap-2">
                      <button
                        type="submit"
                        className="flex-1 h-9 rounded-lg bg-[#1B5E4B] text-white text-[12px] font-medium"
                      >
                        Lưu sửa
                      </button>
                      <button
                        type="button"
                        onClick={() => setEditingStaff(null)}
                        className="h-9 px-3 rounded-lg border border-[#E5E2DC] bg-white text-[12px]"
                      >
                        Hủy
                      </button>
                    </div>
                  </div>
                </form>
              )}

              <div className="space-y-3">
                {staffUsers.map((st) => {
                  const isRoot = st.role === 'superadmin' || st.authSource === 'firebase_superadmin';
                  return (
                    <div
                      key={st.uid}
                      className="bg-white border border-[#E5E2DC] rounded-2xl p-5 space-y-3"
                    >
                      <div className="flex flex-wrap items-center justify-between gap-3">
                        <div>
                          <div className="flex flex-wrap items-center gap-2">
                            <span className="text-[15px] font-semibold text-[#1C1B18]">
                              {st.fullName}
                            </span>
                            <span className="font-mono-num text-[12px] text-[#57534E]">
                              @{st.username}
                            </span>
                            <span className="px-2 py-0.5 rounded bg-[#E8F2EE] text-[#1B5E4B] text-[11px] font-medium">
                              {getRoleLabel(st.role)}
                            </span>
                            {!st.isActive && (
                              <span className="px-2 py-0.5 rounded bg-[#FEF2F2] text-[#B91C1C] text-[11px] font-medium">
                                Đang bị khóa
                              </span>
                            )}
                          </div>
                          <div className="text-[12px] text-[#57534E] font-mono-num mt-0.5">
                            {isRoot ? `Firebase Auth: ${st.email}` : `Tài khoản Firestore`}
                            {st.phone ? ` • SĐT: ${st.phone}` : ''}
                          </div>
                        </div>

                        {!isRoot && (
                          <div className="flex flex-wrap items-center gap-1.5">
                            <button
                              type="button"
                              onClick={() => setEditingStaff(st)}
                              className="h-8 px-2.5 rounded-lg border border-[#E5E2DC] hover:bg-[#F7F6F3] text-[12px] inline-flex items-center gap-1"
                            >
                              <Pencil className="w-3.5 h-3.5" strokeWidth={1.5} />
                              Sửa
                            </button>
                            <button
                              type="button"
                              onClick={() => handleResetPassword(st)}
                              className="h-8 px-2.5 rounded-lg border border-[#E5E2DC] hover:bg-[#F7F6F3] text-[12px] inline-flex items-center gap-1"
                            >
                              <KeyRound className="w-3.5 h-3.5" strokeWidth={1.5} />
                              Đặt lại MK
                            </button>
                            {st.uid !== actor.uid && (
                              <>
                                <button
                                  type="button"
                                  onClick={() => handleToggleActive(st)}
                                  className={`h-8 px-2.5 rounded-lg border text-[12px] font-medium inline-flex items-center gap-1 ${
                                    st.isActive
                                      ? 'border-[#FDE68A] text-[#92400E] hover:bg-[#FFFBEB]'
                                      : 'border-[#A7F3D0] text-[#065F46] hover:bg-[#ECFDF5]'
                                  }`}
                                >
                                  {st.isActive ? (
                                    <>
                                      <Lock className="w-3.5 h-3.5" strokeWidth={1.5} /> Khóa
                                    </>
                                  ) : (
                                    <>
                                      <Unlock className="w-3.5 h-3.5" strokeWidth={1.5} /> Mở khóa
                                    </>
                                  )}
                                </button>
                                <button
                                  type="button"
                                  onClick={() => handleDeleteStaff(st)}
                                  className="h-8 px-2.5 rounded-lg border border-[#FECACA] text-[#B91C1C] hover:bg-[#FEF2F2] text-[12px] inline-flex items-center gap-1"
                                >
                                  <Trash2 className="w-3.5 h-3.5" strokeWidth={1.5} />
                                  Xóa
                                </button>
                              </>
                            )}
                          </div>
                        )}
                      </div>

                      <div className="flex flex-wrap gap-2 pt-2 border-t border-[#F1EFEA]">
                        {PERM_LABELS.map((p) => {
                          const enabled = Boolean(st.permissions?.[p.key]);
                          return (
                            <button
                              key={p.key}
                              type="button"
                              disabled={isRoot}
                              onClick={() => handleTogglePerm(st, p.key)}
                              className={`px-2.5 py-1 rounded-lg border text-[11px] font-medium inline-flex items-center gap-1.5 transition-colors ${
                                enabled
                                  ? 'bg-[#E8F2EE] border-[#1B5E4B]/30 text-[#1B5E4B]'
                                  : 'bg-[#FAF9F6] border-[#E5E2DC] text-[#8A847C]'
                              }`}
                            >
                              <ShieldCheck className="w-3 h-3" strokeWidth={1.5} />
                              {p.label}
                            </button>
                          );
                        })}
                      </div>
                    </div>
                  );
                })}
              </div>
            </>
          )}
        </div>
      )}

      {subTab === 'audit' && (
        <div className="bg-white border border-[#E5E2DC] rounded-2xl p-5 space-y-3">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div>
              <h3 className="text-[15px] font-semibold text-[#1C1B18]">
                Nhật ký Kiểm toán & Hoàn tác chống gian lận (`audit_logs`)
              </h3>
              <p className="text-[12px] text-[#57534E]">
                Lưu vết bất biến chuẩn ngày giờ Việt Nam (HH:mm dd/mm/YYYY)
              </p>
            </div>
            <input
              type="text"
              value={logSearch}
              onChange={(e) => setLogSearch(e.target.value)}
              placeholder="Lọc theo hành động, nhân viên, mã đơn..."
              className="h-8 px-3 rounded-lg border border-[#E5E2DC] text-[12px] w-72"
            />
          </div>

          <div className="overflow-x-auto border border-[#E5E2DC] rounded-xl">
            <table className="w-full text-[12px]">
              <thead className="bg-[#FAF9F6] border-b border-[#E5E2DC] text-[#57534E]">
                <tr>
                  <th className="text-left px-3 py-2 font-medium">Thời gian</th>
                  <th className="text-left px-3 py-2 font-medium">Thao tác</th>
                  <th className="text-left px-3 py-2 font-medium">Đối tượng & Bút toán liên quan</th>
                  <th className="text-left px-3 py-2 font-medium">Lý do & Snapshot kiểm toán</th>
                  <th className="text-left px-3 py-2 font-medium">Nhân viên</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-[#F1EFEA]">
                {filteredLogs.map((l) => {
                  const beforeSnap = l.before_snapshot ?? l.previousState;
                  const afterSnap = l.after_snapshot ?? l.newState;
                  const hasSnapshots = Boolean(beforeSnap || afterSnap);
                  return (
                    <tr key={l.id} className="align-top">
                      <td className="px-3 py-2 font-mono-num text-[11px] text-[#57534E] whitespace-nowrap">
                        {formatDateTimeVN(l.timestamp)}
                      </td>
                      <td className="px-3 py-2">
                        <span
                          className={`px-2 py-0.5 rounded text-[11px] font-mono-num inline-block ${
                            l.actionType.includes('undo') ||
                            l.actionType.includes('void') ||
                            l.actionType.includes('reverse') ||
                            l.actionType.includes('reopen')
                              ? 'bg-[#FFFBEB] text-[#92400E]'
                              : l.actionType.includes('reclassify') ||
                                l.actionType.includes('adjustment') ||
                                l.actionType.includes('lock')
                              ? 'bg-[#EFF6FF] text-[#1D4ED8]'
                              : 'bg-[#F1EFEA] text-[#1C1B18]'
                          }`}
                        >
                          {l.actionType}
                        </span>
                      </td>
                      <td className="px-3 py-2">
                        <div className="font-medium text-[#1C1B18]">{l.targetLabel}</div>
                        {l.relatedTransactionIds && l.relatedTransactionIds.length > 0 && (
                          <div className="mt-1 flex flex-wrap gap-1">
                            {l.relatedTransactionIds.map((txId) => (
                              <span
                                key={txId}
                                className="px-1.5 py-0.5 rounded bg-[#FAF9F6] border border-[#E5E2DC] font-mono-num text-[10px] text-[#57534E]"
                              >
                                {txId}
                              </span>
                            ))}
                          </div>
                        )}
                      </td>
                      <td className="px-3 py-2 text-[#57534E] max-w-md">
                        <div>{l.reason}</div>
                        {hasSnapshots && (
                          <details className="mt-1">
                            <summary className="cursor-pointer text-[11px] text-[#1B5E4B] hover:underline select-none">
                              Xem before / after snapshot
                            </summary>
                            <div className="mt-1.5 grid grid-cols-1 gap-1.5 text-[10px] font-mono-num bg-[#FAF9F6] border border-[#E5E2DC] rounded-lg p-2">
                              {beforeSnap && (
                                <div>
                                  <span className="font-semibold text-[#92400E]">Before: </span>
                                  <span className="break-all text-[#57534E]">
                                    {JSON.stringify(beforeSnap)}
                                  </span>
                                </div>
                              )}
                              {afterSnap && (
                                <div>
                                  <span className="font-semibold text-[#1B5E4B]">After: </span>
                                  <span className="break-all text-[#1C1B18]">
                                    {JSON.stringify(afterSnap)}
                                  </span>
                                </div>
                              )}
                            </div>
                          </details>
                        )}
                      </td>
                      <td className="px-3 py-2 text-[#57534E] whitespace-nowrap">
                        {l.userName || l.performedByName}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  );
};
