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
  replaceForgottenStaffAccount,
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

  // Audit filter & GoHost-inspired Staff Activity Summary view
  const [logSearch, setLogSearch] = useState('');
  const [auditViewMode, setAuditViewMode] = useState<'by_staff' | 'all'>('by_staff');

  const auditSummary = useMemo(() => {
    const priceEdits = auditLogs.filter(
      (l) => l.actionType.includes('price') || l.actionType.includes('adjustment')
    ).length;
    const cancelsOrVoids = auditLogs.filter(
      (l) =>
        l.actionType.includes('cancel') ||
        l.actionType.includes('void') ||
        l.actionType.includes('no_show')
    ).length;
    const moneyReversals = auditLogs.filter(
      (l) =>
        l.actionType.includes('refund') ||
        l.actionType.includes('reclassify') ||
        l.actionType.includes('undo') ||
        l.actionType.includes('reverse')
    ).length;

    const byStaffMap = new Map<
      string,
      {
        name: string;
        total: number;
        bookings: number;
        priceEdits: number;
        cancels: number;
        reversals: number;
        firstTs: string;
        lastTs: string;
      }
    >();

    for (const l of auditLogs) {
      const name = l.userName || l.performedByName || 'Hệ thống';
      const cur = byStaffMap.get(name) || {
        name,
        total: 0,
        bookings: 0,
        priceEdits: 0,
        cancels: 0,
        reversals: 0,
        firstTs: l.timestamp,
        lastTs: l.timestamp,
      };
      cur.total += 1;
      if (l.actionType.includes('booking') || l.actionType.includes('check_')) cur.bookings += 1;
      if (l.actionType.includes('price') || l.actionType.includes('adjustment'))
        cur.priceEdits += 1;
      if (
        l.actionType.includes('cancel') ||
        l.actionType.includes('void') ||
        l.actionType.includes('no_show')
      )
        cur.cancels += 1;
      if (
        l.actionType.includes('refund') ||
        l.actionType.includes('reclassify') ||
        l.actionType.includes('undo') ||
        l.actionType.includes('reverse')
      )
        cur.reversals += 1;
      if (l.timestamp < cur.firstTs) cur.firstTs = l.timestamp;
      if (l.timestamp > cur.lastTs) cur.lastTs = l.timestamp;
      byStaffMap.set(name, cur);
    }

    return {
      total: auditLogs.length,
      priceEdits,
      cancelsOrVoids,
      moneyReversals,
      byStaff: Array.from(byStaffMap.values()).sort((a, b) => b.total - a.total),
    };
  }, [auditLogs]);

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
    const newUsernamePrompt = window.prompt(
      `Do tài khoản dùng Firebase Auth bảo mật (không lưu mật khẩu trên Firestore), thao tác này sẽ KHÓA @${staff.username} cũ và cấp tài khoản mới với cùng phân quyền.\n\nNhập tên đăng nhập mới (ví dụ: ${staff.username}2):`,
      `${staff.username}2`
    );
    if (!newUsernamePrompt || !newUsernamePrompt.trim()) return;
    const tempPwd = window.prompt(
      `Nhập mật khẩu tạm (tối thiểu 6 ký tự) cho @${newUsernamePrompt.trim()} (nhân viên sẽ bắt buộc đổi khi đăng nhập lần đầu):`
    );
    if (!tempPwd || tempPwd.trim().length < 6) {
      notify('Mật khẩu tạm cần ít nhất 6 ký tự.', 'error');
      return;
    }
    try {
      const replacement = await replaceForgottenStaffAccount({
        oldStaff: staff,
        newUsername: newUsernamePrompt.trim(),
        tempPassword: tempPwd,
        actor,
      });
      notify(
        `Đã khóa @${staff.username} và cấp tài khoản mới @${replacement.username} (bắt buộc đổi MK lần đầu)`
      );
    } catch (err) {
      notify(err instanceof Error ? err.message : 'Lỗi cấp lại tài khoản', 'error');
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
                {(staffProfile.authSource === 'firebase_staff' ||
                  staffProfile.authSource === 'firestore_staff') && (
                  <>
                    <input
                      type="password"
                      value={myCurPass}
                      onChange={(e) => setMyCurPass(e.target.value)}
                      placeholder="Mật khẩu hiện tại (bắt buộc khi đổi)"
                      className="h-9 px-3 rounded-lg border border-[#E5E2DC] text-[13px]"
                    />
                    <input
                      type="password"
                      minLength={6}
                      value={myNewPass}
                      onChange={(e) => setMyNewPass(e.target.value)}
                      placeholder="Mật khẩu mới ≥ 6 ký tự (tùy chọn)"
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
                    minLength={6}
                    value={newPassword}
                    onChange={(e) => setNewPassword(e.target.value)}
                    placeholder="Mật khẩu tạm ≥ 6 ký tự *"
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
                  Tài khoản được xác thực trực tiếp bởi Firebase Auth (không lưu mật khẩu trong Firestore, tạo qua Secondary App để không ngắt phiên Chủ KS). Nhân viên mới sẽ bắt buộc đổi mật khẩu ở lần đăng nhập đầu tiên.
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
                            <span className="px-2 py-0.5 rounded bg-[#E8F3EC] text-[#0F5132] text-[11px] font-medium">
                              {getRoleLabel(st.role)}
                            </span>
                            {st.mustChangePassword && (
                              <span className="px-2 py-0.5 rounded bg-[#FEF3C7] text-[#92400E] text-[11px] font-medium">
                                Chờ đổi MK lần đầu
                              </span>
                            )}
                            {!st.isActive && (
                              <span className="px-2 py-0.5 rounded bg-[#FEF2F2] text-[#B91C1C] text-[11px] font-medium">
                                Đang bị khóa
                              </span>
                            )}
                          </div>
                          <div className="text-[12px] text-[#57534E] font-mono-num mt-0.5">
                            {isRoot
                              ? `Firebase Auth (SuperAdmin): ${st.email}`
                              : `Firebase Auth nội bộ: ${st.email || `${st.username}@likefamilypms.local`}`}
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
                              Cấp lại TK
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
        <div className="space-y-4">
          {/* 4 Anti-Fraud Audit Anomaly KPI Cards (GoHost-inspired) */}
          <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
            <div className="bg-white border border-[#E7E3DA] rounded-xl p-4">
              <div className="text-[11px] font-medium text-[#8A847C] uppercase">Tổng thao tác</div>
              <div className="mt-1 text-[22px] font-bold font-mono-num text-[#1C1B18]">
                {auditSummary.total}
              </div>
            </div>
            <div className="bg-white border border-[#E7E3DA] rounded-xl p-4">
              <div className="text-[11px] font-medium text-[#8A847C] uppercase">
                Thao tác đụng giá / Điều chỉnh
              </div>
              <div className="mt-1 text-[22px] font-bold font-mono-num text-[#D97706]">
                {auditSummary.priceEdits}
              </div>
            </div>
            <div className="bg-white border border-[#E7E3DA] rounded-xl p-4">
              <div className="text-[11px] font-medium text-[#8A847C] uppercase">
                Đơn bị hủy / Void / No-show
              </div>
              <div className="mt-1 text-[22px] font-bold font-mono-num text-[#B91C1C]">
                {auditSummary.cancelsOrVoids}
              </div>
            </div>
            <div className="bg-white border border-[#E7E3DA] rounded-xl p-4">
              <div className="text-[11px] font-medium text-[#8A847C] uppercase">
                Hoàn tác / Đổi PTTT / Đảo CI
              </div>
              <div className="mt-1 text-[22px] font-bold font-mono-num text-[#0F5132]">
                {auditSummary.moneyReversals}
              </div>
            </div>
          </div>

          <div className="bg-white border border-[#E7E3DA] rounded-2xl p-5 space-y-4">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div className="flex flex-wrap items-center gap-3">
                <div className="inline-flex p-0.5 rounded-lg bg-[#F3F0E9]">
                  <button
                    type="button"
                    onClick={() => setAuditViewMode('by_staff')}
                    className={`h-8 px-3 rounded-md text-[12px] font-medium ${
                      auditViewMode === 'by_staff'
                        ? 'bg-[#0F5132] text-white'
                        : 'text-[#57534E] hover:text-[#1C1B18]'
                    }`}
                  >
                    Theo nhân viên ({auditSummary.byStaff.length})
                  </button>
                  <button
                    type="button"
                    onClick={() => setAuditViewMode('all')}
                    className={`h-8 px-3 rounded-md text-[12px] font-medium ${
                      auditViewMode === 'all'
                        ? 'bg-[#0F5132] text-white'
                        : 'text-[#57534E] hover:text-[#1C1B18]'
                    }`}
                  >
                    Tất cả hoạt động ({auditLogs.length})
                  </button>
                </div>
                <p className="text-[12px] text-[#8A847C]">
                  {auditViewMode === 'by_staff'
                    ? 'Bấm một dòng nhân viên để lọc nhanh chi tiết dòng thời gian kiểm toán'
                    : 'Lưu vết bất biến chuẩn HH:mm dd/mm/YYYY kèm Before/After Snapshot'}
                </p>
              </div>
              {auditViewMode === 'all' && (
                <input
                  type="text"
                  value={logSearch}
                  onChange={(e) => setLogSearch(e.target.value)}
                  placeholder="Lọc theo hành động, nhân viên, mã đơn, mã bút toán..."
                  className="h-8 px-3 rounded-lg border border-[#E7E3DA] text-[12px] w-72 focus:outline-none focus:border-[#0F5132]"
                />
              )}
            </div>

            {auditViewMode === 'by_staff' ? (
              <div className="overflow-x-auto border border-[#E7E3DA] rounded-xl">
                <table className="w-full text-[12px] min-w-[680px]">
                  <thead className="bg-[#FAF9F6] border-b border-[#E7E3DA] text-[#57534E]">
                    <tr>
                      <th className="text-left px-3.5 py-2 font-medium">Nhân viên</th>
                      <th className="text-left px-3.5 py-2 font-medium">Hoạt động gần nhất</th>
                      <th className="text-right px-3.5 py-2 font-medium">Tổng thao tác</th>
                      <th className="text-right px-3.5 py-2 font-medium">Đơn phòng</th>
                      <th className="text-right px-3.5 py-2 font-medium">Đụng giá</th>
                      <th className="text-right px-3.5 py-2 font-medium">Hủy / Void</th>
                      <th className="text-right px-3.5 py-2 font-medium">Hoàn tác / Đổi PTTT</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-[#F1EFEA]">
                    {auditSummary.byStaff.map((row) => (
                      <tr
                        key={row.name}
                        onClick={() => {
                          setLogSearch(row.name);
                          setAuditViewMode('all');
                        }}
                        className="hover:bg-[#FAF9F6] cursor-pointer"
                      >
                        <td className="px-3.5 py-2.5 font-semibold text-[#1C1B18]">
                          <span className="inline-flex items-center gap-2">
                            <span className="w-7 h-7 rounded-full bg-[#E8F3EC] text-[#0F5132] font-bold text-[11px] inline-flex items-center justify-center uppercase">
                              {row.name.slice(0, 1)}
                            </span>
                            {row.name}
                          </span>
                        </td>
                        <td className="px-3.5 py-2.5 font-mono-num text-[11px] text-[#57534E]">
                          {formatDateTimeVN(row.lastTs)}
                        </td>
                        <td className="px-3.5 py-2.5 text-right font-mono-num font-semibold">
                          {row.total}
                        </td>
                        <td className="px-3.5 py-2.5 text-right font-mono-num">{row.bookings}</td>
                        <td
                          className={`px-3.5 py-2.5 text-right font-mono-num ${
                            row.priceEdits > 0 ? 'text-[#D97706] font-semibold' : 'text-[#8A847C]'
                          }`}
                        >
                          {row.priceEdits}
                        </td>
                        <td
                          className={`px-3.5 py-2.5 text-right font-mono-num ${
                            row.cancels > 0 ? 'text-[#B91C1C] font-semibold' : 'text-[#8A847C]'
                          }`}
                        >
                          {row.cancels}
                        </td>
                        <td
                          className={`px-3.5 py-2.5 text-right font-mono-num ${
                            row.reversals > 0 ? 'text-[#0F5132] font-semibold' : 'text-[#8A847C]'
                          }`}
                        >
                          {row.reversals}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            ) : (
              <div className="overflow-x-auto border border-[#E7E3DA] rounded-xl">
                <table className="w-full text-[12px]">
                  <thead className="bg-[#FAF9F6] border-b border-[#E7E3DA] text-[#57534E]">
                    <tr>
                      <th className="text-left px-3 py-2 font-medium">Thời gian</th>
                      <th className="text-left px-3 py-2 font-medium">Thao tác</th>
                      <th className="text-left px-3 py-2 font-medium">
                        Đối tượng &amp; Bút toán liên quan
                      </th>
                      <th className="text-left px-3 py-2 font-medium">
                        Lý do &amp; Snapshot kiểm toán
                      </th>
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
                                  ? 'bg-[#E8F3EC] text-[#0F5132]'
                                  : 'bg-[#F3F0E9] text-[#1C1B18]'
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
                                    className="px-1.5 py-0.5 rounded bg-[#FAF9F6] border border-[#E7E3DA] font-mono-num text-[10px] text-[#57534E]"
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
                                <summary className="cursor-pointer text-[11px] text-[#0F5132] hover:underline select-none">
                                  Xem before / after snapshot
                                </summary>
                                <div className="mt-1.5 grid grid-cols-1 gap-1.5 text-[10px] font-mono-num bg-[#FAF9F6] border border-[#E7E3DA] rounded-lg p-2">
                                  {beforeSnap && (
                                    <div>
                                      <span className="font-semibold text-[#B45309]">Before: </span>
                                      <span className="break-all text-[#57534E]">
                                        {JSON.stringify(beforeSnap)}
                                      </span>
                                    </div>
                                  )}
                                  {afterSnap && (
                                    <div>
                                      <span className="font-semibold text-[#0F5132]">After: </span>
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
            )}
          </div>
        </div>
      )}
    </div>
  );
};
