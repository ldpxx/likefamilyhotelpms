import React, { useEffect, useState } from 'react';
import {
  BarChart3,
  BedDouble,
  Building2,
  CalendarRange,
  ClipboardList,
  FileSliders,
  Landmark,
  LogOut,
  Menu,
  RotateCcw,
  Search,
  Settings,
  ShieldCheck,
  X,
  type LucideIcon,
} from 'lucide-react';
import { usePms } from './context/PmsContext';
import type { Booking, FormTemplateType, Room } from './types/pms';
import { LoginScreen } from './components/LoginScreen';
import { SuperAdminLoginPage } from './components/SuperAdminLoginPage';
import { RoomGridView } from './components/RoomGridView';
import { TimelineCalendarView } from './components/TimelineCalendarView';
import { AvailabilityFinder } from './components/AvailabilityFinder';
import { BookingsAndGroupsView } from './components/BookingsAndGroupsView';
import { OtaReconciliationView } from './components/OtaReconciliationView';
import { FinanceReportsView } from './components/FinanceReportsView';
import { FormCustomizerView } from './components/FormCustomizerView';
import { StaffAndAuditView } from './components/StaffAndAuditView';
import { SettingsAndAdminView } from './components/SettingsAndAdminView';
import { BookingCreateModal } from './components/BookingCreateModal';
import { GroupBookingModal } from './components/GroupBookingModal';
import { BookingDetailModal } from './components/BookingDetailModal';
import { PrintableFormModal } from './components/PrintableFormModal';
import { RoomMaintenanceModal } from './components/RoomMaintenanceModal';
import { DepositResolutionModal } from './components/DepositResolutionModal';
import { undoBookingAction } from './lib/pmsActions';
import { formatCurrency, formatDateVN, getRoleLabel, todayISO } from './lib/utils';

type NavKey =
  | 'rooms'
  | 'calendar'
  | 'finder'
  | 'bookings'
  | 'ota'
  | 'finance'
  | 'forms'
  | 'staff'
  | 'settings';

export const App: React.FC = () => {
  const {
    authLoading,
    staffProfile,
    hotelConfig,
    bookings,
    actor,
    logout,
    toasts,
    dismissToast,
    undoBanner,
    clearUndoBanner,
    notify,
  } = usePms();

  const [nav, setNav] = useState<NavKey>('rooms');
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);
  const [isSuperAdminRoute, setIsSuperAdminRoute] = useState(
    () => window.location.pathname.toLowerCase().startsWith('/superadmin')
  );

  useEffect(() => {
    const syncPath = () => {
      setIsSuperAdminRoute(window.location.pathname.toLowerCase().startsWith('/superadmin'));
    };
    window.addEventListener('popstate', syncPath);
    return () => window.removeEventListener('popstate', syncPath);
  }, []);

  const navigateAuthRoute = (path: '/' | '/superadmin') => {
    window.history.pushState({}, '', path);
    setIsSuperAdminRoute(path === '/superadmin');
  };

  // Global Modals
  const [createSingleDraft, setCreateSingleDraft] = useState<{
    room?: Room;
    checkIn?: string;
    checkOut?: string;
  } | null>(null);

  const [createGroupDraft, setCreateGroupDraft] = useState<{
    rooms?: Room[];
    checkIn?: string;
    checkOut?: string;
  } | null>(null);

  const [activeBookingModal, setActiveBookingModal] = useState<{
    bookingId: string;
    preselectedTransferRoom?: Room | null;
  } | null>(null);

  const [printFormModal, setPrintFormModal] = useState<{
    booking: Booking;
    type: FormTemplateType;
  } | null>(null);

  const [maintenanceRoom, setMaintenanceRoom] = useState<Room | null>(null);
  const [quickResolveDeposit, setQuickResolveDeposit] = useState<Booking | null>(null);

  const pendingDepositBookings = bookings.filter(
    (b) => b.depositResolutionStatus === 'pending_deposit_resolution'
  );
  const pendingDepositSum = pendingDepositBookings.reduce(
    (s, b) => s + (b.pendingDepositAmount || 0),
    0
  );

  if (authLoading) {
    return (
      <div className="min-h-screen bg-[#F7F6F3] flex items-center justify-center">
        <div className="text-[14px] text-[#57534E]">Đang tải Like Family PMS...</div>
      </div>
    );
  }

  if (!staffProfile) {
    return isSuperAdminRoute ? (
      <SuperAdminLoginPage onGoToStaffLogin={() => navigateAuthRoute('/')} />
    ) : (
      <LoginScreen onGoToSuperAdmin={() => navigateAuthRoute('/superadmin')} />
    );
  }

  const navItems: Array<{
    id: NavKey;
    label: string;
    icon: LucideIcon;
    group: 'frontdesk' | 'management';
  }> = [
    { id: 'rooms', label: 'Sơ đồ phòng', icon: BedDouble, group: 'frontdesk' },
    { id: 'calendar', label: 'Lịch Calendar', icon: CalendarRange, group: 'frontdesk' },
    { id: 'finder', label: 'Tìm phòng trống', icon: Search, group: 'frontdesk' },
    { id: 'bookings', label: 'Đơn, Đoàn & ASM', icon: ClipboardList, group: 'frontdesk' },
    { id: 'ota', label: 'Đối soát OTA', icon: Landmark, group: 'management' },
    { id: 'finance', label: 'Tài chính & P&L', icon: BarChart3, group: 'management' },
    { id: 'forms', label: 'Tùy chỉnh biểu mẫu', icon: FileSliders, group: 'management' },
    { id: 'staff', label: 'Nhân viên & Nhật ký', icon: ShieldCheck, group: 'management' },
    { id: 'settings', label: 'Cài đặt & Sao lưu', icon: Settings, group: 'management' },
  ];

  const activeTitle = navItems.find((i) => i.id === nav)?.label || 'Like Family PMS';

  const handleQuickUndoFromBanner = async () => {
    if (!undoBanner?.bookingId) return;
    const booking = bookings.find((b) => b.id === undoBanner.bookingId);
    if (!booking) return;
    const reason = window.prompt('Nhập lý do hoàn tác thao tác vừa thực hiện:', 'Thao tác nhầm tại quầy');
    if (!reason || !reason.trim()) return;
    try {
      await undoBookingAction({
        booking,
        reason,
        actor,
        overridePrevState: undoBanner.previousState,
      });
      clearUndoBanner();
      notify('Đã hoàn tác thao tác thành công');
    } catch (err) {
      notify(err instanceof Error ? err.message : 'Lỗi hoàn tác', 'error');
    }
  };

  return (
    <div className="min-h-screen bg-[#F7F6F3] flex">
      {/* Desktop Sidebar (248px quiet chrome) */}
      <aside className="no-print hidden lg:flex flex-col w-[248px] shrink-0 bg-white border-r border-[#E5E2DC] h-screen sticky top-0">
        <div className="p-4 border-b border-[#E5E2DC] flex items-center gap-2.5">
          <div className="w-8 h-8 rounded-lg bg-[#1B5E4B] text-white flex items-center justify-center shrink-0">
            <Building2 className="w-4 h-4" strokeWidth={1.5} />
          </div>
          <div className="min-w-0">
            <div className="text-[14px] font-semibold text-[#1C1B18] truncate">
              {hotelConfig.hotelName}
            </div>
            <div className="text-[11px] text-[#8A847C]">Like Family PMS</div>
          </div>
        </div>

        <nav className="flex-1 p-3 overflow-y-auto space-y-5">
          <div>
            <div className="px-2.5 mb-1.5 text-[11px] font-medium text-[#8A847C]">
              Nghiệp vụ lễ tân
            </div>
            <div className="space-y-0.5">
              {navItems
                .filter((i) => i.group === 'frontdesk')
                .map((item) => {
                  const Icon = item.icon;
                  const active = nav === item.id;
                  return (
                    <button
                      key={item.id}
                      type="button"
                      onClick={() => setNav(item.id)}
                      className={`w-full h-9 px-2.5 rounded-lg text-[13px] font-medium flex items-center gap-2.5 transition-colors ${
                        active
                          ? 'bg-[#E8F2EE] text-[#1B5E4B]'
                          : 'text-[#57534E] hover:bg-[#F7F6F3] hover:text-[#1C1B18]'
                      }`}
                    >
                      <Icon className="w-4 h-4 shrink-0" strokeWidth={1.5} />
                      <span className="truncate">{item.label}</span>
                    </button>
                  );
                })}
            </div>
          </div>

          <div>
            <div className="px-2.5 mb-1.5 text-[11px] font-medium text-[#8A847C]">
              Quản trị & Tài chính
            </div>
            <div className="space-y-0.5">
              {navItems
                .filter((i) => i.group === 'management')
                .map((item) => {
                  const Icon = item.icon;
                  const active = nav === item.id;
                  return (
                    <button
                      key={item.id}
                      type="button"
                      onClick={() => setNav(item.id)}
                      className={`w-full h-9 px-2.5 rounded-lg text-[13px] font-medium flex items-center gap-2.5 transition-colors ${
                        active
                          ? 'bg-[#E8F2EE] text-[#1B5E4B]'
                          : 'text-[#57534E] hover:bg-[#F7F6F3] hover:text-[#1C1B18]'
                      }`}
                    >
                      <Icon className="w-4 h-4 shrink-0" strokeWidth={1.5} />
                      <span className="truncate">{item.label}</span>
                    </button>
                  );
                })}
            </div>
          </div>
        </nav>

        <div className="p-3 border-t border-[#E5E2DC] flex items-center justify-between gap-2">
          <div className="min-w-0">
            <div className="text-[12px] font-medium text-[#1C1B18] truncate">
              {staffProfile.fullName}
            </div>
            <div className="text-[11px] text-[#8A847C] truncate">
              {getRoleLabel(staffProfile.role)}
            </div>
          </div>
          <button
            type="button"
            onClick={logout}
            title="Đăng xuất"
            className="w-8 h-8 rounded-lg hover:bg-[#F1EFEA] text-[#57534E] flex items-center justify-center shrink-0"
          >
            <LogOut className="w-4 h-4" strokeWidth={1.5} />
          </button>
        </div>
      </aside>

      {/* Mobile Drawer */}
      {mobileMenuOpen && (
        <div className="fixed inset-0 z-50 lg:hidden bg-black/40 flex">
          <div className="w-64 bg-white h-full flex flex-col p-4">
            <div className="flex items-center justify-between pb-3 border-b border-[#E5E2DC]">
              <span className="font-semibold text-[14px]">{hotelConfig.hotelName}</span>
              <button
                type="button"
                onClick={() => setMobileMenuOpen(false)}
                className="p-1 text-[#57534E]"
              >
                <X className="w-4 h-4" strokeWidth={1.5} />
              </button>
            </div>
            <div className="flex-1 py-3 space-y-1 overflow-y-auto">
              {navItems.map((item) => {
                const Icon = item.icon;
                return (
                  <button
                    key={item.id}
                    type="button"
                    onClick={() => {
                      setNav(item.id);
                      setMobileMenuOpen(false);
                    }}
                    className={`w-full h-9 px-2.5 rounded-lg text-[13px] font-medium flex items-center gap-2.5 ${
                      nav === item.id
                        ? 'bg-[#E8F2EE] text-[#1B5E4B]'
                        : 'text-[#57534E] hover:bg-[#F7F6F3]'
                    }`}
                  >
                    <Icon className="w-4 h-4" strokeWidth={1.5} />
                    {item.label}
                  </button>
                );
              })}
            </div>
            <button
              type="button"
              onClick={logout}
              className="h-9 rounded-lg border border-[#E5E2DC] text-[13px] font-medium flex items-center justify-center gap-2"
            >
              <LogOut className="w-4 h-4" strokeWidth={1.5} /> Đăng xuất
            </button>
          </div>
          <div className="flex-1" onClick={() => setMobileMenuOpen(false)} />
        </div>
      )}

      {/* Main Content Column */}
      <div className="flex-1 min-w-0 flex flex-col">
        <header className="no-print h-14 bg-white border-b border-[#E5E2DC] px-4 lg:px-6 flex items-center justify-between gap-3 sticky top-0 z-20">
          <div className="flex items-center gap-3">
            <button
              type="button"
              onClick={() => setMobileMenuOpen(true)}
              className="lg:hidden w-8 h-8 rounded-lg border border-[#E5E2DC] flex items-center justify-center text-[#1C1B18]"
            >
              <Menu className="w-4 h-4" strokeWidth={1.5} />
            </button>
            <h1 className="text-[16px] font-semibold text-[#1C1B18]">{activeTitle}</h1>
            <span className="hidden sm:inline text-[12px] font-mono-num text-[#8A847C]">
              Hôm nay: {formatDateVN(todayISO())}
            </span>
          </div>

          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={() => setCreateGroupDraft({})}
              className="hidden sm:inline-flex h-8 px-3 rounded-lg border border-[#E5E2DC] hover:bg-[#F7F6F3] text-[12px] font-medium text-[#1C1B18] items-center"
            >
              + Đặt đoàn
            </button>
            <button
              type="button"
              onClick={() => setCreateSingleDraft({})}
              className="h-8 px-3.5 rounded-lg bg-[#1B5E4B] hover:bg-[#144839] text-white text-[12px] font-medium transition-colors"
            >
              + Đặt phòng mới
            </button>
          </div>
        </header>

        <main className="flex-1 p-4 lg:p-6 max-w-[1520px] w-full mx-auto">
          {pendingDepositBookings.length > 0 && (
            <div className="no-print mb-4 px-4 py-3 rounded-xl bg-[#FFFBEB] border border-[#FDE68A] flex flex-wrap items-center justify-between gap-3 text-[13px] text-[#92400E]">
              <div>
                <strong>Nhắc chủ khách sạn:</strong> Hiện có{' '}
                <strong className="font-mono-num">{pendingDepositBookings.length}</strong> đơn hủy
                đang treo tiền cọc chờ xử lý (Tổng:{' '}
                <strong className="font-mono-num">{formatCurrency(pendingDepositSum)}</strong> —
                chưa tính vào doanh thu).
              </div>
              <button
                type="button"
                onClick={() => setQuickResolveDeposit(pendingDepositBookings[0])}
                className="h-8 px-3 rounded-lg bg-[#B45309] hover:bg-[#92400E] text-white text-[12px] font-medium shrink-0"
              >
                Xử lý cọc treo ngay
              </button>
            </div>
          )}

          {nav === 'rooms' && (
            <RoomGridView
              onSelectBooking={(b) => setActiveBookingModal({ bookingId: b.id })}
              onQuickCreateBooking={(room) => setCreateSingleDraft({ room })}
              onOpenMaintenance={(room) => setMaintenanceRoom(room)}
              onSwitchToFinder={() => setNav('finder')}
            />
          )}

          {nav === 'calendar' && (
            <TimelineCalendarView
              onSelectBooking={(b) => setActiveBookingModal({ bookingId: b.id })}
              onCreateFromRange={({ room, checkIn, checkOut }) =>
                setCreateSingleDraft({ room, checkIn, checkOut })
              }
              onRequestTransferRoom={(booking, targetRoom) =>
                setActiveBookingModal({
                  bookingId: booking.id,
                  preselectedTransferRoom: targetRoom,
                })
              }
            />
          )}

          {nav === 'finder' && (
            <AvailabilityFinder
              onCreateSingleBooking={({ room, checkIn, checkOut }) =>
                setCreateSingleDraft({ room, checkIn, checkOut })
              }
              onCreateGroupBooking={({ rooms, checkIn, checkOut }) =>
                setCreateGroupDraft({ rooms, checkIn, checkOut })
              }
            />
          )}

          {nav === 'bookings' && (
            <BookingsAndGroupsView
              onSelectBooking={(b) => setActiveBookingModal({ bookingId: b.id })}
              onOpenNewSingle={() => setCreateSingleDraft({})}
              onOpenNewGroup={() => setCreateGroupDraft({})}
            />
          )}

          {nav === 'ota' && (
            <OtaReconciliationView
              onSelectBooking={(b) => setActiveBookingModal({ bookingId: b.id })}
            />
          )}

          {nav === 'finance' && <FinanceReportsView />}
          {nav === 'forms' && <FormCustomizerView />}
          {nav === 'staff' && <StaffAndAuditView />}
          {nav === 'settings' && <SettingsAndAdminView />}
        </main>
      </div>

      {/* Global Modals */}
      {createSingleDraft && (
        <BookingCreateModal
          initialRoom={createSingleDraft.room}
          initialCheckIn={createSingleDraft.checkIn}
          initialCheckOut={createSingleDraft.checkOut}
          onClose={() => setCreateSingleDraft(null)}
        />
      )}

      {createGroupDraft && (
        <GroupBookingModal
          initialRooms={createGroupDraft.rooms}
          initialCheckIn={createGroupDraft.checkIn}
          initialCheckOut={createGroupDraft.checkOut}
          onClose={() => setCreateGroupDraft(null)}
        />
      )}

      {activeBookingModal && (
        <BookingDetailModal
          bookingId={activeBookingModal.bookingId}
          preselectedTransferRoom={activeBookingModal.preselectedTransferRoom}
          onClose={() => setActiveBookingModal(null)}
          onOpenFormPreview={(booking, type) => setPrintFormModal({ booking, type })}
        />
      )}

      {printFormModal && (
        <PrintableFormModal
          booking={printFormModal.booking}
          initialType={printFormModal.type}
          onClose={() => setPrintFormModal(null)}
        />
      )}

      {maintenanceRoom && (
        <RoomMaintenanceModal
          room={maintenanceRoom}
          onClose={() => setMaintenanceRoom(null)}
        />
      )}

      {quickResolveDeposit && (
        <DepositResolutionModal
          booking={quickResolveDeposit}
          onClose={() => setQuickResolveDeposit(null)}
        />
      )}

      {/* 15-Second Instant Universal Undo Bar */}
      {undoBanner && (
        <div className="no-print fixed bottom-5 right-5 z-50 bg-[#1C1B18] text-white rounded-xl px-4 py-3 shadow-lg flex items-center gap-3 text-[13px]">
          <span>{undoBanner.label}</span>
          <button
            type="button"
            onClick={handleQuickUndoFromBanner}
            className="h-7 px-2.5 rounded-md bg-[#F59E0B] hover:bg-[#D97706] text-[#1C1B18] font-semibold inline-flex items-center gap-1 text-[12px]"
          >
            <RotateCcw className="w-3.5 h-3.5" strokeWidth={1.75} />
            Hoàn tác
          </button>
          <button
            type="button"
            onClick={clearUndoBanner}
            className="text-white/60 hover:text-white"
          >
            <X className="w-4 h-4" strokeWidth={1.5} />
          </button>
        </div>
      )}

      {/* Toast Notifications */}
      <div className="no-print fixed top-16 right-4 z-50 space-y-2 w-80 max-w-[calc(100vw-2rem)]">
        {toasts.map((t) => (
          <div
            key={t.id}
            className={`px-3.5 py-2.5 rounded-xl border text-[12px] shadow-sm flex items-start justify-between gap-2 ${
              t.type === 'error'
                ? 'bg-[#FEF2F2] border-[#FECACA] text-[#991B1B]'
                : t.type === 'warning'
                ? 'bg-[#FFFBEB] border-[#FDE68A] text-[#92400E]'
                : t.type === 'info'
                ? 'bg-[#EFF6FF] border-[#BFDBFE] text-[#1E40AF]'
                : 'bg-[#ECFDF5] border-[#A7F3D0] text-[#065F46]'
            }`}
          >
            <span>{t.message}</span>
            <button
              type="button"
              onClick={() => dismissToast(t.id)}
              className="opacity-60 hover:opacity-100 shrink-0"
            >
              <X className="w-3.5 h-3.5" strokeWidth={1.5} />
            </button>
          </div>
        ))}
      </div>
    </div>
  );
};

export default App;
