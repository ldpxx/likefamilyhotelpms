import React, { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react';
import {
  onAuthStateChanged,
  signInWithEmailAndPassword,
  signOut,
  updatePassword,
  type User as FirebaseUser,
} from 'firebase/auth';
import {
  collection,
  deleteDoc,
  doc,
  getDoc,
  limit,
  onSnapshot,
  orderBy,
  query,
  setDoc,
  updateDoc,
} from 'firebase/firestore';
import { auth, db, usernameToInternalEmail } from '../lib/firebase';
import {
  DEFAULT_FORM_TEMPLATES,
  DEFAULT_HOTEL_CONFIG,
  seedLikeFamilyHotelSampleData,
} from '../lib/seedData';
import { getDefaultPermissionsForRole } from '../lib/utils';
import type {
  AuditLog,
  Booking,
  BookingGroup,
  BookingSourceConfig,
  FormTemplate,
  FormTemplateType,
  Guest,
  HotelConfig,
  OtaAdjustment,
  OtaPayoutBatch,
  PostCheckoutAdjustment,
  Room,
  RoomMaintenance,
  RoomType,
  ShiftHandover,
  StaffUser,
  Transaction,
  UndoBannerState,
} from '../types/pms';
import { ensureBookingSourcesConfig, type ActorInfo } from '../lib/pmsActions';

const LS_STAFF_SESSION = 'lfpms_staff_session_v11';

export interface ToastNotice {
  id: string;
  type: 'success' | 'error' | 'info' | 'warning';
  message: string;
}

interface PmsContextValue {
  firebaseUser: FirebaseUser | null;
  authLoading: boolean;
  bootstrapInitialized: boolean;
  staffProfile: StaffUser | null;
  authBlockReason: string | null;
  actor: ActorInfo;
  isSuperAdmin: boolean;
  isAdmin: boolean;
  canManageStaff: boolean;
  loginWithStaffCredentials: (username: string, password: string) => Promise<void>;
  completeFirstLoginPasswordChange: (newPassword: string) => Promise<void>;
  logout: () => Promise<void>;

  hotelConfig: HotelConfig;
  formTemplates: Record<FormTemplateType, FormTemplate>;
  roomTypes: RoomType[];
  activeRoomTypes: RoomType[];
  rooms: Room[];
  activeRooms: Room[];
  activeBookingSources: BookingSourceConfig[];
  bookings: Booking[];
  groups: BookingGroup[];
  guests: Guest[];
  transactions: Transaction[];
  otaBatches: OtaPayoutBatch[];
  otaAdjustments: OtaAdjustment[];
  postCheckoutAdjustments: PostCheckoutAdjustment[];
  maintenances: RoomMaintenance[];
  shiftHandovers: ShiftHandover[];
  staffUsers: StaffUser[];
  auditLogs: AuditLog[];
  dataLoaded: boolean;

  seedSampleHotel: () => Promise<void>;
  notify: (message: string, type?: ToastNotice['type']) => void;
  toasts: ToastNotice[];
  dismissToast: (id: string) => void;

  undoBanner: UndoBannerState | null;
  triggerUndoBanner: (banner: Omit<UndoBannerState, 'id' | 'expiresAt'>) => void;
  clearUndoBanner: () => void;
}

const PmsContext = createContext<PmsContextValue | null>(null);

export const PmsProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const [firebaseUser, setFirebaseUser] = useState<FirebaseUser | null>(null);
  const [authLoading, setAuthLoading] = useState(true);
  const [bootstrapInitialized, setBootstrapInitialized] = useState(true);
  const [staffProfile, setStaffProfile] = useState<StaffUser | null>(null);
  const [authBlockReason, setAuthBlockReason] = useState<string | null>(null);

  const [hotelConfig, setHotelConfig] = useState<HotelConfig>(DEFAULT_HOTEL_CONFIG);
  const [formTemplates, setFormTemplates] = useState<Record<FormTemplateType, FormTemplate>>(
    DEFAULT_FORM_TEMPLATES
  );
  const [roomTypes, setRoomTypes] = useState<RoomType[]>([]);
  const [rooms, setRooms] = useState<Room[]>([]);
  const [bookings, setBookings] = useState<Booking[]>([]);
  const [groups, setGroups] = useState<BookingGroup[]>([]);
  const [guests, setGuests] = useState<Guest[]>([]);
  const [transactions, setTransactions] = useState<Transaction[]>([]);
  const [otaBatches, setOtaBatches] = useState<OtaPayoutBatch[]>([]);
  const [otaAdjustments, setOtaAdjustments] = useState<OtaAdjustment[]>([]);
  const [postCheckoutAdjustments, setPostCheckoutAdjustments] = useState<PostCheckoutAdjustment[]>(
    []
  );
  const [maintenances, setMaintenances] = useState<RoomMaintenance[]>([]);
  const [shiftHandovers, setShiftHandovers] = useState<ShiftHandover[]>([]);
  const [staffUsers, setStaffUsers] = useState<StaffUser[]>([]);
  const [auditLogs, setAuditLogs] = useState<AuditLog[]>([]);
  const [dataLoaded, setDataLoaded] = useState(false);
  const configMigrationCheckedRef = React.useRef(false);

  const [toasts, setToasts] = useState<ToastNotice[]>([]);
  const [undoBanner, setUndoBanner] = useState<UndoBannerState | null>(null);

  const notify = useCallback((message: string, type: ToastNotice['type'] = 'success') => {
    const id = `${Date.now()}_${Math.random().toString(36).slice(2, 6)}`;
    setToasts((prev) => [...prev.slice(-3), { id, type, message }]);
    setTimeout(() => {
      setToasts((prev) => prev.filter((t) => t.id !== id));
    }, 4500);
  }, []);

  const dismissToast = useCallback((id: string) => {
    setToasts((prev) => prev.filter((t) => t.id !== id));
  }, []);

  const triggerUndoBanner = useCallback((banner: Omit<UndoBannerState, 'id' | 'expiresAt'>) => {
    const id = `undo_${Date.now()}`;
    setUndoBanner({ ...banner, id, expiresAt: Date.now() + 15000 });
  }, []);

  const clearUndoBanner = useCallback(() => setUndoBanner(null), []);

  useEffect(() => {
    if (!undoBanner) return;
    const msLeft = Math.max(0, undoBanner.expiresAt - Date.now());
    const timer = setTimeout(() => setUndoBanner(null), msLeft);
    return () => clearTimeout(timer);
  }, [undoBanner]);

  // Check bootstrap status once on mount
  useEffect(() => {
    getDoc(doc(db, 'system_meta', 'bootstrap'))
      .then((snap) => setBootstrapInitialized(snap.exists()))
      .catch(() => setBootstrapInitialized(true));
  }, []);

  // Dual Authentication Resolver:
  // 1. Single Root SuperAdmin via Firebase Auth (Email/Password)
  // 2. Hotel Owner & Staff via Firestore `staff_users` (`username` + SHA-256 `passwordHash`)
  useEffect(() => {
    const unsub = onAuthStateChanged(auth, async (user) => {
      setFirebaseUser(user);
      setAuthBlockReason(null);

      if (user) {
        setAuthLoading(true);
        try {
          const bootstrapRef = doc(db, 'system_meta', 'bootstrap');
          const bootstrapSnap = await getDoc(bootstrapRef);
          const now = new Date().toISOString();

          if (!bootstrapSnap.exists()) {
            const superProfile: StaffUser = {
              uid: user.uid,
              username: (user.email || 'superadmin').split('@')[0].toLowerCase(),
              fullName: user.displayName || user.email?.split('@')[0] || 'SuperAdmin',
              phone: user.phoneNumber || '',
              email: user.email || '',
              role: 'superadmin',
              authSource: 'firebase_superadmin',
              permissions: getDefaultPermissionsForRole('superadmin'),
              isActive: true,
              createdAt: now,
            };
            await setDoc(bootstrapRef, {
              adminInitialized: true,
              superAdminUid: user.uid,
              ownerUid: user.uid,
              superAdminEmail: user.email || '',
              initializedAt: now,
            });
            await setDoc(doc(db, 'staff_users', user.uid), superProfile, { merge: true });
            setBootstrapInitialized(true);
            setStaffProfile(superProfile);
            setAuthLoading(false);
            return;
          }

          const bootData = bootstrapSnap.data() as {
            superAdminUid?: string;
            ownerUid?: string;
            superAdminEmail?: string;
            ownerEmail?: string;
          };
          const rootUid = bootData.superAdminUid || bootData.ownerUid;
          const rootEmail = (bootData.superAdminEmail || bootData.ownerEmail || '').toLowerCase();
          const currentEmail = (user.email || '').toLowerCase();
          const uidMatches = Boolean(rootUid && rootUid === user.uid);
          const emailMatches = Boolean(rootEmail && currentEmail && rootEmail === currentEmail);

          if (!uidMatches && !emailMatches) {
            // Bug #8: Authenticated Owner / Manager / Staff via Firebase Auth Email/Password (`<username>@likefamilyhotel.com`)
            const staffSnap = await getDoc(doc(db, 'staff_users', user.uid));
            if (!staffSnap.exists()) {
              await signOut(auth);
              setStaffProfile(null);
              setAuthBlockReason(
                'Tài khoản này chưa được cấp hồ sơ nhân viên trong hệ thống. Vui lòng liên hệ Chủ khách sạn hoặc SuperAdmin.'
              );
              setAuthLoading(false);
              return;
            }
            const staffData = staffSnap.data() as StaffUser;
            if (!staffData.isActive) {
              await signOut(auth);
              setStaffProfile(null);
              setAuthBlockReason(
                'Tài khoản này đang bị tạm khóa. Vui lòng liên hệ Chủ khách sạn hoặc SuperAdmin.'
              );
              setAuthLoading(false);
              return;
            }
            setStaffProfile(staffData);
            setAuthLoading(false);
            return;
          }

          // Auto re-bind bootstrap UID & migrate SuperAdmin profile if SuperAdmin recreated Email/Password account with same email
          let migratedFromOld: Partial<StaffUser> = {};
          if (emailMatches && !uidMatches) {
            await setDoc(
              bootstrapRef,
              {
                adminInitialized: true,
                superAdminUid: user.uid,
                ownerUid: user.uid,
                superAdminEmail: user.email || rootEmail,
                ownerEmail: user.email || rootEmail,
                reboundAt: now,
              },
              { merge: true }
            );
            if (rootUid) {
              const oldSnap = await getDoc(doc(db, 'staff_users', rootUid)).catch(() => null);
              if (oldSnap && oldSnap.exists()) {
                migratedFromOld = oldSnap.data() as Partial<StaffUser>;
                await deleteDoc(doc(db, 'staff_users', rootUid)).catch(() => {});
              }
            }
          }

          const staffRef = doc(db, 'staff_users', user.uid);
          const staffSnap = await getDoc(staffRef);
          const existing = staffSnap.exists()
            ? (staffSnap.data() as Partial<StaffUser>)
            : migratedFromOld;
          const superProfile: StaffUser = {
            uid: user.uid,
            username: existing.username || (user.email || 'superadmin').split('@')[0].toLowerCase(),
            fullName:
              existing.fullName || user.displayName || user.email?.split('@')[0] || 'SuperAdmin',
            phone: existing.phone || user.phoneNumber || '',
            email: user.email || existing.email || '',
            role: 'superadmin',
            authSource: 'firebase_superadmin',
            permissions: getDefaultPermissionsForRole('superadmin'),
            isActive: true,
            createdAt: existing.createdAt || now,
          };
          await setDoc(staffRef, superProfile, { merge: true });
          setBootstrapInitialized(true);
          setStaffProfile(superProfile);
          setAuthLoading(false);
          return;
        } catch (err) {
          setStaffProfile(null);
          setAuthBlockReason(
            err instanceof Error ? err.message : 'Lỗi xác thực tài khoản SuperAdmin'
          );
          setAuthLoading(false);
          return;
        }
      }

      // No Firebase Auth user -> clear session cleanly (Bug #8: zero unauthenticated staff_users access)
      localStorage.removeItem(LS_STAFF_SESSION);
      setStaffProfile(null);
      setAuthLoading(false);
    });

    return () => unsub();
  }, []);

  // Bug #8: Authenticate Owner & Staff via Firebase Auth Email/Password (`<username>@likefamilyhotel.com`)
  const loginWithStaffCredentials = useCallback(async (username: string, password: string) => {
    const cleanUser = username.trim().toLowerCase();
    if (!cleanUser || !password) {
      throw new Error('Vui lòng nhập đầy đủ Tên đăng nhập và Mật khẩu.');
    }

    const internalEmail = usernameToInternalEmail(cleanUser);
    try {
      const cred = await signInWithEmailAndPassword(auth, internalEmail, password);
      const staffSnap = await getDoc(doc(db, 'staff_users', cred.user.uid));
      if (!staffSnap.exists()) {
        await signOut(auth);
        throw new Error('Tài khoản chưa được phân quyền trong hồ sơ nhân viên.');
      }
      const matched = staffSnap.data() as StaffUser;
      if (matched.authSource === 'firebase_superadmin' || matched.role === 'superadmin') {
        await signOut(auth);
        throw new Error('Tài khoản SuperAdmin gốc vui lòng đăng nhập tại trang /superadmin.');
      }
      if (!matched.isActive) {
        await signOut(auth);
        throw new Error('Tài khoản này đang bị tạm khóa. Vui lòng liên hệ Quản lý / SuperAdmin.');
      }
      setAuthBlockReason(null);
      setStaffProfile(matched);
    } catch (err: unknown) {
      const code = (err as { code?: string })?.code || '';
      if (
        code === 'auth/invalid-credential' ||
        code === 'auth/wrong-password' ||
        code === 'auth/user-not-found' ||
        code === 'auth/invalid-email'
      ) {
        throw new Error('Tên đăng nhập hoặc mật khẩu không đúng.');
      }
      if (code === 'auth/too-many-requests') {
        throw new Error('Đăng nhập sai quá nhiều lần. Vui lòng đợi vài phút rồi thử lại.');
      }
      if (err instanceof Error) throw err;
      throw new Error('Đăng nhập thất bại. Vui lòng thử lại.');
    }
  }, []);

  const completeFirstLoginPasswordChange = useCallback(
    async (newPassword: string) => {
      if (newPassword.length < 6) {
        throw new Error('Mật khẩu mới cần tối thiểu 6 ký tự.');
      }
      if (!auth.currentUser || !staffProfile) {
        throw new Error('Phiên đăng nhập không hợp lệ.');
      }
      await updatePassword(auth.currentUser, newPassword);
      const now = new Date().toISOString();
      await updateDoc(doc(db, 'staff_users', staffProfile.uid), {
        mustChangePassword: false,
        updatedAt: now,
      });
      setStaffProfile((prev) => (prev ? { ...prev, mustChangePassword: false, updatedAt: now } : prev));
    },
    [staffProfile]
  );

  // Real-time Firestore Subscriptions
  useEffect(() => {
    if (!staffProfile || !staffProfile.isActive) {
      setDataLoaded(false);
      return;
    }

    const unsubs: Array<() => void> = [];

    unsubs.push(
      onSnapshot(doc(db, 'hotel_config', 'main'), (snap) => {
        if (snap.exists()) {
          const data = snap.data() as Partial<HotelConfig> & {
            otaChannels?: Array<{ id: string; name: string; color?: string; isActive?: boolean }>;
          };
          let sources: BookingSourceConfig[] = data.bookingSources || [];
          if (sources.length === 0) {
            sources = [...DEFAULT_HOTEL_CONFIG.bookingSources];
            if (Array.isArray(data.otaChannels) && data.otaChannels.length > 0) {
              const directs = DEFAULT_HOTEL_CONFIG.bookingSources.filter((s) => s.kind === 'direct');
              const otas: BookingSourceConfig[] = data.otaChannels.map((c) => ({
                id: c.id,
                name: c.name,
                kind: 'ota',
                color: c.color,
                isActive: c.isActive !== false,
              }));
              sources = [...directs, ...otas];
            }
          }
          setHotelConfig({
            ...DEFAULT_HOTEL_CONFIG,
            ...data,
            bookingSources: sources,
          });
        }
      })
    );

    unsubs.push(
      onSnapshot(collection(db, 'form_templates'), (snap) => {
        const next = { ...DEFAULT_FORM_TEMPLATES };
        snap.forEach((d) => {
          const id = d.id as FormTemplateType;
          if (id in next) {
            next[id] = { ...next[id], ...(d.data() as Partial<FormTemplate>) };
          }
        });
        setFormTemplates(next);
      })
    );

    unsubs.push(
      onSnapshot(collection(db, 'room_types'), (snap) => {
        const list = snap.docs.map((d) => {
          const raw = d.data() as Partial<RoomType>;
          return {
            ...raw,
            isActive: raw.isActive !== false,
            hourlyPricing: raw.hourlyPricing || {
              firstHourPrice: 150000,
              secondHourPrice: 50000,
              additionalHourPrice: 30000,
            },
          } as RoomType;
        });
        list.sort((a, b) => (a.sortOrder || 0) - (b.sortOrder || 0));
        setRoomTypes(list);
      })
    );

    unsubs.push(
      onSnapshot(collection(db, 'rooms'), (snap) => {
        const list = snap.docs.map((d) => {
          const raw = d.data() as Partial<Room>;
          return { ...raw, isActive: raw.isActive !== false } as Room;
        });
        list.sort(
          (a, b) => (a.sortOrder || 0) - (b.sortOrder || 0) || a.roomNumber.localeCompare(b.roomNumber)
        );
        setRooms(list);
        setDataLoaded(true);
      })
    );

    unsubs.push(
      onSnapshot(collection(db, 'bookings'), (snap) => {
        const list = snap.docs.map((d) => {
          const raw = d.data() as Partial<Booking>;
          return {
            ...raw,
            bookingMode: raw.bookingMode || 'daily',
          } as Booking;
        });
        list.sort((a, b) => b.createdAt.localeCompare(a.createdAt));
        setBookings(list);
      })
    );

    unsubs.push(
      onSnapshot(collection(db, 'booking_groups'), (snap) => {
        const list = snap.docs.map((d) => d.data() as BookingGroup);
        list.sort((a, b) => b.createdAt.localeCompare(a.createdAt));
        setGroups(list);
      })
    );

    unsubs.push(
      onSnapshot(collection(db, 'guests'), (snap) => {
        const list = snap.docs.map((d) => d.data() as Guest);
        list.sort((a, b) => (b.updatedAt || '').localeCompare(a.updatedAt || ''));
        setGuests(list);
      })
    );

    unsubs.push(
      onSnapshot(collection(db, 'transactions'), (snap) => {
        const list = snap.docs.map((d) => d.data() as Transaction);
        list.sort((a, b) => b.createdAt.localeCompare(a.createdAt));
        setTransactions(list);
      })
    );

    unsubs.push(
      onSnapshot(collection(db, 'ota_payout_batches'), (snap) => {
        const list = snap.docs.map((d) => d.data() as OtaPayoutBatch);
        list.sort((a, b) => b.createdAt.localeCompare(a.createdAt));
        setOtaBatches(list);
      })
    );

    unsubs.push(
      onSnapshot(collection(db, 'ota_adjustments'), (snap) => {
        const list = snap.docs.map((d) => d.data() as OtaAdjustment);
        list.sort((a, b) => b.createdAt.localeCompare(a.createdAt));
        setOtaAdjustments(list);
      })
    );

    unsubs.push(
      onSnapshot(collection(db, 'post_checkout_adjustments'), (snap) => {
        const list = snap.docs.map((d) => d.data() as PostCheckoutAdjustment);
        list.sort((a, b) => b.timestamp.localeCompare(a.timestamp));
        setPostCheckoutAdjustments(list);
      })
    );

    unsubs.push(
      onSnapshot(collection(db, 'room_maintenances'), (snap) => {
        const list = snap.docs.map((d) => d.data() as RoomMaintenance);
        list.sort((a, b) => b.reportedAt.localeCompare(a.reportedAt));
        setMaintenances(list);
      })
    );

    unsubs.push(
      onSnapshot(collection(db, 'shift_handovers'), (snap) => {
        const list = snap.docs.map((d) => d.data() as ShiftHandover);
        list.sort((a, b) => b.createdAt.localeCompare(a.createdAt));
        setShiftHandovers(list);
      })
    );

    // Privacy isolation: only managers/SuperAdmin subscribe to full staff_users list;
    // normal staff ONLY subscribe to their own profile document.
    const canSeeAllStaff =
      staffProfile.role === 'superadmin' ||
      staffProfile.role === 'owner' ||
      Boolean(staffProfile.permissions?.canManageStaff);

    if (canSeeAllStaff) {
      unsubs.push(
        onSnapshot(collection(db, 'staff_users'), (snap) => {
          const list = snap.docs.map((d) => d.data() as StaffUser);
          setStaffUsers(list);
          const me = list.find((u) => u.uid === staffProfile.uid);
          if (me) {
            if (!me.isActive) {
              localStorage.removeItem(LS_STAFF_SESSION);
              setStaffProfile(null);
              setAuthBlockReason('Tài khoản của bạn vừa bị khóa bởi quản trị viên.');
            } else {
              setStaffProfile(me);
            }
          }
        })
      );
    } else {
      unsubs.push(
        onSnapshot(doc(db, 'staff_users', staffProfile.uid), (snap) => {
          if (!snap.exists()) {
            localStorage.removeItem(LS_STAFF_SESSION);
            setStaffProfile(null);
            setAuthBlockReason('Tài khoản của bạn đã bị xóa bởi quản trị viên.');
            return;
          }
          const me = snap.data() as StaffUser;
          if (!me.isActive) {
            localStorage.removeItem(LS_STAFF_SESSION);
            setStaffProfile(null);
            setAuthBlockReason('Tài khoản của bạn vừa bị khóa bởi quản trị viên.');
            return;
          }
          setStaffProfile(me);
          setStaffUsers([me]);
        })
      );
    }

    unsubs.push(
      onSnapshot(
        query(collection(db, 'audit_logs'), orderBy('timestamp', 'desc'), limit(250)),
        (snap) => {
          setAuditLogs(snap.docs.map((d) => d.data() as AuditLog));
        }
      )
    );

    return () => {
      unsubs.forEach((fn) => fn());
    };
  }, [staffProfile?.uid, staffProfile?.isActive, staffProfile?.role, staffProfile?.permissions?.canManageStaff]);

  const actor: ActorInfo = useMemo(
    () => ({
      uid: staffProfile?.uid || firebaseUser?.uid || 'system',
      name: staffProfile?.fullName || staffProfile?.username || firebaseUser?.email || 'Nhân viên',
    }),
    [staffProfile, firebaseUser]
  );

  const isSuperAdmin = staffProfile?.role === 'superadmin' && Boolean(firebaseUser);
  const isAdmin = isSuperAdmin || staffProfile?.role === 'owner';
  const canManageStaff =
    isSuperAdmin ||
    staffProfile?.role === 'owner' ||
    Boolean(staffProfile?.permissions?.canManageStaff);

  const activeRoomTypes = useMemo(
    () => roomTypes.filter((rt) => rt.isActive !== false),
    [roomTypes]
  );
  const activeRooms = useMemo(
    () =>
      rooms.filter((r) => {
        if (r.isActive === false) return false;
        const rt = roomTypes.find((t) => t.id === r.roomTypeId);
        return !rt || rt.isActive !== false;
      }),
    [rooms, roomTypes]
  );
  const activeBookingSources = useMemo(
    () => (hotelConfig.bookingSources || []).filter((s) => s.isActive !== false),
    [hotelConfig.bookingSources]
  );

  const logout = useCallback(async () => {
    // Intentionally preserves Gemini AI config & last-working-model cache across logout
    localStorage.removeItem(LS_STAFF_SESSION);
    if (auth.currentUser) {
      await signOut(auth);
    }
    setStaffProfile(null);
  }, []);

  const seedSampleHotel = useCallback(async () => {
    await seedLikeFamilyHotelSampleData(actor.name);
    notify('Đã khởi tạo dữ liệu mẫu 16 phòng (4 tầng, 4 loại phòng, giá ngày & giá theo giờ 3 bậc)');
  }, [actor.name, notify]);

  // v2.2.2 BUG-03: Idempotent auto-migration of `hotel_config/main.bookingSources` (Owner / SuperAdmin only, runs max once/session)
  useEffect(() => {
    if (!dataLoaded || !staffProfile || configMigrationCheckedRef.current) return;
    if (staffProfile.role !== 'owner' && staffProfile.role !== 'superadmin') return;
    configMigrationCheckedRef.current = true;
    ensureBookingSourcesConfig(actor).catch(() => {
      // Non-fatal if offline or read-only
    });
  }, [dataLoaded, staffProfile, actor]);

  const value: PmsContextValue = {
    firebaseUser,
    authLoading,
    bootstrapInitialized,
    staffProfile,
    authBlockReason,
    actor,
    isSuperAdmin,
    isAdmin,
    canManageStaff,
    loginWithStaffCredentials,
    completeFirstLoginPasswordChange,
    logout,
    hotelConfig,
    formTemplates,
    roomTypes,
    activeRoomTypes,
    rooms,
    activeRooms,
    activeBookingSources,
    bookings,
    groups,
    guests,
    transactions,
    otaBatches,
    otaAdjustments,
    postCheckoutAdjustments,
    maintenances,
    shiftHandovers,
    staffUsers,
    auditLogs,
    dataLoaded,
    seedSampleHotel,
    notify,
    toasts,
    dismissToast,
    undoBanner,
    triggerUndoBanner,
    clearUndoBanner,
  };

  return <PmsContext.Provider value={value}>{children}</PmsContext.Provider>;
};

export function usePms(): PmsContextValue {
  const ctx = useContext(PmsContext);
  if (!ctx) throw new Error('usePms must be used inside PmsProvider');
  return ctx;
}
