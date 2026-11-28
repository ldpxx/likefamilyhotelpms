export type StaffRole = 'superadmin' | 'owner' | 'manager' | 'receptionist' | 'housekeeping';

export interface StaffPermissions {
  canViewProfit: boolean;
  canEditPrice: boolean;
  canUndoAction: boolean;
  canManageStaff: boolean;
  canCleanupPhotos: boolean;
  canFullBackup: boolean;
  canEditFormTemplates: boolean;
  canManageConfig: boolean;
}

export interface StaffUser {
  uid: string;
  username: string;
  fullName: string;
  phone: string;
  email?: string;
  role: StaffRole;
  authSource: 'firebase_superadmin' | 'firebase_staff' | 'firestore_staff';
  mustChangePassword?: boolean;
  permissions: StaffPermissions;
  isActive: boolean;
  createdAt: string;
  updatedAt?: string;
}

export interface BookingSourceConfig {
  id: string;
  name: string;
  kind: 'direct' | 'ota';
  color?: string;
  isActive: boolean;
  order?: number;
}

export interface BankAccountConfig {
  bankId: string;
  accountNo: string;
  accountName: string;
}

export interface GeminiApiKeyEntry {
  key: string;
  label?: string;
  enabled: boolean;
}

export type ServiceItemGroup = 'food' | 'drink' | 'service';

export interface ServiceCatalogItem {
  id: string;
  name: string;
  category: ServiceItemGroup;
  price: number;
  isActive: boolean;
  order?: number;
}

export interface HotelConfig {
  hotelName: string;
  address: string;
  phone: string;
  email?: string;
  floors: string[];
  wifiByFloor: Record<string, string>;
  bankAccount: BankAccountConfig;
  /** Unified OTA & Direct booking sources (No delete — toggle isActive instead) */
  bookingSources: BookingSourceConfig[];
  /** Centralized Hotel Service & F&B Catalog (food / drink / service — no inventory tracking) */
  serviceCatalog?: ServiceCatalogItem[];
  expenseCategories: string[];
  /** Centralized Hotel Logo (compressed PNG/WebP Base64 <= 60KB) stored in hotel_config/main */
  hotelLogoBase64?: string;
  logoBase64?: string | null;
  checkInTime: string;
  checkOutTime: string;
  earlyCheckInRatePerHour: number;
  lateCheckOutRatePerHour: number;
  /** Accounting Period Lock date (YYYY-MM-DD); no back-dated edits allowed <= this date */
  accountingLockDate?: string | null;
  /** Cleaning buffer between consecutive bookings on same room (minutes, default 5) */
  hourlyCleaningBufferMinutes?: number;
  /** Idempotent config migration version for bookingSources & future defaults (v2.2.2 BUG-03) */
  configMigrationVersion?: number;
  updatedAt?: string;
}

export interface SystemAiConfig {
  geminiApiKeys: GeminiApiKeyEntry[];
  preferredModel?: string;
  updatedAt?: string;
  updatedBy?: string;
}

export interface PriceTier {
  id: string;
  tierName: string;
  price: number;
  isDefault?: boolean;
}

export interface HourlyPricingConfig {
  firstHourPrice: number;
  secondHourPrice: number;
  additionalHourPrice: number;
}

export interface RoomType {
  id: string;
  name: string;
  shortCode: string;
  maxAdults: number;
  maxChildren: number;
  description?: string;
  priceTiers: PriceTier[];
  hourlyPricing: HourlyPricingConfig;
  isActive: boolean;
  sortOrder: number;
}

export type HousekeepingStatus = 'clean' | 'dirty' | 'cleaning' | 'maintenance';

export interface Room {
  id: string;
  roomNumber: string;
  floor: string;
  roomTypeId: string;
  roomTypeName: string;
  hkStatus: HousekeepingStatus;
  currentBookingId?: string | null;
  note?: string;
  isActive: boolean;
  sortOrder: number;
}

export interface RoomMaintenance {
  id: string;
  roomId: string;
  roomNumber: string;
  issueTitle: string;
  description: string;
  cost: number;
  transactionId?: string | null;
  status: 'pending' | 'completed' | 'done';
  /** ISO YYYY-MM-DD maintenance window (Single Source of Truth for blocking bookings) */
  maintenanceFrom?: string;
  maintenanceTo?: string;
  reportedAt: string;
  reportedDate?: string;
  completedAt?: string | null;
  performedBy: string;
}

export type GuestCategory = 'vietnamese' | 'foreigner';
export type AsmStatus = 'pending_asm' | 'declared_asm' | 'not_applicable';

export const WALK_IN_DEFAULT_GUEST_ID = 'WALK_IN_DEFAULT';

export interface CustomerGroup {
  id: string;
  name: string;
  color: string;
  sortOrder?: number;
  createdAt: string;
  updatedAt?: string;
}

export interface Guest {
  id: string;
  guestCategory: GuestCategory;
  fullName: string;
  normalizedName: string;
  phone: string;
  normalizedPhone: string;
  email?: string;
  gender: string;
  dob: string;
  nationality: string;
  idType: 'cccd' | 'visa_passport';
  idNumber: string;
  visaNumber?: string;
  idIssueDate?: string;
  address?: string;
  entryDate?: string;
  stayPermitExpiryDate?: string;
  latestDocumentId?: string | null;
  preferences?: string;
  /** True only for the single consolidated system profile WALK_IN_DEFAULT ("Khách lẻ") */
  isSystemDefault?: boolean;
  /** Manual customer group assignment (ID in `customer_groups`); null/undefined = Chưa phân nhóm */
  customerGroupId?: string | null;
  /** Total stays counter (informational only; never auto-assigns a group badge) */
  totalStays: number;
  totalSpent: number;
  lastVisitDate?: string;
  createdAt: string;
  updatedAt: string;
}

export interface GuestDocument {
  id: string;
  guestId: string;
  bookingId: string;
  occupantId: string;
  guestName: string;
  guestCategory: GuestCategory;
  frontImageBase64?: string | null;
  backImageBase64?: string | null;
  entryStampImageBase64?: string | null;
  totalSizeBytes: number;
  uploadedAt: string;
  uploadedBy: string;
  isCleaned?: boolean;
  cleanedAt?: string | null;
  cleanedBy?: string | null;
}

export interface Occupant {
  occupantId: string;
  guestId: string;
  guestCategory: GuestCategory;
  fullName: string;
  phone: string;
  gender: string;
  dob: string;
  nationality: string;
  idType: 'cccd' | 'visa_passport';
  idNumber: string;
  visaNumber?: string;
  idIssueDate?: string;
  address?: string;
  entryDate?: string;
  stayPermitExpiryDate?: string;
  asmStatus: AsmStatus;
  asmDeclaredAt?: string | null;
  asmDeclaredBy?: string | null;
  documentId?: string | null;
  hasFrontPhoto?: boolean;
  hasBackPhoto?: boolean;
  hasStampPhoto?: boolean;
  isPrimary: boolean;
}

export interface DailyRate {
  date: string; // YYYY-MM-DD
  rate: number;
}

export interface BookingServiceItem {
  id: string;
  /** Optional link back to hotelConfig.serviceCatalog item */
  catalogItemId?: string;
  name: string;
  quantity: number;
  unitPrice: number;
  total: number;
  /** Fixed accounting business date (YYYY-MM-DD, Asia/Ho_Chi_Minh) — v2.2.2 BUG-01 */
  businessDate?: string;
  category?:
    | 'food'
    | 'drink'
    | 'service'
    | 'minibar'
    | 'laundry'
    | 'surcharge'
    | 'damage'
    | 'other'
    | string;
  occurredAt?: string;
  status?: 'active' | 'voided';
  addedAt: string;
  addedBy: string;
}

export interface OccupancyInterval {
  id: string; // bookingId or maintenanceId
  kind: 'booking' | 'maintenance';
  startAt: number; // Epoch ms (UTC)
  endAt: number; // Epoch ms (UTC)
  bufferMinutes: number; // Default 5 for bookings, 0 for maintenance
  status: 'active';
  updatedAt: string;
  testRunId?: string;
}

export interface OccupancyDayDoc {
  roomId: string;
  date: string; // YYYY-MM-DD (Asia/Ho_Chi_Minh)
  intervals: OccupancyInterval[];
  updatedAt: string;
}

export type BookingSource =
  | 'walk_in'
  | 'loyal_guest'
  | 'phone'
  | 'zalo'
  | 'facebook'
  | 'ota'
  | 'corporate'
  | 'group';

export type BookingMode = 'daily' | 'hourly';

export type BookingStatus =
  | 'reserved'
  | 'in_house'
  | 'checked_out'
  | 'cancelled'
  | 'no_show'
  | 'transferred';

export type CancellationType = 'customer_cancelled' | 'no_show' | 'void_entry_error';

export type DepositResolutionStatus =
  | 'none'
  | 'pending_deposit_resolution'
  | 'refunded'
  | 'forfeited_fee'
  | 'transferred_to_booking';

export type OtaCancelStatus =
  | 'none'
  | 'ota_cancel_requested'
  | 'ota_cancel_confirmed'
  | 'ota_cancel_reconciled';

export interface Booking {
  id: string;
  bookingCode: string;
  bookingMode: BookingMode;
  hourlyHours?: number;
  checkInTime?: string;
  checkOutTime?: string;
  bookingChainId?: string | null;
  chainSequence?: number;
  mergedIntoBookingId?: string | null;
  mergedFromBookingIds?: string[];
  /** Bug #2: Consolidated room debt carried over into this booking (payable by guest, EXCLUDED from P&L revenue) */
  transferredBalance?: number;
  /** Bug #2: Source booking consolidated into another room (zeroes out source guest balance without erasing real room revenue) */
  consolidatedInto?: string | null;
  balanceTransferredOut?: number;
  earlyCheckoutRefundPending?: boolean;
  groupId?: string | null;
  groupName?: string | null;
  checkIn: string; // YYYY-MM-DD
  checkOut: string; // YYYY-MM-DD
  actualCheckInAt?: string | null;
  actualCheckOutAt?: string | null;
  primaryGuestId: string;
  primaryGuestName: string;
  primaryGuestNormalizedName: string;
  primaryGuestPhone: string;
  primaryGuestIdNumber: string;
  occupants: Occupant[];
  occupantCount: number;
  hasForeigner: boolean;
  hasPendingAsm: boolean;
  hasStayPermitAlert: boolean;
  isReturningGuest: boolean;
  guestStayCount?: number;
  source: BookingSource;
  sourceLabel?: string;
  otaChannel?: string | null;
  otaBookingRef?: string | null;
  roomId: string;
  roomNumber: string;
  floor: string;
  roomTypeId: string;
  roomTypeName: string;
  selectedPriceTierId?: string | null;
  dailyRates: DailyRate[];
  nights: number;
  /** Direct room total (for OTA, receptionist enters the actual net received amount directly) */
  grossRoomTotal: number;
  otaCommissionAmount: number;
  netRoomTotal: number;
  serviceTotal: number;
  services: BookingServiceItem[];
  hourlySurcharge: number;
  hourlySurchargeNote?: string;
  depositPaid: number;
  guestPaid: number;
  paymentMethod?: PaymentMethod;
  otaSettlementStatus: 'not_applicable' | 'unsettled' | 'settled';
  payoutBatchId?: string | null;
  status: BookingStatus;
  cancellationType?: CancellationType | null;
  cancellationReason?: string | null;
  cancelledAt?: string | null;
  cancelledBy?: string | null;
  depositResolutionStatus?: DepositResolutionStatus;
  pendingDepositAmount?: number;
  forfeitedFeeAmount?: number;
  depositResolvedAt?: string | null;
  depositResolvedBy?: string | null;
  depositResolutionNote?: string | null;
  depositTransferredToBookingId?: string | null;
  depositTransferredToBookingCode?: string | null;
  refundMethod?: PaymentMethod | null;
  otaCancelStatus?: OtaCancelStatus;
  otaCancelAdjustedDebt?: number | null;
  otaCancelReconciledAt?: string | null;
  otaCancelReconciledBy?: string | null;
  otaCancelReconciledNote?: string | null;
  /** Part C Rule 5: Reopen Billing Only without occupying room on Room Grid / Timeline */
  isBillingReopened?: boolean;
  voidCheckedOutAt?: string | null;
  voidCheckedOutBy?: string | null;
  voidCheckedOutReason?: string | null;
  note?: string;
  lastActionSnapshot?: Record<string, unknown> | null;
  createdAt: string;
  updatedAt: string;
  createdBy: string;
}

export interface BookingGroup {
  id: string;
  groupCode: string;
  groupName: string;
  leaderGuestId: string;
  leaderName: string;
  leaderPhone: string;
  depositAmount: number;
  billingMode: 'master' | 'split';
  status: 'active' | 'checked_out' | 'cancelled';
  note?: string;
  createdAt: string;
  createdBy: string;
}

export type TransactionType =
  | 'room_charge'
  | 'service'
  | 'deposit'
  | 'payment'
  | 'refund'
  | 'expense'
  | 'ota_payout'
  | 'cancellation_fee'
  | 'deposit_transfer_out'
  | 'deposit_transfer_in'
  | 'reclassification_out'
  | 'reclassification_in'
  | 'void_receipt_entry'
  | 'post_checkout_adjustment'
  | 'ota_adjustment'
  | 'reversal';

export type PaymentMethod = 'cash' | 'bank_transfer' | 'card' | 'ota_debt';

export interface Transaction {
  id: string;
  bookingId?: string | null;
  bookingCode?: string | null;
  roomNumber?: string | null;
  groupId?: string | null;
  payoutBatchId?: string | null;
  roomMaintenanceId?: string | null;
  reversalOfTxId?: string | null;
  reclassifiedFromTxId?: string | null;
  originalReferenceDate?: string | null;
  lockedPeriodOverride?: boolean;
  type: TransactionType;
  direction: 'in' | 'out';
  category: string;
  amount: number;
  method: PaymentMethod;
  date: string; // YYYY-MM-DD (accounting posting date; respects Period Lock)
  status: 'active' | 'voided_by_undo';
  voidReason?: string | null;
  createdAt: string;
  createdByUid: string;
  createdByName: string;
  note?: string;
}

export interface PostCheckoutAdjustment {
  id: string;
  bookingId: string;
  bookingCode: string;
  roomNumber: string;
  oldTotal: number;
  newTotal: number;
  diffAmount: number;
  addedItemsSummary: string;
  performedByUid: string;
  performedByName: string;
  timestamp: string;
  accountingDate: string;
  lockedPeriodReference?: string | null;
  reason: string;
  relatedTransactionIds: string[];
}

export interface OtaAdjustment {
  id: string;
  bookingId: string;
  bookingCode: string;
  otaChannel: string;
  payoutBatchId?: string | null;
  adjustmentAmount: number; // negative = deduct from next payout, positive = credit
  accountingDate: string;
  status: 'pending_next_payout' | 'applied' | 'settled';
  appliedBatchId?: string | null;
  reason: string;
  createdByUid: string;
  createdByName: string;
  createdAt: string;
}

export interface OtaPayoutBatch {
  id: string;
  batchCode: string;
  otaChannel: string;
  payoutDate: string;
  bookingIds: string[];
  bookingCodes: string[];
  expectedNetTotal: number;
  actualReceivedAmount: number;
  bankFeeDiff: number;
  note?: string;
  createdAt: string;
  createdBy: string;
}

export interface ShiftHandover {
  id: string;
  shiftDate: string;
  staffUid: string;
  staffName: string;
  startTime: string;
  endTime: string;
  openingCash: number;
  cashInTotal: number;
  cashOutTotal: number;
  expectedClosingCash: number;
  actualHandoverCash: number;
  variance: number;
  note?: string;
  createdAt: string;
}

export interface AuditLog {
  id: string;
  actionType: string;
  targetId: string;
  targetLabel: string;
  previousState?: Record<string, unknown> | null;
  newState?: Record<string, unknown> | null;
  before_snapshot?: Record<string, unknown> | null;
  after_snapshot?: Record<string, unknown> | null;
  relatedTransactionIds?: string[];
  reason: string;
  userId?: string;
  userName?: string;
  performedByUid: string;
  performedByName: string;
  timestamp: string;
}

export type FormTemplateType =
  | 'booking_confirmation'
  | 'payment_receipt'
  | 'registration_card';

export interface CustomFormField {
  id: string;
  labelVi: string;
  labelEn: string;
  value: string;
  enabled: boolean;
}

export interface FormTemplate {
  id: FormTemplateType;
  headerTitleVi: string;
  headerTitleEn: string;
  /** Toggle displaying centralized hotelConfig.hotelLogoBase64 (default true) */
  showLogo?: boolean;
  /** Legacy per-template logo fallback for backward compatibility */
  logoBase64?: string | null;
  hotelNameOverride?: string;
  hotelAddressOverride?: string;
  hotelPhoneOverride?: string;
  language: 'vi' | 'en' | 'bilingual';
  showVietQr: boolean;
  visibleFields: Record<string, boolean>;
  customFields: CustomFormField[];
  footerPolicyVi: string;
  footerPolicyEn: string;
  updatedAt?: string;
  updatedBy?: string;
}

export interface UndoBannerState {
  id: string;
  label: string;
  bookingId?: string;
  transactionId?: string;
  actionType: string;
  previousState: Record<string, unknown>;
  expiresAt: number;
}
