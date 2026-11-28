import React, { useEffect, useState } from 'react';
import { doc, getDoc, setDoc } from 'firebase/firestore';
import {
  CheckCircle2,
  Clock,
  Database,
  Download,
  Image as ImageIcon,
  KeyRound,
  Lock,
  Pencil,
  Plus,
  Power,
  Save,
  Search,
  ShieldAlert,
  Star,
  Trash2,
  Unlock,
  Upload,
} from 'lucide-react';
import { db } from '../lib/firebase';
import { usePms } from '../context/PmsContext';
import type {
  BookingSourceConfig,
  GeminiApiKeyEntry,
  GuestDocument,
  HotelConfig,
  PriceTier,
  Room,
  RoomType,
  ServiceCatalogItem,
  ServiceItemGroup,
  SystemAiConfig,
} from '../types/pms';
import { VIETNAM_BANKS } from '../lib/vietqr';
import { saveSystemAiConfig, testGeminiApiKey } from '../lib/geminiOcr';
import {
  cleanupOldGuestDocumentPhotos,
  ensureServiceCatalogConfig,
  restoreMissingDefaultBookingSources,
  scanOldGuestDocumentPhotos,
  writeAuditLog,
} from '../lib/pmsActions';
import { DEFAULT_SERVICE_CATALOG } from '../lib/seedData';
import { exportFullBackupExcel, exportFullBackupJson } from '../lib/backupExport';
import {
  compressLogoImage,
  estimateBase64Bytes,
  formatFileSizeKB,
} from '../lib/imageCompression';
import {
  addDays,
  formatCurrency,
  formatDateVN,
  generateId,
  normalizeVietnamese,
  todayISO,
} from '../lib/utils';
import { DateInputVN } from './DateInputVN';
import { PaginationBar, usePagination } from './PaginationBar';

export const SettingsAndAdminView: React.FC = () => {
  const {
    hotelConfig,
    roomTypes,
    rooms,
    bookings,
    groups,
    guests,
    transactions,
    otaBatches,
    maintenances,
    shiftHandovers,
    staffUsers,
    auditLogs,
    isSuperAdmin,
    staffProfile,
    actor,
    seedSampleHotel,
    notify,
  } = usePms();

  const canManageRoomsAndSources =
    isSuperAdmin ||
    staffProfile?.role === 'owner' ||
    Boolean(staffProfile?.permissions?.canManageConfig);
  const canManageAccountingLock = isSuperAdmin || staffProfile?.role === 'owner';
  const canManageHotelLogo = isSuperAdmin || staffProfile?.role === 'owner';
  const canManageServiceCatalog = isSuperAdmin || staffProfile?.role === 'owner';

  const [tab, setTab] = useState<'hotel' | 'rooms' | 'services' | 'sources' | 'gemini' | 'data'>('hotel');

  // Service & F&B Catalog state (Owner / SuperAdmin)
  const [svcGroupFilter, setSvcGroupFilter] = useState<'all' | ServiceItemGroup>('all');
  const [svcSearch, setSvcSearch] = useState('');
  const [newSvcName, setNewSvcName] = useState('');
  const [newSvcCategory, setNewSvcCategory] = useState<ServiceItemGroup>('drink');
  const [newSvcPrice, setNewSvcPrice] = useState(20000);
  const [editingSvc, setEditingSvc] = useState<ServiceCatalogItem | null>(null);
  const [savingSvc, setSavingSvc] = useState(false);
  const svcInitAttemptedRef = React.useRef(false);

  // Hotel Config state (SuperAdmin for VietQR/info; SuperAdmin & Owner for centralized hotel logo)
  const [cfg, setCfg] = useState<HotelConfig>(hotelConfig);
  const [savingCfg, setSavingCfg] = useState(false);
  const [savingLogo, setSavingLogo] = useState(false);

  // Part C Rule 8: Accounting Period Lock state (SuperAdmin & Owner)
  const [lockDateInput, setLockDateInput] = useState<string>(
    hotelConfig.accountingLockDate || addDays(todayISO(), -1)
  );
  const [lockReason, setLockReason] = useState('');
  const [savingLock, setSavingLock] = useState(false);

  // Room Types & Rooms (NO DELETE — only Add, Edit, Toggle isActive!)
  const [rtName, setRtName] = useState('');
  const [rtDefaultPrice, setRtDefaultPrice] = useState(400000);
  const [rtFirstHour, setRtFirstHour] = useState(150000);
  const [rtSecondHour, setRtSecondHour] = useState(50000);
  const [rtAddHour, setRtAddHour] = useState(30000);
  const [editingRt, setEditingRt] = useState<RoomType | null>(null);

  const [newRoomNum, setNewRoomNum] = useState('');
  const [newRoomFloor, setNewRoomFloor] = useState(hotelConfig.floors[0] || 'Tầng 2');
  const [newRoomTypeId, setNewRoomTypeId] = useState(roomTypes[0]?.id || '');
  const [editingRoom, setEditingRoom] = useState<Room | null>(null);

  // Booking Sources & OTA Channels (NO DELETE — only Add, Edit, Toggle isActive!)
  const [newSrcName, setNewSrcName] = useState('');
  const [newSrcKind, setNewSrcKind] = useState<'direct' | 'ota'>('ota');

  // Gemini AI Keys state (SuperAdmin only)
  const [apiKeys, setApiKeys] = useState<GeminiApiKeyEntry[]>([]);
  const [preferredModel, setPreferredModel] = useState('');
  const [newKeyInput, setNewKeyInput] = useState('');
  const [newKeyLabel, setNewKeyLabel] = useState('');
  const [testingKey, setTestingKey] = useState(false);
  const [testResult, setTestResult] = useState<string | null>(null);

  // SuperAdmin Manual Old Photo Cleanup state
  const [cutoffDate, setCutoffDate] = useState(() => addDays(todayISO(), -60));
  const [scanResult, setScanResult] = useState<{
    docs: GuestDocument[];
    totalBytes: number;
    imageCount: number;
  } | null>(null);
  const [scanningCleanup, setScanningCleanup] = useState(false);
  const [cleaning, setCleaning] = useState(false);

  useEffect(() => {
    setCfg(hotelConfig);
    if (hotelConfig.accountingLockDate) {
      setLockDateInput(hotelConfig.accountingLockDate);
    }
  }, [hotelConfig]);

  const handleSaveAccountingLock = async (nextDate: string | null) => {
    if (!canManageAccountingLock) return;
    if (!lockReason.trim()) {
      notify('Vui lòng nhập lý do khóa/mở khóa sổ kế toán để ghi nhật ký kiểm toán', 'warning');
      return;
    }
    setSavingLock(true);
    try {
      const prevDate = hotelConfig.accountingLockDate || null;
      await setDoc(
        doc(db, 'hotel_config', 'main'),
        { accountingLockDate: nextDate, updatedAt: new Date().toISOString() },
        { merge: true }
      );
      await writeAuditLog({
        actionType: 'set_accounting_lock_date',
        targetId: 'hotel_config_main',
        targetLabel: nextDate
          ? `Khóa sổ kế toán đến hết ngày ${formatDateVN(nextDate)}`
          : 'Gỡ khóa sổ kế toán theo kỳ',
        previousState: { accountingLockDate: prevDate },
        newState: { accountingLockDate: nextDate },
        reason: lockReason.trim(),
        actor,
      });
      setLockReason('');
      notify(
        nextDate
          ? `Đã khóa sổ kế toán đến hết ngày ${formatDateVN(nextDate)}`
          : 'Đã gỡ khóa sổ kế toán theo kỳ',
        'info'
      );
    } catch (err) {
      notify(err instanceof Error ? err.message : 'Lỗi cập nhật khóa sổ kế toán', 'error');
    } finally {
      setSavingLock(false);
    }
  };

  useEffect(() => {
    if (tab !== 'services' || !canManageServiceCatalog || svcInitAttemptedRef.current) return;
    svcInitAttemptedRef.current = true;
    void ensureServiceCatalogConfig(actor).catch(() => { });
  }, [tab, canManageServiceCatalog, actor]);

  const currentServiceCatalog: ServiceCatalogItem[] = Array.isArray(hotelConfig.serviceCatalog)
    ? hotelConfig.serviceCatalog
    : DEFAULT_SERVICE_CATALOG;

  const filteredServiceCatalogItems = React.useMemo(() => {
    const normQ = normalizeVietnamese(svcSearch.trim());
    return currentServiceCatalog.filter((it) => {
      if (svcGroupFilter !== 'all' && it.category !== svcGroupFilter) return false;
      if (normQ && !normalizeVietnamese(it.name).includes(normQ)) return false;
      return true;
    });
  }, [currentServiceCatalog, svcGroupFilter, svcSearch]);

  const serviceCatalogPag = usePagination(
    filteredServiceCatalogItems,
    `${svcGroupFilter}|${svcSearch}`,
    20
  );

  const saveServiceCatalog = async (nextList: ServiceCatalogItem[], label: string) => {
    if (!canManageServiceCatalog) return;
    setSavingSvc(true);
    try {
      const nowIso = new Date().toISOString();
      await setDoc(
        doc(db, 'hotel_config', 'main'),
        { serviceCatalog: nextList, updatedAt: nowIso },
        { merge: true }
      );
      await writeAuditLog({
        actionType: 'update_service_catalog',
        targetId: 'hotel_config_main',
        targetLabel: label,
        newState: { count: nextList.length },
        reason: 'Cập nhật danh mục dịch vụ & bảng giá bán',
        actor,
      }).catch(() => { });
    } catch (err) {
      notify(err instanceof Error ? err.message : 'Lỗi lưu bảng giá dịch vụ', 'error');
      throw err;
    } finally {
      setSavingSvc(false);
    }
  };

  const handleAddServiceCatalogItem = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!canManageServiceCatalog || !newSvcName.trim()) return;
    const item: ServiceCatalogItem = {
      id: generateId('svc'),
      name: newSvcName.trim(),
      category: newSvcCategory,
      price: Math.max(0, Math.round(newSvcPrice)),
      isActive: true,
      order: currentServiceCatalog.length + 1,
    };
    await saveServiceCatalog([...currentServiceCatalog, item], `Thêm dịch vụ "${item.name}"`);
    setNewSvcName('');
    setNewSvcPrice(20000);
    notify(`Đã thêm "${item.name}" (${formatCurrency(item.price)}) vào bảng giá`);
  };

  const handleSaveEditedServiceCatalogItem = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!canManageServiceCatalog || !editingSvc || !editingSvc.name.trim()) return;
    const clean: ServiceCatalogItem = {
      ...editingSvc,
      name: editingSvc.name.trim(),
      price: Math.max(0, Math.round(editingSvc.price)),
    };
    const nextList = currentServiceCatalog.map((it) => (it.id === clean.id ? clean : it));
    await saveServiceCatalog(nextList, `Cập nhật dịch vụ "${clean.name}"`);
    setEditingSvc(null);
    notify(`Đã cập nhật "${clean.name}" (${formatCurrency(clean.price)})`);
  };

  const handleToggleServiceCatalogActive = async (item: ServiceCatalogItem) => {
    if (!canManageServiceCatalog) return;
    const nextActive = item.isActive === false;
    const nextList = currentServiceCatalog.map((it) =>
      it.id === item.id ? { ...it, isActive: nextActive } : it
    );
    await saveServiceCatalog(
      nextList,
      `${nextActive ? 'Mở bán lại' : 'Tạm ngừng'} dịch vụ "${item.name}"`
    );
    notify(
      nextActive ? `Đã mở bán lại "${item.name}"` : `Đã tạm ngừng bán "${item.name}"`,
      'info'
    );
  };

  useEffect(() => {
    if (!newRoomTypeId && roomTypes[0]) setNewRoomTypeId(roomTypes[0].id);
  }, [roomTypes, newRoomTypeId]);

  useEffect(() => {
    getDoc(doc(db, 'system_config', 'global_settings'))
      .then((snap) => {
        if (snap.exists()) {
          const data = snap.data() as SystemAiConfig;
          setApiKeys(data.geminiApiKeys || []);
          setPreferredModel(data.preferredModel || '');
        }
      })
      .catch(() => { });
  }, []);

  const handleSaveHotelConfig = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!isSuperAdmin) return;
    setSavingCfg(true);
    try {
      await setDoc(
        doc(db, 'hotel_config', 'main'),
        { ...cfg, updatedAt: new Date().toISOString() },
        { merge: true }
      );
      notify('Đã lưu cấu hình khách sạn & tài khoản VietQR');
    } finally {
      setSavingCfg(false);
    }
  };

  const currentHotelLogo = cfg.hotelLogoBase64 || cfg.logoBase64 || '';

  const handleUploadHotelLogo = async (file: File | undefined) => {
    if (!file || !canManageHotelLogo) return;
    setSavingLogo(true);
    try {
      const b64 = await compressLogoImage(file);
      const nowIso = new Date().toISOString();
      await setDoc(
        doc(db, 'hotel_config', 'main'),
        { hotelLogoBase64: b64, updatedAt: nowIso },
        { merge: true }
      );
      setCfg((prev) => ({ ...prev, hotelLogoBase64: b64, updatedAt: nowIso }));
      await writeAuditLog({
        actionType: 'update_hotel_logo',
        targetId: 'hotel_config_main',
        targetLabel: 'Cập nhật Logo khách sạn tập trung',
        newState: { sizeChars: b64.length },
        reason: 'Tải lên logo khách sạn tại Cài đặt & Sao lưu',
        actor,
      }).catch(() => { });
      notify(
        `Đã lưu logo khách sạn thành công (${formatFileSizeKB(estimateBase64Bytes(b64))}) — đồng bộ tự động cho tất cả biểu mẫu`
      );
    } catch (err) {
      notify(
        err instanceof Error ? err.message : 'Không thể nén hoặc lưu ảnh logo khách sạn',
        'error'
      );
    } finally {
      setSavingLogo(false);
    }
  };

  const handleRemoveHotelLogo = async () => {
    if (!canManageHotelLogo) return;
    setSavingLogo(true);
    try {
      const nowIso = new Date().toISOString();
      await setDoc(
        doc(db, 'hotel_config', 'main'),
        { hotelLogoBase64: '', updatedAt: nowIso },
        { merge: true }
      );
      setCfg((prev) => ({ ...prev, hotelLogoBase64: '', updatedAt: nowIso }));
      await writeAuditLog({
        actionType: 'update_hotel_logo',
        targetId: 'hotel_config_main',
        targetLabel: 'Gỡ Logo khách sạn tập trung',
        newState: { sizeChars: 0 },
        reason: 'Gỡ logo khách sạn tại Cài đặt & Sao lưu',
        actor,
      }).catch(() => { });
      notify('Đã gỡ logo khách sạn khỏi hệ thống', 'info');
    } catch (err) {
      notify(err instanceof Error ? err.message : 'Không thể gỡ logo khách sạn', 'error');
    } finally {
      setSavingLogo(false);
    }
  };

  // --- ROOM TYPES (Add / Edit / Toggle Active — ZERO DELETE) ---
  const handleCreateRoomType = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!canManageRoomsAndSources || !rtName.trim()) return;
    const id = generateId('rt');
    const rt: RoomType = {
      id,
      name: rtName.trim(),
      shortCode: rtName.trim().slice(0, 6).toUpperCase(),
      maxAdults: 2,
      maxChildren: 1,
      isActive: true,
      sortOrder: roomTypes.length + 1,
      priceTiers: [
        { id: generateId('tier'), tierName: 'Giá ngày thường', price: rtDefaultPrice, isDefault: true },
        { id: generateId('tier'), tierName: 'Giá cuối tuần', price: Math.round(rtDefaultPrice * 1.2) },
        { id: generateId('tier'), tierName: 'Giá khách quen', price: Math.round(rtDefaultPrice * 0.9) },
      ],
      hourlyPricing: {
        firstHourPrice: rtFirstHour,
        secondHourPrice: rtSecondHour,
        additionalHourPrice: rtAddHour,
      },
    };
    await setDoc(doc(db, 'room_types', id), rt);
    setRtName('');
    notify(`Đã thêm loại phòng ${rt.name}`);
  };

  const handleSaveEditedRoomType = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!editingRt || !canManageRoomsAndSources) return;
    await setDoc(doc(db, 'room_types', editingRt.id), editingRt, { merge: true });
    notify(`Đã cập nhật loại phòng ${editingRt.name} & cấu hình giá theo giờ`);
    setEditingRt(null);
  };

  const handleToggleRoomTypeActive = async (rt: RoomType) => {
    if (!canManageRoomsAndSources) return;
    const nextActive = rt.isActive === false;
    if (!nextActive) {
      const activeChildren = rooms.filter((r) => r.roomTypeId === rt.id && r.isActive !== false);
      if (activeChildren.length > 0) {
        const listStr = activeChildren.map((r) => `P.${r.roomNumber}`).join(', ');
        const proceedDisableChildren = window.confirm(
          `Loại phòng "${rt.name}" hiện còn ${activeChildren.length} phòng con đang hoạt động (${listStr}).\n\n` +
          `• Bấm OK để chuyển loại phòng "${rt.name}" VÀ toàn bộ ${activeChildren.length} phòng con sang "Ngừng sử dụng".\n` +
          `• Bấm Hủy để giữ nguyên (bạn có thể đổi loại phòng cho các phòng trên trước).`
        );
        if (!proceedDisableChildren) return;
        await Promise.all(
          activeChildren.map((r) =>
            setDoc(doc(db, 'rooms', r.id), { ...r, isActive: false }, { merge: true })
          )
        );
      }
    }
    await setDoc(doc(db, 'room_types', rt.id), { ...rt, isActive: nextActive }, { merge: true });
    notify(
      nextActive
        ? `Đã kích hoạt lại loại phòng ${rt.name}`
        : `Đã chuyển loại phòng ${rt.name} sang Ngừng sử dụng (giữ nguyên dữ liệu lịch sử)`,
      'info'
    );
  };

  // --- PRICE TIERS INSIDE ROOM TYPE (Full Add / Edit / Delete / Set Default!) ---
  const savePriceTiers = async (rt: RoomType, nextTiers: PriceTier[]) => {
    await setDoc(doc(db, 'room_types', rt.id), { ...rt, priceTiers: nextTiers }, { merge: true });
  };

  const handleAddPriceTier = async (rt: RoomType) => {
    if (!canManageRoomsAndSources) return;
    const tierName = window.prompt('Tên gói giá mới (VD: Giá ngày thường, Giá cuối tuần, Giá Lễ):');
    if (!tierName) return;
    const priceStr = window.prompt('Đơn giá mỗi đêm (VNĐ):', '350000');
    const price = Number(priceStr || 0);
    if (!price) return;
    const isFirst = rt.priceTiers.length === 0;
    await savePriceTiers(rt, [
      ...rt.priceTiers,
      { id: generateId('tier'), tierName: tierName.trim(), price, isDefault: isFirst },
    ]);
    notify(`Đã thêm gói giá "${tierName}" cho ${rt.name}`);
  };

  const handleEditPriceTier = async (rt: RoomType, tier: PriceTier) => {
    if (!canManageRoomsAndSources) return;
    const nextName = window.prompt('Sửa tên gói giá:', tier.tierName);
    if (!nextName) return;
    const nextPriceStr = window.prompt('Sửa đơn giá (VNĐ):', String(tier.price));
    const nextPrice = Number(nextPriceStr || 0);
    if (!nextPrice) return;
    const nextTiers = rt.priceTiers.map((t) =>
      t.id === tier.id ? { ...t, tierName: nextName.trim(), price: nextPrice } : t
    );
    await savePriceTiers(rt, nextTiers);
    notify(`Đã cập nhật gói giá "${nextName}"`);
  };

  const handleDeletePriceTier = async (rt: RoomType, tier: PriceTier) => {
    if (!canManageRoomsAndSources) return;
    if (rt.priceTiers.length <= 1) {
      notify('Mỗi loại phòng cần giữ lại ít nhất 1 mức giá', 'warning');
      return;
    }
    if (!window.confirm(`Xóa gói giá "${tier.tierName}"?`)) return;
    const remaining = rt.priceTiers.filter((t) => t.id !== tier.id);
    if (tier.isDefault && remaining.length > 0) {
      remaining[0] = { ...remaining[0], isDefault: true };
    }
    await savePriceTiers(rt, remaining);
    notify(`Đã xóa gói giá "${tier.tierName}"`, 'info');
  };

  const handleSetDefaultPriceTier = async (rt: RoomType, tierId: string) => {
    if (!canManageRoomsAndSources) return;
    const nextTiers = rt.priceTiers.map((t) => ({ ...t, isDefault: t.id === tierId }));
    await savePriceTiers(rt, nextTiers);
    notify(`Đã chọn giá mặc định mới cho ${rt.name}`);
  };

  // --- ROOMS (Add / Edit / Toggle Active — ZERO DELETE!) ---
  const handleCreateRoom = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!canManageRoomsAndSources || !newRoomNum.trim() || !newRoomTypeId) return;
    const rt = roomTypes.find((t) => t.id === newRoomTypeId);
    if (!rt) return;
    const id = `room_${newRoomNum.trim().replace(/\s+/g, '_')}`;
    const room: Room = {
      id,
      roomNumber: newRoomNum.trim(),
      floor: newRoomFloor,
      roomTypeId: rt.id,
      roomTypeName: rt.name,
      hkStatus: 'clean',
      currentBookingId: null,
      isActive: true,
      sortOrder: rooms.length + 1,
    };
    await setDoc(doc(db, 'rooms', id), room);
    setNewRoomNum('');
    notify(`Đã thêm phòng P.${room.roomNumber} (${room.floor})`);
  };

  const handleSaveEditedRoom = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!editingRoom || !canManageRoomsAndSources) return;
    const rt = roomTypes.find((t) => t.id === editingRoom.roomTypeId);
    await setDoc(
      doc(db, 'rooms', editingRoom.id),
      { ...editingRoom, roomTypeName: rt?.name || editingRoom.roomTypeName },
      { merge: true }
    );
    notify(`Đã cập nhật thông tin phòng P.${editingRoom.roomNumber}`);
    setEditingRoom(null);
  };

  const handleToggleRoomActive = async (room: Room) => {
    if (!canManageRoomsAndSources) return;
    const nextActive = room.isActive === false;
    await setDoc(doc(db, 'rooms', room.id), { ...room, isActive: nextActive }, { merge: true });
    notify(
      nextActive
        ? `Đã mở lại P.${room.roomNumber}`
        : `Đã chuyển P.${room.roomNumber} sang Ngừng sử dụng (giữ nguyên dữ liệu lịch sử)`,
      'info'
    );
  };

  // --- BOOKING SOURCES & OTA CHANNELS (Add / Edit / Toggle Active — ZERO DELETE!) ---
  const saveBookingSources = async (nextSources: BookingSourceConfig[]) => {
    await setDoc(
      doc(db, 'hotel_config', 'main'),
      { bookingSources: nextSources, updatedAt: new Date().toISOString() },
      { merge: true }
    );
  };

  const handleAddSource = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!canManageRoomsAndSources || !newSrcName.trim()) return;
    const next: BookingSourceConfig[] = [
      ...(hotelConfig.bookingSources || []),
      {
        id: generateId(newSrcKind === 'ota' ? 'ota' : 'src'),
        name: newSrcName.trim(),
        kind: newSrcKind,
        isActive: true,
      },
    ];
    await saveBookingSources(next);
    setNewSrcName('');
    notify(`Đã thêm ${newSrcKind === 'ota' ? 'kênh OTA' : 'nguồn khách'} "${newSrcName.trim()}"`);
  };

  const handleEditSourceName = async (src: BookingSourceConfig) => {
    if (!canManageRoomsAndSources) return;
    const updatedName = window.prompt('Chỉnh sửa tên kênh / nguồn đặt phòng:', src.name);
    if (!updatedName || !updatedName.trim()) return;
    const next = (hotelConfig.bookingSources || []).map((s) =>
      s.id === src.id ? { ...s, name: updatedName.trim() } : s
    );
    await saveBookingSources(next);
    notify(`Đã cập nhật tên thành "${updatedName.trim()}"`);
  };

  const handleToggleSourceActive = async (src: BookingSourceConfig) => {
    if (!canManageRoomsAndSources) return;
    const next = (hotelConfig.bookingSources || []).map((s) =>
      s.id === src.id ? { ...s, isActive: s.isActive === false } : s
    );
    await saveBookingSources(next);
    notify(
      src.isActive === false
        ? `Đã bật lại "${src.name}"`
        : `Đã chuyển "${src.name}" sang Không sử dụng`,
      'info'
    );
  };

  const handleRestoreDefaultSources = async () => {
    if (!canManageRoomsAndSources) return;
    if (
      !window.confirm(
        'Khôi phục các nguồn đặt phòng & kênh OTA mặc định còn thiếu vào cấu hình khách sạn?\n\n(Chỉ bổ sung nguồn còn thiếu — tuyệt đối không xóa hay ghi đè các nguồn tùy chỉnh hiện có.)'
      )
    ) {
      return;
    }
    try {
      const res = await restoreMissingDefaultBookingSources(actor);
      notify(
        res.addedCount > 0
          ? `Đã bổ sung ${res.addedCount} nguồn mặc định còn thiếu (tổng ${res.totalCount} nguồn)`
          : `Danh mục nguồn đã đầy đủ (${res.totalCount} nguồn) — không có thay đổi`,
        'info'
      );
    } catch (err) {
      notify(err instanceof Error ? err.message : 'Lỗi khôi phục nguồn mặc định', 'error');
    }
  };

  // --- GEMINI AI KEYS (SuperAdmin only) ---
  const handleSaveAiKeys = async (nextKeys: GeminiApiKeyEntry[], nextModel = preferredModel) => {
    if (!isSuperAdmin) return;
    await saveSystemAiConfig(nextKeys, nextModel, actor.name);
    setApiKeys(nextKeys);
    setPreferredModel(nextModel);
    notify('Đã lưu danh sách Gemini API Key lên Firestore & bộ nhớ cục bộ');
  };

  const handleTestKey = async (keyToTest: string) => {
    setTestingKey(true);
    setTestResult(null);
    const res = await testGeminiApiKey(keyToTest);
    setTestResult(res.message);
    if (res.ok && res.recommendedModel) {
      setPreferredModel(res.recommendedModel);
      if (isSuperAdmin) {
        await saveSystemAiConfig(apiKeys, res.recommendedModel, actor.name).catch(() => { });
      }
    }
    setTestingKey(false);
  };

  const handleScanOldPhotos = async () => {
    setScanningCleanup(true);
    try {
      const res = await scanOldGuestDocumentPhotos(bookings, cutoffDate);
      setScanResult(res);
    } catch (err) {
      notify(err instanceof Error ? err.message : 'Lỗi quét kho ảnh cũ', 'error');
    } finally {
      setScanningCleanup(false);
    }
  };

  const handleExecuteCleanup = async () => {
    if (!isSuperAdmin || !scanResult || scanResult.docs.length === 0) return;
    const ok = window.confirm(
      `Xác nhận xóa trắng ${scanResult.imageCount} ảnh Base64 (${formatFileSizeKB(
        scanResult.totalBytes
      )}) trong ${scanResult.docs.length} hồ sơ đã check-out trước ${formatDateVN(
        cutoffDate
      )}? Toàn bộ thông tin văn bản của khách vẫn được giữ nguyên.`
    );
    if (!ok) return;
    setCleaning(true);
    try {
      const res = await cleanupOldGuestDocumentPhotos(scanResult.docs, cutoffDate, actor);
      notify(
        `Đã dọn dẹp ${res.cleanedDocs} hồ sơ ảnh, giải phóng ${formatFileSizeKB(res.freedBytes)}`
      );
      setScanResult(null);
    } finally {
      setCleaning(false);
    }
  };

  const buildBackupBundle = () => ({
    exportedAt: new Date().toISOString(),
    hotelConfig,
    roomTypes,
    rooms,
    bookings,
    groups,
    guests,
    transactions,
    otaBatches,
    maintenances,
    shiftHandovers,
    staffUsers,
    auditLogs,
  });

  return (
    <div className="space-y-4">
      <div className="inline-flex flex-wrap p-1 rounded-xl bg-[#EAE7E0] gap-1">
        {[
          { id: 'hotel', label: 'Khách sạn & VietQR' },
          { id: 'rooms', label: 'Loại phòng, Giá ngày/giờ & Phòng' },
          { id: 'services', label: 'Dịch vụ & Bảng giá' },
          { id: 'sources', label: 'Kênh OTA & Nguồn khách' },
          { id: 'gemini', label: 'Gemini AI OCR (SuperAdmin)' },
          { id: 'data', label: 'Dọn ảnh cũ & Sao lưu (SuperAdmin)' },
        ].map((t) => (
          <button
            key={t.id}
            type="button"
            onClick={() => setTab(t.id as typeof tab)}
            className={`h-8 px-3.5 rounded-lg text-[13px] font-medium ${tab === t.id ? 'bg-white text-[#1C1B18] shadow-xs' : 'text-[#57534E]'
              }`}
          >
            {t.label}
          </button>
        ))}
      </div>

      {/* TAB 1: HOTEL & VIETQR (SuperAdmin) + ACCOUNTING PERIOD LOCK (Owner / SuperAdmin) */}
      {tab === 'hotel' && (
        <div className="space-y-5 max-w-3xl">
          <form
            onSubmit={handleSaveHotelConfig}
            className="bg-white border border-[#E5E2DC] rounded-2xl p-6 space-y-5"
          >
            <div className="flex flex-wrap items-center justify-between gap-2">
              <div>
                <h3 className="text-[15px] font-semibold text-[#1C1B18]">
                  Thông tin khách sạn & Tài khoản nhận VietQR
                </h3>
                {!isSuperAdmin && (
                  <p className="text-[12px] text-[#B45309] mt-0.5">
                    Thông tin cơ bản & tài khoản VietQR chỉ SuperAdmin gốc được sửa. Chủ khách sạn có thể tải lên hoặc gỡ Logo khách sạn bên dưới.
                  </p>
                )}
              </div>
              {isSuperAdmin && (
                <button
                  type="submit"
                  disabled={savingCfg}
                  className="h-9 px-4 rounded-lg bg-[#1B5E4B] hover:bg-[#144839] text-white text-[13px] font-medium inline-flex items-center gap-1.5"
                >
                  <Save className="w-4 h-4" strokeWidth={1.5} />
                  {savingCfg ? 'Đang lưu...' : 'Lưu cài đặt'}
                </button>
              )}
            </div>

            {/* Centralized Hotel Logo Management */}
            <div className="p-4 rounded-xl border border-[#E5E2DC] bg-[#FAF9F6] flex flex-col sm:flex-row sm:items-center gap-4">
              <div className="shrink-0">
                {currentHotelLogo ? (
                  <img
                    src={currentHotelLogo}
                    alt="Logo khách sạn"
                    data-testid="settings-hotel-logo-preview"
                    className="w-20 h-20 object-contain rounded-xl border border-[#E5E2DC] bg-white p-1.5 shadow-2xs"
                  />
                ) : (
                  <div
                    data-testid="settings-hotel-logo-placeholder"
                    className="w-20 h-20 rounded-xl border border-dashed border-[#D6D1C7] bg-white flex flex-col items-center justify-center gap-1 text-[#8A847C]"
                  >
                    <ImageIcon className="w-5 h-5" strokeWidth={1.5} />
                    <span className="text-[10px]">Chưa có logo</span>
                  </div>
                )}
              </div>
              <div className="flex-1 min-w-0 space-y-2">
                <div className="flex flex-wrap items-center gap-2">
                  <span className="text-[13px] font-semibold text-[#1C1B18]">Logo khách sạn</span>
                  {currentHotelLogo && (
                    <span className="px-2 py-0.5 rounded-full bg-[#E8F3EC] text-[#0F5132] text-[11px] font-mono-num font-medium">
                      Đã lưu · {formatFileSizeKB(estimateBase64Bytes(currentHotelLogo))}
                    </span>
                  )}
                </div>
                <p className="text-[12px] text-[#57534E] leading-relaxed">
                  Quản lý tập trung cho cả 3 mẫu biểu mẫu in. Ảnh tự động nén tối đa 320px (giữ nền trong suốt PNG/WebP, dưới 60 KB Base64).
                </p>
                {canManageHotelLogo ? (
                  <div className="flex flex-wrap items-center gap-2 pt-0.5">
                    <label
                      className={`min-h-[40px] sm:min-h-0 sm:h-9 px-3.5 rounded-lg bg-[#0F5132] hover:bg-[#0B3D26] text-white text-[13px] font-medium inline-flex items-center gap-1.5 cursor-pointer transition-colors ${
                        savingLogo ? 'opacity-60 pointer-events-none' : ''
                      }`}
                    >
                      <Upload className="w-4 h-4 shrink-0" strokeWidth={1.75} />
                      <span>{savingLogo ? 'Đang lưu logo...' : 'Chọn ảnh logo từ máy'}</span>
                      <input
                        type="file"
                        accept="image/*,.png,.jpg,.jpeg,.webp,.svg"
                        data-testid="hotel-logo-upload-input"
                        disabled={savingLogo}
                        className="hidden"
                        onChange={(e) => {
                          const file = e.target.files?.[0];
                          e.target.value = '';
                          void handleUploadHotelLogo(file);
                        }}
                      />
                    </label>
                    {currentHotelLogo && (
                      <button
                        type="button"
                        disabled={savingLogo}
                        onClick={() => void handleRemoveHotelLogo()}
                        data-testid="hotel-logo-remove-btn"
                        className="min-h-[40px] sm:min-h-0 sm:h-9 px-3.5 rounded-lg border border-[#FECACA] bg-white hover:bg-[#FEF2F2] text-[#B91C1C] text-[13px] font-medium inline-flex items-center gap-1.5 transition-colors disabled:opacity-50"
                      >
                        <Trash2 className="w-4 h-4 shrink-0" strokeWidth={1.5} />
                        <span>Gỡ logo</span>
                      </button>
                    )}
                  </div>
                ) : (
                  <p className="text-[11px] text-[#8A847C]">
                    Chỉ Chủ khách sạn hoặc SuperAdmin mới có quyền tải lên hoặc gỡ Logo.
                  </p>
                )}
              </div>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <div>
                <label className="block text-[12px] text-[#57534E] mb-1">Tên khách sạn</label>
                <input
                  type="text"
                  disabled={!isSuperAdmin}
                  value={cfg.hotelName}
                  onChange={(e) => setCfg({ ...cfg, hotelName: e.target.value })}
                  className="w-full h-9 px-3 rounded-lg border border-[#E5E2DC] text-[13px]"
                />
              </div>
              <div>
                <label className="block text-[12px] text-[#57534E] mb-1">Hotline lễ tân</label>
                <input
                  type="text"
                  disabled={!isSuperAdmin}
                  value={cfg.phone}
                  onChange={(e) => setCfg({ ...cfg, phone: e.target.value })}
                  className="w-full h-9 px-3 rounded-lg border border-[#E5E2DC] font-mono-num text-[13px]"
                />
              </div>
              <div className="sm:col-span-2">
                <label className="block text-[12px] text-[#57534E] mb-1">Địa chỉ</label>
                <input
                  type="text"
                  disabled={!isSuperAdmin}
                  value={cfg.address}
                  onChange={(e) => setCfg({ ...cfg, address: e.target.value })}
                  className="w-full h-9 px-3 rounded-lg border border-[#E5E2DC] text-[13px]"
                />
              </div>
            </div>

            <div className="pt-4 border-t border-[#E5E2DC] space-y-3">
              <div className="text-[13px] font-semibold text-[#1C1B18]">
                Cấu hình Ngân hàng VietQR động
              </div>
              <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                <div>
                  <label className="block text-[12px] text-[#57534E] mb-1">Ngân hàng</label>
                  <select
                    disabled={!isSuperAdmin}
                    value={cfg.bankAccount.bankId}
                    onChange={(e) =>
                      setCfg({
                        ...cfg,
                        bankAccount: { ...cfg.bankAccount, bankId: e.target.value },
                      })
                    }
                    className="w-full h-9 px-3 rounded-lg border border-[#E5E2DC] bg-white text-[13px]"
                  >
                    {VIETNAM_BANKS.map((b) => (
                      <option key={b.id} value={b.id}>
                        {b.name}
                      </option>
                    ))}
                  </select>
                </div>
                <div>
                  <label className="block text-[12px] text-[#57534E] mb-1">Số tài khoản</label>
                  <input
                    type="text"
                    disabled={!isSuperAdmin}
                    value={cfg.bankAccount.accountNo}
                    onChange={(e) =>
                      setCfg({
                        ...cfg,
                        bankAccount: { ...cfg.bankAccount, accountNo: e.target.value },
                      })
                    }
                    placeholder="Nhập số tài khoản nhận tiền"
                    className="w-full h-9 px-3 rounded-lg border border-[#E5E2DC] font-mono-num text-[13px]"
                  />
                </div>
                <div>
                  <label className="block text-[12px] text-[#57534E] mb-1">Tên chủ tài khoản</label>
                  <input
                    type="text"
                    disabled={!isSuperAdmin}
                    value={cfg.bankAccount.accountName}
                    onChange={(e) =>
                      setCfg({
                        ...cfg,
                        bankAccount: { ...cfg.bankAccount, accountName: e.target.value },
                      })
                    }
                    className="w-full h-9 px-3 rounded-lg border border-[#E5E2DC] text-[13px]"
                  />
                </div>
              </div>
            </div>
          </form>

          {/* Part C Rule 8: Accounting Period Lock (SuperAdmin & Owner) */}
          <div className="bg-white border border-[#E5E2DC] rounded-2xl p-6 space-y-4">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <div className="flex items-center gap-2">
                <Lock className="w-4 h-4 text-[#B45309]" strokeWidth={1.5} />
                <h3 className="text-[15px] font-semibold text-[#1C1B18]">
                  Khóa sổ Kế toán theo kỳ (Accounting Period Lock)
                </h3>
              </div>
              <span
                className={`px-2.5 py-0.5 rounded-full text-[11px] font-medium font-mono-num ${hotelConfig.accountingLockDate
                  ? 'bg-[#FFFBEB] text-[#92400E] border border-[#FDE68A]'
                  : 'bg-[#F1EFEA] text-[#57534E]'
                  }`}
              >
                {hotelConfig.accountingLockDate
                  ? `Đang khóa đến hết ${formatDateVN(hotelConfig.accountingLockDate)}`
                  : 'Chưa khóa sổ'}
              </span>
            </div>
            <p className="text-[12px] text-[#57534E]">
              Sau khi khóa sổ đến ngày đã chọn, toàn bộ đơn hàng và phiếu thu/chi trước hoặc bằng
              ngày khóa sổ sẽ không được ghi lùi ngày. Mọi bút toán điều chỉnh (đổi PTTT, thu/hoàn
              bổ sung sau Check-out, hủy ghi nhận) tự động hạch toán sang kỳ đang mở và giữ tham
              chiếu ngày gốc.
            </p>

            {canManageAccountingLock ? (
              <div className="space-y-3">
                <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                  <div>
                    <label className="block text-[12px] text-[#57534E] mb-1">
                      Khóa sổ đến hết ngày (dd/mm/YYYY)
                    </label>
                    <DateInputVN value={lockDateInput} onChange={setLockDateInput} />
                  </div>
                  <div className="sm:col-span-2">
                    <label className="block text-[12px] text-[#57534E] mb-1">
                      Lý do khóa / thay đổi kỳ khóa sổ (Bắt buộc) *
                    </label>
                    <input
                      type="text"
                      value={lockReason}
                      onChange={(e) => setLockReason(e.target.value)}
                      placeholder="VD: Đã đối soát chốt sổ kế toán tháng 11/2026..."
                      className="w-full h-9 px-3 rounded-lg border border-[#E5E2DC] text-[13px]"
                    />
                  </div>
                </div>
                <div className="flex flex-wrap items-center gap-2">
                  <button
                    type="button"
                    disabled={savingLock}
                    onClick={() => handleSaveAccountingLock(lockDateInput)}
                    className="h-9 px-4 rounded-lg bg-[#1B5E4B] hover:bg-[#144839] text-white text-[13px] font-medium inline-flex items-center gap-1.5"
                  >
                    <Lock className="w-3.5 h-3.5" strokeWidth={1.5} />
                    {savingLock ? 'Đang lưu...' : 'Áp dụng Khóa sổ'}
                  </button>
                  {hotelConfig.accountingLockDate && (
                    <button
                      type="button"
                      disabled={savingLock}
                      onClick={() => handleSaveAccountingLock(null)}
                      className="h-9 px-3.5 rounded-lg border border-[#E5E2DC] hover:bg-[#F7F6F3] text-[#57534E] text-[13px] font-medium inline-flex items-center gap-1.5"
                    >
                      <Unlock className="w-3.5 h-3.5" strokeWidth={1.5} />
                      Gỡ khóa sổ
                    </button>
                  )}
                </div>
              </div>
            ) : (
              <p className="text-[12px] text-[#B45309]">
                Chỉ SuperAdmin hoặc Chủ khách sạn mới có quyền thiết lập ngày khóa sổ kế toán.
              </p>
            )}
          </div>
        </div>
      )}

      {/* TAB 2: ROOM TYPES, MULTI-TIER DAILY + 3-TIER HOURLY PRICING & ROOMS (NO DELETE ON ROOM TYPES/ROOMS) */}
      {tab === 'rooms' && (
        <div className="space-y-5">
          {canManageRoomsAndSources && rooms.length === 0 && (
            <div className="bg-[#E8F2EE] border border-[#1B5E4B]/30 rounded-xl p-4 flex items-center justify-between gap-3">
              <div className="text-[13px] text-[#1B5E4B]">
                Khởi tạo nhanh 16 phòng chuẩn (Tầng 2–5) và 4 loại phòng kèm giá ngày & giá theo giờ 3 bậc.
              </div>
              <button
                type="button"
                onClick={seedSampleHotel}
                className="h-9 px-4 rounded-lg bg-[#1B5E4B] text-white text-[13px] font-medium shrink-0"
              >
                Khởi tạo dữ liệu mẫu
              </button>
            </div>
          )}

          {/* Room Types Section */}
          <div className="bg-white border border-[#E5E2DC] rounded-2xl p-5 space-y-4">
            <div>
              <h3 className="text-[15px] font-semibold text-[#1C1B18]">
                Loại phòng, Bảng đa mức giá & Cài đặt giá Theo Giờ 3 bậc ({roomTypes.length})
              </h3>
              <p className="text-[12px] text-[#57534E]">
                Loại phòng không có nút Xóa (chỉ chuyển sang Ngừng sử dụng để bảo toàn lịch sử). Riêng
                các gói giá bên trong được Thêm / Sửa / Xóa và chọn 1 Giá mặc định.
              </p>
            </div>

            {canManageRoomsAndSources && (
              <form onSubmit={handleCreateRoomType} className="p-3.5 rounded-xl bg-[#FAF9F6] border border-[#E5E2DC] space-y-2.5">
                <div className="text-[12px] font-semibold text-[#1C1B18]">Thêm mới loại phòng</div>
                <div className="grid grid-cols-1 sm:grid-cols-6 gap-2">
                  <input
                    type="text"
                    required
                    value={rtName}
                    onChange={(e) => setRtName(e.target.value)}
                    placeholder="Tên loại phòng *"
                    className="sm:col-span-2 h-9 px-3 rounded-lg border border-[#E5E2DC] bg-white text-[13px]"
                  />
                  <input
                    type="number"
                    min={0}
                    step={10000}
                    value={rtDefaultPrice}
                    onChange={(e) => setRtDefaultPrice(Number(e.target.value) || 0)}
                    placeholder="Giá ngày mặc định"
                    title="Giá ngày mặc định"
                    className="h-9 px-2.5 rounded-lg border border-[#E5E2DC] bg-white font-mono-num text-[12px]"
                  />
                  <input
                    type="number"
                    min={0}
                    step={10000}
                    value={rtFirstHour}
                    onChange={(e) => setRtFirstHour(Number(e.target.value) || 0)}
                    placeholder="Giờ 1"
                    title="Giá giờ đầu tiên"
                    className="h-9 px-2.5 rounded-lg border border-[#E5E2DC] bg-white font-mono-num text-[12px]"
                  />
                  <input
                    type="number"
                    min={0}
                    step={10000}
                    value={rtSecondHour}
                    onChange={(e) => setRtSecondHour(Number(e.target.value) || 0)}
                    placeholder="Giờ 2"
                    title="Giá giờ thứ 2"
                    className="h-9 px-2.5 rounded-lg border border-[#E5E2DC] bg-white font-mono-num text-[12px]"
                  />
                  <input
                    type="number"
                    min={0}
                    step={10000}
                    value={rtAddHour}
                    onChange={(e) => setRtAddHour(Number(e.target.value) || 0)}
                    placeholder="Từ giờ 3+"
                    title="Đơn giá mỗi giờ từ giờ thứ 3 trở đi"
                    className="h-9 px-2.5 rounded-lg border border-[#E5E2DC] bg-white font-mono-num text-[12px]"
                  />
                </div>
                <div className="flex items-center justify-between text-[11px] text-[#8A847C]">
                  <span>Thứ tự ô giá: Giá ngày mặc định | Giá giờ 1 | Giá giờ 2 | Giá từ giờ 3 trở đi</span>
                  <button
                    type="submit"
                    className="h-8 px-4 rounded-lg bg-[#1B5E4B] text-white text-[12px] font-medium inline-flex items-center gap-1"
                  >
                    <Plus className="w-3.5 h-3.5" strokeWidth={1.5} /> Thêm loại phòng
                  </button>
                </div>
              </form>
            )}

            {/* Edit RoomType & 3-Tier Hourly Pricing Inline Card */}
            {editingRt && (
              <form
                onSubmit={handleSaveEditedRoomType}
                className="p-4 rounded-xl bg-[#E8F2EE]/60 border border-[#1B5E4B]/40 space-y-3"
              >
                <div className="text-[13px] font-semibold text-[#1B5E4B]">
                  Chỉnh sửa loại phòng & Cài đặt giá theo giờ: {editingRt.name}
                </div>
                <div className="grid grid-cols-1 sm:grid-cols-4 gap-2.5">
                  <div>
                    <label className="block text-[11px] text-[#57534E] mb-1">Tên loại phòng</label>
                    <input
                      type="text"
                      required
                      value={editingRt.name}
                      onChange={(e) => setEditingRt({ ...editingRt, name: e.target.value })}
                      className="w-full h-9 px-3 rounded-lg border border-[#E5E2DC] bg-white text-[13px]"
                    />
                  </div>
                  <div>
                    <label className="block text-[11px] text-[#57534E] mb-1">
                      Giá giờ đầu tiên (`firstHourPrice`)
                    </label>
                    <input
                      type="number"
                      min={0}
                      step={10000}
                      value={editingRt.hourlyPricing?.firstHourPrice ?? 150000}
                      onChange={(e) =>
                        setEditingRt({
                          ...editingRt,
                          hourlyPricing: {
                            ...editingRt.hourlyPricing,
                            firstHourPrice: Math.max(0, Number(e.target.value) || 0),
                          },
                        })
                      }
                      className="w-full h-9 px-3 rounded-lg border border-[#E5E2DC] bg-white font-mono-num text-[13px]"
                    />
                  </div>
                  <div>
                    <label className="block text-[11px] text-[#57534E] mb-1">
                      Giá giờ thứ 2 (`secondHourPrice`)
                    </label>
                    <input
                      type="number"
                      min={0}
                      step={10000}
                      value={editingRt.hourlyPricing?.secondHourPrice ?? 50000}
                      onChange={(e) =>
                        setEditingRt({
                          ...editingRt,
                          hourlyPricing: {
                            ...editingRt.hourlyPricing,
                            secondHourPrice: Math.max(0, Number(e.target.value) || 0),
                          },
                        })
                      }
                      className="w-full h-9 px-3 rounded-lg border border-[#E5E2DC] bg-white font-mono-num text-[13px]"
                    />
                  </div>
                  <div>
                    <label className="block text-[11px] text-[#57534E] mb-1">
                      Giá từ giờ 3 trở đi (`additionalHourPrice`)
                    </label>
                    <input
                      type="number"
                      min={0}
                      step={10000}
                      value={editingRt.hourlyPricing?.additionalHourPrice ?? 30000}
                      onChange={(e) =>
                        setEditingRt({
                          ...editingRt,
                          hourlyPricing: {
                            ...editingRt.hourlyPricing,
                            additionalHourPrice: Math.max(0, Number(e.target.value) || 0),
                          },
                        })
                      }
                      className="w-full h-9 px-3 rounded-lg border border-[#E5E2DC] bg-white font-mono-num text-[13px]"
                    />
                  </div>
                </div>
                <div className="flex justify-end gap-2">
                  <button
                    type="button"
                    onClick={() => setEditingRt(null)}
                    className="h-8 px-3 rounded-lg border border-[#E5E2DC] bg-white text-[12px]"
                  >
                    Hủy
                  </button>
                  <button
                    type="submit"
                    className="h-8 px-4 rounded-lg bg-[#1B5E4B] text-white text-[12px] font-medium"
                  >
                    Lưu thay đổi
                  </button>
                </div>
              </form>
            )}

            <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
              {roomTypes.map((rt) => {
                const inactive = rt.isActive === false;
                const hp = rt.hourlyPricing || {
                  firstHourPrice: 150000,
                  secondHourPrice: 50000,
                  additionalHourPrice: 30000,
                };
                return (
                  <div
                    key={rt.id}
                    className={`p-4 rounded-xl border space-y-3 ${inactive
                      ? 'border-[#E5E2DC] bg-[#F1EFEA]/60 opacity-75'
                      : 'border-[#E5E2DC] bg-[#FAF9F6]'
                      }`}
                  >
                    <div className="flex flex-wrap items-center justify-between gap-2">
                      <div className="flex items-center gap-2">
                        <span className="font-semibold text-[14px] text-[#1C1B18]">{rt.name}</span>
                        {inactive && (
                          <span className="px-2 py-0.5 rounded bg-[#E5E2DC] text-[#57534E] text-[10px] font-medium">
                            Ngừng sử dụng
                          </span>
                        )}
                      </div>
                      {canManageRoomsAndSources && (
                        <div className="flex items-center gap-1.5">
                          <button
                            type="button"
                            onClick={() => setEditingRt(rt)}
                            className="h-7 px-2 rounded-md border border-[#E5E2DC] bg-white text-[11px] inline-flex items-center gap-1"
                          >
                            <Pencil className="w-3 h-3" strokeWidth={1.5} /> Sửa & Giá giờ
                          </button>
                          <button
                            type="button"
                            onClick={() => handleToggleRoomTypeActive(rt)}
                            className={`h-7 px-2 rounded-md border text-[11px] font-medium inline-flex items-center gap-1 ${inactive
                              ? 'border-[#A7F3D0] bg-[#ECFDF5] text-[#065F46]'
                              : 'border-[#FDE68A] bg-[#FFFBEB] text-[#92400E]'
                              }`}
                          >
                            <Power className="w-3 h-3" strokeWidth={1.5} />
                            {inactive ? 'Kích hoạt lại' : 'Ngừng dùng'}
                          </button>
                        </div>
                      )}
                    </div>

                    {/* 3-Tier Hourly Pricing Summary */}
                    <div className="px-2.5 py-2 rounded-lg bg-white border border-[#E5E2DC] text-[11px] font-mono-num flex flex-wrap items-center gap-x-3 gap-y-1 text-[#57534E]">
                      <span className="inline-flex items-center gap-1 font-semibold text-[#1B5E4B]">
                        <Clock className="w-3 h-3" strokeWidth={1.5} /> Giá giờ:
                      </span>
                      <span>Giờ 1: {formatCurrency(hp.firstHourPrice)}</span>
                      <span>Giờ 2: +{formatCurrency(hp.secondHourPrice)}</span>
                      <span>Giờ 3+: +{formatCurrency(hp.additionalHourPrice)}/h</span>
                    </div>

                    {/* Multi-tier Daily Prices (Full Add / Edit / Delete / Default) */}
                    <div className="space-y-1.5">
                      <div className="flex items-center justify-between text-[11px]">
                        <span className="font-medium text-[#57534E]">Các gói giá theo ngày/đêm</span>
                        {canManageRoomsAndSources && (
                          <button
                            type="button"
                            onClick={() => handleAddPriceTier(rt)}
                            className="text-[#1B5E4B] font-medium hover:underline"
                          >
                            + Thêm gói giá
                          </button>
                        )}
                      </div>
                      {rt.priceTiers.map((t) => (
                        <div
                          key={t.id}
                          className="flex items-center justify-between gap-2 text-[12px] px-2.5 py-1.5 rounded-lg bg-white border border-[#E5E2DC]"
                        >
                          <div className="flex items-center gap-1.5 min-w-0">
                            <span className="truncate text-[#1C1B18]">{t.tierName}</span>
                            {t.isDefault && (
                              <span className="px-1.5 py-0.5 rounded bg-[#E8F2EE] text-[#1B5E4B] text-[10px] font-semibold shrink-0">
                                Mặc định
                              </span>
                            )}
                          </div>
                          <div className="flex items-center gap-1.5 shrink-0">
                            <span className="font-mono-num font-semibold text-[#1C1B18]">
                              {formatCurrency(t.price)}
                            </span>
                            {canManageRoomsAndSources && (
                              <>
                                {!t.isDefault && (
                                  <button
                                    type="button"
                                    onClick={() => handleSetDefaultPriceTier(rt, t.id)}
                                    title="Đặt làm giá mặc định"
                                    className="p-1 text-[#8A847C] hover:text-[#1B5E4B]"
                                  >
                                    <Star className="w-3.5 h-3.5" strokeWidth={1.5} />
                                  </button>
                                )}
                                <button
                                  type="button"
                                  onClick={() => handleEditPriceTier(rt, t)}
                                  title="Sửa gói giá"
                                  className="p-1 text-[#8A847C] hover:text-[#1C1B18]"
                                >
                                  <Pencil className="w-3.5 h-3.5" strokeWidth={1.5} />
                                </button>
                                <button
                                  type="button"
                                  onClick={() => handleDeletePriceTier(rt, t)}
                                  title="Xóa gói giá"
                                  className="p-1 text-[#8A847C] hover:text-[#B91C1C]"
                                >
                                  <Trash2 className="w-3.5 h-3.5" strokeWidth={1.5} />
                                </button>
                              </>
                            )}
                          </div>
                        </div>
                      ))}
                    </div>
                  </div>
                );
              })}
            </div>
          </div>

          {/* Rooms Section (Add / Edit / Toggle Active — ZERO DELETE!) */}
          <div className="bg-white border border-[#E5E2DC] rounded-2xl p-5 space-y-4">
            <div>
              <h3 className="text-[15px] font-semibold text-[#1C1B18]">
                Danh sách Phòng theo Tầng ({rooms.length} phòng)
              </h3>
              <p className="text-[12px] text-[#57534E]">
                Chỉ hỗ trợ Thêm mới, Chỉnh sửa và Ngừng sử dụng (không cho phép xóa phòng để bảo toàn
                lịch sử đơn và doanh thu).
              </p>
            </div>

            {canManageRoomsAndSources && (
              <form onSubmit={handleCreateRoom} className="flex flex-wrap gap-2">
                <input
                  type="text"
                  required
                  value={newRoomNum}
                  onChange={(e) => setNewRoomNum(e.target.value)}
                  placeholder="Số phòng (VD: 505)"
                  className="w-36 h-9 px-3 rounded-lg border border-[#E5E2DC] font-mono-num text-[13px]"
                />
                <select
                  value={newRoomFloor}
                  onChange={(e) => setNewRoomFloor(e.target.value)}
                  className="h-9 px-3 rounded-lg border border-[#E5E2DC] bg-white text-[13px]"
                >
                  {['Tầng 1', 'Tầng 2', 'Tầng 3', 'Tầng 4', 'Tầng 5', 'Tầng 6'].map((f) => (
                    <option key={f} value={f}>
                      {f}
                    </option>
                  ))}
                </select>
                <select
                  value={newRoomTypeId}
                  onChange={(e) => setNewRoomTypeId(e.target.value)}
                  className="flex-1 min-w-[200px] h-9 px-3 rounded-lg border border-[#E5E2DC] bg-white text-[13px]"
                >
                  {roomTypes.map((rt) => (
                    <option key={rt.id} value={rt.id}>
                      {rt.name}
                    </option>
                  ))}
                </select>
                <button
                  type="submit"
                  className="h-9 px-4 rounded-lg bg-[#1C1B18] text-white text-[13px] font-medium inline-flex items-center gap-1"
                >
                  <Plus className="w-4 h-4" strokeWidth={1.5} /> Thêm phòng
                </button>
              </form>
            )}

            {editingRoom && (
              <form
                onSubmit={handleSaveEditedRoom}
                className="p-3.5 rounded-xl bg-[#E8F2EE]/60 border border-[#1B5E4B]/40 flex flex-wrap items-center gap-2"
              >
                <span className="text-[12px] font-semibold text-[#1B5E4B]">
                  Sửa P.{editingRoom.roomNumber}:
                </span>
                <input
                  type="text"
                  required
                  value={editingRoom.roomNumber}
                  onChange={(e) => setEditingRoom({ ...editingRoom, roomNumber: e.target.value })}
                  className="w-24 h-8 px-2.5 rounded-lg border border-[#E5E2DC] bg-white font-mono-num text-[12px]"
                />
                <select
                  value={editingRoom.floor}
                  onChange={(e) => setEditingRoom({ ...editingRoom, floor: e.target.value })}
                  className="h-8 px-2.5 rounded-lg border border-[#E5E2DC] bg-white text-[12px]"
                >
                  {['Tầng 1', 'Tầng 2', 'Tầng 3', 'Tầng 4', 'Tầng 5', 'Tầng 6'].map((f) => (
                    <option key={f} value={f}>
                      {f}
                    </option>
                  ))}
                </select>
                <select
                  value={editingRoom.roomTypeId}
                  onChange={(e) => setEditingRoom({ ...editingRoom, roomTypeId: e.target.value })}
                  className="flex-1 min-w-[180px] h-8 px-2.5 rounded-lg border border-[#E5E2DC] bg-white text-[12px]"
                >
                  {roomTypes.map((rt) => (
                    <option key={rt.id} value={rt.id}>
                      {rt.name}
                    </option>
                  ))}
                </select>
                <button
                  type="submit"
                  className="h-8 px-3 rounded-lg bg-[#1B5E4B] text-white text-[12px] font-medium"
                >
                  Lưu
                </button>
                <button
                  type="button"
                  onClick={() => setEditingRoom(null)}
                  className="h-8 px-3 rounded-lg border border-[#E5E2DC] bg-white text-[12px]"
                >
                  Hủy
                </button>
              </form>
            )}

            <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-2.5">
              {rooms.map((r) => {
                const inactive = r.isActive === false;
                return (
                  <div
                    key={r.id}
                    className={`p-3 rounded-xl border flex items-center justify-between gap-2 ${inactive
                      ? 'border-[#E5E2DC] bg-[#F1EFEA]/70 opacity-70'
                      : 'border-[#E5E2DC] bg-[#FAF9F6]'
                      }`}
                  >
                    <div className="min-w-0">
                      <div className="flex items-center gap-1.5">
                        <span className="font-mono-num font-semibold text-[13px]">
                          P.{r.roomNumber}
                        </span>
                        {inactive && (
                          <span className="text-[9px] px-1.5 py-0.5 rounded bg-[#E5E2DC] text-[#57534E]">
                            Ngừng dùng
                          </span>
                        )}
                      </div>
                      <div className="text-[11px] text-[#57534E] truncate">
                        {r.floor} • {r.roomTypeName}
                      </div>
                    </div>
                    {canManageRoomsAndSources && (
                      <div className="flex items-center gap-1 shrink-0">
                        <button
                          type="button"
                          onClick={() => setEditingRoom(r)}
                          title="Chỉnh sửa phòng"
                          className="p-1.5 rounded-md hover:bg-white text-[#57534E]"
                        >
                          <Pencil className="w-3.5 h-3.5" strokeWidth={1.5} />
                        </button>
                        <button
                          type="button"
                          onClick={() => handleToggleRoomActive(r)}
                          title={inactive ? 'Mở lại phòng' : 'Ngừng sử dụng phòng'}
                          className={`p-1.5 rounded-md hover:bg-white ${inactive ? 'text-[#15803D]' : 'text-[#B45309]'
                            }`}
                        >
                          <Power className="w-3.5 h-3.5" strokeWidth={1.5} />
                        </button>
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          </div>
        </div>
      )}

      {/* TAB 3: OTA CHANNELS & BOOKING SOURCES (NO DELETE — ONLY ADD / EDIT / TOGGLE INACTIVE) */}
      {tab === 'sources' && (
        <div className="bg-white border border-[#E5E2DC] rounded-2xl p-6 space-y-4 max-w-3xl">
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div>
              <h3 className="text-[15px] font-semibold text-[#1C1B18]">
                Quản lý Kênh OTA & Nguồn đặt phòng
              </h3>
              <p className="text-[12px] text-[#57534E]">
                Chỉ hỗ trợ Thêm, Sửa và chuyển trạng thái "Không sử dụng" (ẩn khỏi danh sách chọn khi
                tạo đơn mới nhưng giữ nguyên trong báo cáo lịch sử — không xóa).
              </p>
            </div>
            {canManageRoomsAndSources && (
              <button
                type="button"
                onClick={handleRestoreDefaultSources}
                className="h-8 px-3 rounded-lg border border-[#0F5132]/30 text-[#0F5132] hover:bg-[#E8F3EC] text-[12px] font-medium shrink-0"
              >
                Khôi phục danh mục nguồn mặc định
              </button>
            )}
          </div>

          {canManageRoomsAndSources && (
            <form onSubmit={handleAddSource} className="flex flex-wrap gap-2">
              <input
                type="text"
                required
                value={newSrcName}
                onChange={(e) => setNewSrcName(e.target.value)}
                placeholder="Tên kênh OTA hoặc nguồn khách mới (VD: Mytour, Đối tác Du lịch...)"
                className="flex-1 min-w-[220px] h-9 px-3 rounded-lg border border-[#E5E2DC] text-[13px]"
              />
              <select
                value={newSrcKind}
                onChange={(e) => setNewSrcKind(e.target.value as 'direct' | 'ota')}
                className="h-9 px-3 rounded-lg border border-[#E5E2DC] bg-white text-[13px]"
              >
                <option value="ota">Kênh OTA</option>
                <option value="direct">Nguồn trực tiếp</option>
              </select>
              <button
                type="submit"
                className="h-9 px-4 rounded-lg bg-[#1B5E4B] text-white text-[13px] font-medium inline-flex items-center gap-1"
              >
                <Plus className="w-4 h-4" strokeWidth={1.5} /> Thêm mới
              </button>
            </form>
          )}

          <div className="divide-y divide-[#E5E2DC] border border-[#E5E2DC] rounded-xl">
            {(hotelConfig.bookingSources || []).map((src) => {
              const inactive = src.isActive === false;
              return (
                <div
                  key={src.id}
                  className={`px-4 py-3 flex items-center justify-between gap-3 ${inactive ? 'bg-[#F7F6F3] opacity-70' : 'bg-white'
                    }`}
                >
                  <div className="flex items-center gap-2.5">
                    <span className="text-[13px] font-medium text-[#1C1B18]">{src.name}</span>
                    <span
                      className={`px-2 py-0.5 rounded text-[10px] font-medium ${src.kind === 'ota'
                        ? 'bg-[#FFF7ED] text-[#C2410C]'
                        : 'bg-[#E8F2EE] text-[#1B5E4B]'
                        }`}
                    >
                      {src.kind === 'ota' ? 'Kênh OTA' : 'Nguồn trực tiếp'}
                    </span>
                    {inactive && (
                      <span className="px-2 py-0.5 rounded bg-[#E5E2DC] text-[#57534E] text-[10px] font-medium">
                        Không sử dụng
                      </span>
                    )}
                  </div>

                  {canManageRoomsAndSources && (
                    <div className="flex items-center gap-1.5">
                      <button
                        type="button"
                        onClick={() => handleEditSourceName(src)}
                        className="h-8 px-2.5 rounded-lg border border-[#E5E2DC] bg-white hover:bg-[#FAF9F6] text-[12px] inline-flex items-center gap-1"
                      >
                        <Pencil className="w-3.5 h-3.5" strokeWidth={1.5} /> Sửa
                      </button>
                      <button
                        type="button"
                        onClick={() => handleToggleSourceActive(src)}
                        className={`h-8 px-2.5 rounded-lg border text-[12px] font-medium inline-flex items-center gap-1 ${inactive
                          ? 'border-[#A7F3D0] bg-[#ECFDF5] text-[#065F46]'
                          : 'border-[#FDE68A] bg-[#FFFBEB] text-[#92400E]'
                          }`}
                      >
                        <Power className="w-3.5 h-3.5" strokeWidth={1.5} />
                        {inactive ? 'Sử dụng lại' : 'Không sử dụng'}
                      </button>
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        </div>
      )}

      {/* TAB: SERVICE & F&B CATALOG (Food / Drink / Service — No Inventory Tracking) */}
      {tab === 'services' && (() => {
        const groupDefs: Array<{ id: ServiceItemGroup; label: string; badgeClass: string }> = [
          { id: 'food', label: 'Thức ăn', badgeClass: 'bg-[#FFFBEB] text-[#B45309] border border-[#FDE68A]' },
          { id: 'drink', label: 'Đồ uống', badgeClass: 'bg-[#E8F3EC] text-[#0F5132] border border-[#BBF7D0]' },
          { id: 'service', label: 'Dịch vụ', badgeClass: 'bg-[#F0F7F9] text-[#335C67] border border-[#BFD5DA]' },
        ];
        const pagedItems = serviceCatalogPag.pageItems;
        const visibleGroups = groupDefs.filter(
          (g) => svcGroupFilter === 'all' || svcGroupFilter === g.id
        );

        return (
          <div className="bg-white border border-[#E5E2DC] rounded-2xl p-4 sm:p-6 space-y-5 max-w-4xl">
            <div className="flex flex-wrap items-start justify-between gap-3">
              <div>
                <h3 className="text-[15px] font-semibold text-[#1C1B18]">
                  Quản lý Danh mục Dịch vụ &amp; Bảng giá bán ({currentServiceCatalog.length} mục)
                </h3>
                <p className="text-[12px] text-[#57534E] mt-0.5">
                  Chia 3 nhóm: <strong>Thức ăn</strong>, <strong>Đồ uống</strong> và <strong>Dịch vụ</strong> (không quản lý tồn kho). Lễ tân chọn nhanh khi thêm dịch vụ cho phòng.
                </p>
                {!canManageServiceCatalog && (
                  <p className="text-[12px] text-[#B45309] mt-1">
                    Chỉ Chủ khách sạn hoặc SuperAdmin mới có quyền thêm/sửa bảng giá bán.
                  </p>
                )}
              </div>
            </div>

            {/* Filter Pills + Search */}
            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2.5">
              <div className="flex flex-wrap items-center gap-1.5">
                <button
                  type="button"
                  onClick={() => setSvcGroupFilter('all')}
                  className={`min-h-[38px] sm:min-h-0 sm:h-8 px-3 rounded-lg text-[12px] font-medium transition-colors ${svcGroupFilter === 'all'
                    ? 'bg-[#0F5132] text-white'
                    : 'bg-[#F3F0E9] text-[#57534E] hover:text-[#1C1B18]'
                    }`}
                >
                  Tất cả ({currentServiceCatalog.length})
                </button>
                {groupDefs.map((g) => {
                  const cnt = currentServiceCatalog.filter((it) => it.category === g.id).length;
                  return (
                    <button
                      key={g.id}
                      type="button"
                      onClick={() => setSvcGroupFilter(g.id)}
                      className={`min-h-[38px] sm:min-h-0 sm:h-8 px-3 rounded-lg text-[12px] font-medium transition-colors ${svcGroupFilter === g.id
                        ? 'bg-[#0F5132] text-white'
                        : 'bg-[#F3F0E9] text-[#57534E] hover:text-[#1C1B18]'
                        }`}
                    >
                      {g.label} ({cnt})
                    </button>
                  );
                })}
              </div>

              <div className="relative w-full sm:w-64">
                <Search
                  className="w-3.5 h-3.5 text-[#8A847C] absolute left-3 top-1/2 -translate-y-1/2"
                  strokeWidth={1.5}
                />
                <input
                  type="text"
                  value={svcSearch}
                  onChange={(e) => setSvcSearch(e.target.value)}
                  placeholder="Tìm tên món, đồ uống, dịch vụ..."
                  className="w-full min-h-[40px] sm:min-h-0 sm:h-8 pl-8 pr-3 rounded-lg border border-[#E5E2DC] bg-white text-[13px] sm:text-[12px] focus:outline-none focus:border-[#0F5132]"
                />
              </div>
            </div>

            {/* Add New Service Item Form (Owner / SuperAdmin) */}
            {canManageServiceCatalog && (
              <form
                onSubmit={handleAddServiceCatalogItem}
                className="p-3.5 rounded-xl bg-[#FAF9F6] border border-[#E5E2DC] grid grid-cols-1 sm:grid-cols-12 gap-2.5"
              >
                <input
                  type="text"
                  required
                  value={newSvcName}
                  onChange={(e) => setNewSvcName(e.target.value)}
                  placeholder="Tên món ăn, đồ uống hoặc dịch vụ (VD: Nước dừa tươi, Giặt nhanh...)"
                  data-testid="new-service-name-input"
                  className="sm:col-span-5 min-h-[40px] sm:min-h-0 sm:h-9 px-3 rounded-lg border border-[#E5E2DC] bg-white text-[13px]"
                />
                <select
                  aria-label="Phân loại dịch vụ"
                  value={newSvcCategory}
                  onChange={(e) => setNewSvcCategory(e.target.value as ServiceItemGroup)}
                  data-testid="new-service-category-select"
                  className="sm:col-span-3 min-h-[40px] sm:min-h-0 sm:h-9 px-3 rounded-lg border border-[#E5E2DC] bg-white text-[13px]"
                >
                  <option value="food">Thức ăn</option>
                  <option value="drink">Đồ uống</option>
                  <option value="service">Dịch vụ</option>
                </select>
                <input
                  type="number"
                  required
                  min={0}
                  step={5000}
                  value={newSvcPrice}
                  onChange={(e) => setNewSvcPrice(Math.max(0, Number(e.target.value) || 0))}
                  placeholder="Giá bán (VNĐ)"
                  data-testid="new-service-price-input"
                  className="sm:col-span-2 min-h-[40px] sm:min-h-0 sm:h-9 px-3 rounded-lg border border-[#E5E2DC] bg-white font-mono-num text-right text-[13px]"
                />
                <button
                  type="submit"
                  disabled={savingSvc}
                  data-testid="add-service-catalog-btn"
                  className="sm:col-span-2 min-h-[40px] sm:min-h-0 sm:h-9 px-3 rounded-lg bg-[#0F5132] hover:bg-[#0B3D26] text-white text-[13px] font-medium inline-flex items-center justify-center gap-1 disabled:opacity-50"
                >
                  <Plus className="w-4 h-4 shrink-0" strokeWidth={1.75} />
                  <span>Thêm mới</span>
                </button>
              </form>
            )}

            {/* Inline Edit Box */}
            {editingSvc && canManageServiceCatalog && (
              <form
                onSubmit={handleSaveEditedServiceCatalogItem}
                className="p-3.5 rounded-xl bg-[#E8F3EC]/70 border border-[#0F5132]/35 grid grid-cols-1 sm:grid-cols-12 gap-2.5 items-center"
              >
                <input
                  type="text"
                  required
                  value={editingSvc.name}
                  onChange={(e) => setEditingSvc({ ...editingSvc, name: e.target.value })}
                  className="sm:col-span-4 min-h-[40px] sm:min-h-0 sm:h-9 px-3 rounded-lg border border-[#E5E2DC] bg-white text-[13px]"
                />
                <select
                  value={editingSvc.category}
                  onChange={(e) =>
                    setEditingSvc({ ...editingSvc, category: e.target.value as ServiceItemGroup })
                  }
                  className="sm:col-span-3 min-h-[40px] sm:min-h-0 sm:h-9 px-3 rounded-lg border border-[#E5E2DC] bg-white text-[13px]"
                >
                  <option value="food">Thức ăn</option>
                  <option value="drink">Đồ uống</option>
                  <option value="service">Dịch vụ</option>
                </select>
                <input
                  type="number"
                  min={0}
                  step={5000}
                  value={editingSvc.price}
                  onChange={(e) =>
                    setEditingSvc({ ...editingSvc, price: Math.max(0, Number(e.target.value) || 0) })
                  }
                  className="sm:col-span-2 min-h-[40px] sm:min-h-0 sm:h-9 px-3 rounded-lg border border-[#E5E2DC] bg-white font-mono-num text-right text-[13px]"
                />
                <div className="sm:col-span-3 flex items-center gap-2">
                  <button
                    type="submit"
                    disabled={savingSvc}
                    className="flex-1 min-h-[40px] sm:min-h-0 sm:h-9 px-3 rounded-lg bg-[#0F5132] text-white text-[12px] font-medium"
                  >
                    Lưu sửa
                  </button>
                  <button
                    type="button"
                    onClick={() => setEditingSvc(null)}
                    className="min-h-[40px] sm:min-h-0 sm:h-9 px-3 rounded-lg border border-[#E5E2DC] bg-white text-[12px] text-[#57534E]"
                  >
                    Hủy
                  </button>
                </div>
              </form>
            )}

            {/* Grouped Catalog List */}
            <div className="space-y-4">
              {visibleGroups.map((g) => {
                const groupItems = pagedItems.filter((it) => it.category === g.id);
                if (
                  filteredServiceCatalogItems.length > serviceCatalogPag.pageSize &&
                  groupItems.length === 0
                ) {
                  return null;
                }
                return (
                  <div key={g.id} className="border border-[#E5E2DC] rounded-xl overflow-hidden">
                    <div className="px-4 py-2.5 bg-[#FAF9F6] border-b border-[#E5E2DC] flex items-center justify-between">
                      <span className="text-[13px] font-semibold text-[#1C1B18]">{g.label}</span>
                      <span className="text-[11px] font-mono-num text-[#57534E]">
                        {groupItems.filter((x) => x.isActive !== false).length} đang bán / {groupItems.length} mục
                      </span>
                    </div>

                    {groupItems.length === 0 ? (
                      <div className="px-4 py-4 text-[12px] text-[#8A847C]">
                        Chưa có mục nào trong nhóm {g.label} khớp bộ lọc.
                      </div>
                    ) : (
                      <div className="divide-y divide-[#F1EFEA]">
                        {groupItems.map((it) => {
                          const inactive = it.isActive === false;
                          return (
                            <div
                              key={it.id}
                              className={`px-4 py-3 flex flex-col sm:flex-row sm:items-center justify-between gap-2.5 ${inactive ? 'bg-[#F7F6F3] opacity-70' : 'bg-white'
                                }`}
                            >
                              <div className="flex flex-wrap items-center gap-2 min-w-0">
                                <span className="text-[13px] font-medium text-[#1C1B18]">
                                  {it.name}
                                </span>
                                <span className={`px-2 py-0.5 rounded-full text-[10px] font-medium ${g.badgeClass}`}>
                                  {g.label}
                                </span>
                                {inactive && (
                                  <span className="px-2 py-0.5 rounded bg-[#E5E2DC] text-[#57534E] text-[10px] font-medium">
                                    Ngừng bán
                                  </span>
                                )}
                              </div>

                              <div className="flex flex-wrap items-center justify-between sm:justify-end gap-2.5 shrink-0">
                                <span className="font-mono-num text-[14px] font-semibold text-[#0F5132]">
                                  {formatCurrency(it.price)}
                                </span>
                                {canManageServiceCatalog && (
                                  <div className="flex items-center gap-1.5">
                                    <button
                                      type="button"
                                      onClick={() => setEditingSvc({ ...it })}
                                      className="min-h-[36px] sm:min-h-0 sm:h-8 px-2.5 rounded-lg border border-[#E5E2DC] bg-white hover:bg-[#FAF9F6] text-[12px] inline-flex items-center gap-1"
                                    >
                                      <Pencil className="w-3.5 h-3.5" strokeWidth={1.5} /> Sửa
                                    </button>
                                    <button
                                      type="button"
                                      disabled={savingSvc}
                                      onClick={() => void handleToggleServiceCatalogActive(it)}
                                      className={`min-h-[36px] sm:min-h-0 sm:h-8 px-2.5 rounded-lg border text-[12px] font-medium inline-flex items-center gap-1 ${inactive
                                        ? 'border-[#A7F3D0] bg-[#ECFDF5] text-[#065F46]'
                                        : 'border-[#FDE68A] bg-[#FFFBEB] text-[#92400E]'
                                        }`}
                                    >
                                      <Power className="w-3.5 h-3.5" strokeWidth={1.5} />
                                      {inactive ? 'Mở bán' : 'Ngừng bán'}
                                    </button>
                                  </div>
                                )}
                              </div>
                            </div>
                          );
                        })}
                      </div>
                    )}
                  </div>
                );
              })}
            </div>

            {filteredServiceCatalogItems.length > 20 && (
              <PaginationBar
                testId="settings-service-pagination"
                page={serviceCatalogPag.page}
                pageSize={serviceCatalogPag.pageSize}
                totalItems={serviceCatalogPag.totalItems}
                onPageChange={serviceCatalogPag.setPage}
                onPageSizeChange={serviceCatalogPag.setPageSize}
              />
            )}
          </div>
        );
      })()}

      {/* TAB 4: GEMINI VISION OCR KEYS (SuperAdmin ONLY) */}
      {tab === 'gemini' && (
        <div className="bg-white border border-[#E5E2DC] rounded-2xl p-6 space-y-4 max-w-3xl">
          <div className="flex items-center gap-2 text-[15px] font-semibold text-[#1C1B18]">
            <KeyRound className="w-5 h-5 text-[#1B5E4B]" strokeWidth={1.5} />
            Quản lý Gemini Vision API Keys (Chỉ dành cho SuperAdmin gốc)
          </div>

          {!isSuperAdmin ? (
            <div className="p-4 rounded-xl bg-[#FAF9F6] border border-[#E5E2DC] text-[13px] text-[#57534E]">
              Mục cấu hình khóa API Gemini Vision được bảo mật chỉ dành cho tài khoản{' '}
              <strong>SuperAdmin gốc</strong> (đăng nhập bằng Firebase Auth).
            </div>
          ) : (
            <>
              <p className="text-[13px] text-[#57534E]">
                Thêm một hoặc nhiều Google Gemini API Key để tự động xoay vòng khi gặp HTTP 429 và
                tự động nhận diện model mới nhất qua <code>/v1beta/models</code>.
              </p>

              <div className="flex flex-wrap gap-2">
                <input
                  type="text"
                  value={newKeyLabel}
                  onChange={(e) => setNewKeyLabel(e.target.value)}
                  placeholder="Nhãn (VD: Key Gmail 1)"
                  className="w-44 h-9 px-3 rounded-lg border border-[#E5E2DC] text-[13px]"
                />
                <input
                  type="password"
                  value={newKeyInput}
                  onChange={(e) => setNewKeyInput(e.target.value)}
                  placeholder="AIzaSy..."
                  className="flex-1 min-w-[220px] h-9 px-3 rounded-lg border border-[#E5E2DC] font-mono-num text-[13px]"
                />
                <button
                  type="button"
                  onClick={async () => {
                    if (!newKeyInput.trim()) return;
                    const next = [
                      ...apiKeys,
                      {
                        key: newKeyInput.trim(),
                        label: newKeyLabel.trim() || `Key #${apiKeys.length + 1}`,
                        enabled: true,
                      },
                    ];
                    await handleSaveAiKeys(next);
                    setNewKeyInput('');
                    setNewKeyLabel('');
                  }}
                  className="h-9 px-4 rounded-lg bg-[#1B5E4B] text-white text-[13px] font-medium"
                >
                  Thêm Key
                </button>
              </div>

              <div className="space-y-2">
                {apiKeys.length === 0 ? (
                  <div className="text-[12px] text-[#8A847C] py-2">
                    Chưa có API Key nào lưu trên Firestore.
                  </div>
                ) : (
                  apiKeys.map((entry, idx) => (
                    <div
                      key={`${entry.key.slice(-6)}_${idx}`}
                      className="p-3 rounded-xl border border-[#E5E2DC] bg-[#FAF9F6] flex flex-wrap items-center justify-between gap-2"
                    >
                      <div>
                        <div className="text-[13px] font-medium text-[#1C1B18]">
                          {entry.label || `Key #${idx + 1}`}
                        </div>
                        <div className="text-[11px] font-mono-num text-[#8A847C]">
                          {entry.key.slice(0, 8)}••••••••{entry.key.slice(-4)}
                        </div>
                      </div>
                      <div className="flex items-center gap-2">
                        <button
                          type="button"
                          onClick={() => handleTestKey(entry.key)}
                          disabled={testingKey}
                          className="h-8 px-3 rounded-lg border border-[#E5E2DC] bg-white hover:bg-[#F1EFEA] text-[12px] font-medium"
                        >
                          {testingKey ? 'Đang kiểm tra...' : 'Kiểm tra kết nối'}
                        </button>
                        <button
                          type="button"
                          onClick={() => handleSaveAiKeys(apiKeys.filter((_, i) => i !== idx))}
                          className="h-8 w-8 rounded-lg border border-[#E5E2DC] bg-white text-[#8A847C] hover:text-[#B91C1C] flex items-center justify-center"
                        >
                          <Trash2 className="w-3.5 h-3.5" strokeWidth={1.5} />
                        </button>
                      </div>
                    </div>
                  ))
                )}
              </div>

              {testResult && (
                <div className="p-3 rounded-xl bg-[#E8F2EE] text-[#1B5E4B] text-[12px] flex items-center gap-2">
                  <CheckCircle2 className="w-4 h-4 shrink-0" strokeWidth={1.5} />
                  <span>{testResult}</span>
                </div>
              )}

              {preferredModel && (
                <div className="text-[12px] text-[#57534E]">
                  Model ưu tiên đang lưu:{' '}
                  <code className="font-mono-num font-semibold">{preferredModel}</code>
                </div>
              )}
            </>
          )}
        </div>
      )}

      {/* TAB 5: SUPERADMIN DATA GOVERNANCE (MANUAL PHOTO CLEANUP & 1-CLICK BACKUP) */}
      {tab === 'data' && (
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-5">
          <div className="bg-white border border-[#E5E2DC] rounded-2xl p-6 space-y-4">
            <div className="flex items-center gap-2 text-[15px] font-semibold text-[#1C1B18]">
              <ShieldAlert className="w-5 h-5 text-[#B45309]" strokeWidth={1.5} />
              Dọn dẹp ảnh giấy tờ cũ thủ công (Chỉ SuperAdmin gốc)
            </div>
            <p className="text-[13px] text-[#57534E] leading-relaxed">
              Xóa trắng chuỗi Base64 trong <code>guest_documents</code> của các đơn đã Check-out
              trước ngày mốc — giữ nguyên 100% thông tin văn bản của khách và lịch sử lưu trú.
            </p>

            {!isSuperAdmin ? (
              <div className="p-3 rounded-xl bg-[#FAF9F6] border border-[#E5E2DC] text-[12px] text-[#8A847C]">
                Tính năng này chỉ dành riêng cho tài khoản SuperAdmin gốc (Firebase Auth).
              </div>
            ) : (
              <>
                <div className="flex flex-wrap gap-2">
                  {[
                    { label: 'Cũ hơn 30 ngày', days: 30 },
                    { label: 'Cũ hơn 60 ngày', days: 60 },
                    { label: 'Cũ hơn 90 ngày', days: 90 },
                  ].map((preset) => (
                    <button
                      key={preset.days}
                      type="button"
                      onClick={() => {
                        setCutoffDate(addDays(todayISO(), -preset.days));
                        setScanResult(null);
                      }}
                      className="h-8 px-3 rounded-lg bg-[#F1EFEA] hover:bg-[#E5E2DC] text-[12px] font-medium text-[#1C1B18]"
                    >
                      {preset.label}
                    </button>
                  ))}
                </div>

                <div className="flex flex-wrap items-center gap-2">
                  <div className="w-40">
                    <DateInputVN
                      value={cutoffDate}
                      onChange={(v) => {
                        setCutoffDate(v);
                        setScanResult(null);
                      }}
                    />
                  </div>
                  <button
                    type="button"
                    onClick={handleScanOldPhotos}
                    disabled={scanningCleanup}
                    className="h-9 px-4 rounded-lg border border-[#1B5E4B] text-[#1B5E4B] hover:bg-[#E8F2EE] text-[13px] font-medium"
                  >
                    {scanningCleanup ? 'Đang quét...' : 'Kiểm tra dung lượng có thể dọn'}
                  </button>
                </div>

                {scanResult && (
                  <div className="p-4 rounded-xl bg-[#FFFBEB] border border-[#FDE68A] space-y-3 text-[13px]">
                    <div>
                      Tìm thấy <strong>{scanResult.docs.length}</strong> hồ sơ ảnh (
                      <strong>{scanResult.imageCount}</strong> ảnh nén) đã Check-out trước{' '}
                      <span className="font-mono-num">{formatDateVN(cutoffDate)}</span>. Dự kiến giải
                      phóng:{' '}
                      <strong className="font-mono-num text-[#B45309]">
                        {formatFileSizeKB(scanResult.totalBytes)}
                      </strong>
                      .
                    </div>
                    {scanResult.docs.length > 0 && (
                      <button
                        type="button"
                        onClick={handleExecuteCleanup}
                        disabled={cleaning}
                        className="h-9 px-4 rounded-lg bg-[#B91C1C] hover:bg-[#991B1B] text-white text-[13px] font-medium"
                      >
                        {cleaning ? 'Đang xóa ảnh Base64...' : 'Xác nhận dọn dẹp ảnh giấy tờ cũ'}
                      </button>
                    )}
                  </div>
                )}
              </>
            )}
          </div>

          <div className="bg-white border border-[#E5E2DC] rounded-2xl p-6 space-y-4">
            <div className="flex items-center gap-2 text-[15px] font-semibold text-[#1C1B18]">
              <Database className="w-5 h-5 text-[#1B5E4B]" strokeWidth={1.5} />
              Sao lưu toàn bộ dữ liệu 1 chạm (Chỉ SuperAdmin gốc)
            </div>
            <p className="text-[13px] text-[#57534E] leading-relaxed">
              Xuất toàn bộ dữ liệu khách sạn (chuẩn ngày dd/mm/YYYY) ra file Excel nhiều sheet hoặc
              JSON.
            </p>

            {!isSuperAdmin ? (
              <div className="p-3 rounded-xl bg-[#FAF9F6] border border-[#E5E2DC] text-[12px] text-[#8A847C]">
                Tính năng sao lưu toàn bộ chỉ dành cho tài khoản SuperAdmin gốc.
              </div>
            ) : (
              <div className="flex flex-wrap gap-3 pt-2">
                <button
                  type="button"
                  onClick={async () => {
                    const file = await exportFullBackupExcel(buildBackupBundle(), actor);
                    notify(`Đã xuất file sao lưu Excel: ${file}`);
                  }}
                  className="h-10 px-4 rounded-lg bg-[#1B5E4B] hover:bg-[#144839] text-white text-[13px] font-medium inline-flex items-center gap-2"
                >
                  <Download className="w-4 h-4" strokeWidth={1.5} />
                  Xuất Excel nhiều sheet (.xlsx)
                </button>
                <button
                  type="button"
                  onClick={async () => {
                    const file = await exportFullBackupJson(buildBackupBundle(), actor);
                    notify(`Đã xuất file sao lưu JSON: ${file}`);
                  }}
                  className="h-10 px-4 rounded-lg border border-[#E5E2DC] bg-white hover:bg-[#FAF9F6] text-[#1C1B18] text-[13px] font-medium inline-flex items-center gap-2"
                >
                  <Download className="w-4 h-4" strokeWidth={1.5} />
                  Xuất dữ liệu gốc (.json)
                </button>
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
};
