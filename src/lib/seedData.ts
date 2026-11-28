import { doc, writeBatch } from 'firebase/firestore';
import { db } from './firebase';
import type {
  CustomerGroup,
  FormTemplate,
  HotelConfig,
  Room,
  RoomType,
  ServiceCatalogItem,
} from '../types/pms';

export const CUSTOMER_GROUP_COLOR_PALETTE: Array<{ label: string; hex: string }> = [
  { label: 'Xanh ngọc (VIP)', hex: '#0F5132' },
  { label: 'Vàng hổ phách (Thân quen)', hex: '#D97706' },
  { label: 'Xanh dương (Đoàn/Công ty)', hex: '#2563EB' },
  { label: 'Tím (Đối tác)', hex: '#7C3AED' },
  { label: 'Đỏ (Cần lưu ý)', hex: '#DC2626' },
  { label: 'Xám đá (Thường)', hex: '#64748B' },
  { label: 'Hồng đậm', hex: '#DB2777' },
  { label: 'Xanh lam đậm', hex: '#0891B2' },
];

export const DEFAULT_CUSTOMER_GROUPS: CustomerGroup[] = [
  { id: 'cg_regular', name: 'Khách thường', color: '#64748B', sortOrder: 1, createdAt: '' },
  { id: 'cg_loyal', name: 'Khách thân quen', color: '#D97706', sortOrder: 2, createdAt: '' },
  { id: 'cg_vip', name: 'Khách VIP', color: '#0F5132', sortOrder: 3, createdAt: '' },
  { id: 'cg_corporate', name: 'Khách đoàn/Công ty', color: '#2563EB', sortOrder: 4, createdAt: '' },
  { id: 'cg_attention', name: 'Cần lưu ý', color: '#DC2626', sortOrder: 5, createdAt: '' },
];

export const DEFAULT_SERVICE_CATALOG: ServiceCatalogItem[] = [
  { id: 'svc_water', name: 'Nước suối Lavie', category: 'drink', price: 15000, isActive: true, order: 1 },
  { id: 'svc_soda', name: 'Nước ngọt lon (Coca / Pepsi / 7Up)', category: 'drink', price: 20000, isActive: true, order: 2 },
  { id: 'svc_energy', name: 'Nước tăng lực (Bò húc)', category: 'drink', price: 25000, isActive: true, order: 3 },
  { id: 'svc_beer', name: 'Bia lon (Tiger / Heineken)', category: 'drink', price: 30000, isActive: true, order: 4 },
  { id: 'svc_coffee', name: 'Cà phê / Trà pha sẵn', category: 'drink', price: 20000, isActive: true, order: 5 },
  { id: 'svc_noodle', name: 'Mì ly / Mì gói', category: 'food', price: 20000, isActive: true, order: 6 },
  { id: 'svc_snack', name: 'Snack / Khoai tây chiên', category: 'food', price: 25000, isActive: true, order: 7 },
  { id: 'svc_breakfast', name: 'Bữa sáng phục vụ tại phòng', category: 'food', price: 60000, isActive: true, order: 8 },
  { id: 'svc_laundry', name: 'Giặt ủi quần áo (theo kg)', category: 'service', price: 40000, isActive: true, order: 9 },
  { id: 'svc_motorbike', name: 'Thuê xe máy (1 ngày)', category: 'service', price: 150000, isActive: true, order: 10 },
  { id: 'svc_airport', name: 'Đưa đón sân bay', category: 'service', price: 250000, isActive: true, order: 11 },
  { id: 'svc_extra_person', name: 'Phụ thu thêm người / Giường phụ', category: 'service', price: 150000, isActive: true, order: 12 },
];

export const DEFAULT_HOTEL_CONFIG: HotelConfig = {
  hotelName: 'Like Family Hotel',
  address: 'Số 18 Đường Biển, Quận Hải Châu, Đà Nẵng',
  phone: '0905 123 456',
  email: 'booking@likefamilyhotel.vn',
  floors: ['Tầng 2', 'Tầng 3', 'Tầng 4', 'Tầng 5'],
  wifiByFloor: {
    'Tầng 2': 'LikeFamily_T2 / 88888888',
    'Tầng 3': 'LikeFamily_T3 / 88888888',
    'Tầng 4': 'LikeFamily_T4 / 88888888',
    'Tầng 5': 'LikeFamily_T5 / 88888888',
  },
  wifiSsid: 'Like Family Hotel',
  wifiPassword: '88888888',
  wifiDisplayText: 'Like Family Hotel / 88888888',
  bankAccount: {
    bankId: (import.meta.env.VITE_VIETQR_BANK_ID as string) || 'MB',
    accountNo: (import.meta.env.VITE_VIETQR_ACCOUNT_NO as string) || '',
    accountName: (import.meta.env.VITE_VIETQR_ACCOUNT_NAME as string) || 'LE DUC PHUONG',
  },
  bookingSources: [
    { id: 'src_walk_in', name: 'Khách vãng lai', kind: 'direct', isActive: true },
    { id: 'src_loyal', name: 'Khách quen', kind: 'direct', isActive: true },
    { id: 'src_phone', name: 'Điện thoại', kind: 'direct', isActive: true },
    { id: 'src_zalo', name: 'Zalo', kind: 'direct', isActive: true },
    { id: 'src_facebook', name: 'Facebook', kind: 'direct', isActive: true },
    { id: 'src_corporate', name: 'Công ty', kind: 'direct', isActive: true },
    { id: 'ota_booking', name: 'Booking.com', kind: 'ota', color: '#1D4ED8', isActive: true },
    { id: 'ota_agoda', name: 'Agoda', kind: 'ota', color: '#B45309', isActive: true },
    { id: 'ota_traveloka', name: 'Traveloka', kind: 'ota', color: '#0369A1', isActive: true },
    { id: 'ota_expedia', name: 'Expedia', kind: 'ota', color: '#7C3AED', isActive: true },
    { id: 'ota_trip', name: 'Trip.com', kind: 'ota', color: '#0F766E', isActive: true },
    { id: 'ota_airbnb', name: 'Airbnb', kind: 'ota', color: '#BE123C', isActive: true },
  ],
  serviceCatalog: DEFAULT_SERVICE_CATALOG,
  expenseCategories: [
    'Điện / Nước / Internet',
    'Giặt ủi & Đồ vải',
    'Vật tư tiêu hao phòng',
    'Sửa chữa & Bảo trì',
    'Lương nhân viên',
    'Nhập nước uống / Minibar',
    'Chi phí khác',
  ],
  checkInTime: '14:00',
  checkOutTime: '12:00',
  earlyCheckInRatePerHour: 50000,
  lateCheckOutRatePerHour: 50000,
};

export const DEFAULT_FORM_TEMPLATES: Record<FormTemplate['id'], FormTemplate> = {
  booking_confirmation: {
    id: 'booking_confirmation',
    headerTitleVi: 'PHIẾU XÁC NHẬN ĐẶT PHÒNG',
    headerTitleEn: 'BOOKING CONFIRMATION',
    language: 'bilingual',
    showLogo: true,
    showVietQr: true,
    visibleFields: {
      bookingCode: true,
      guestPhone: true,
      showRoomNumber: false,
      roomType: true,
      dailyRates: true,
      occupantList: false,
      depositPaid: true,
      balanceDue: true,
      wifiInfo: true,
      staffName: true,
      signatureBox: false,
    },
    customFields: [
      {
        id: 'cf_hotline',
        labelVi: 'Hotline lễ tân 24/7',
        labelEn: '24/7 Front Desk Hotline',
        value: '0905 123 456',
        enabled: true,
      },
    ],
    footerPolicyVi:
      'Giờ nhận phòng: từ 14:00 | Giờ trả phòng: trước 12:00. Vui lòng mang theo CCCD hoặc Hộ chiếu khi làm thủ tục nhận phòng.',
    footerPolicyEn:
      'Check-in time: from 14:00 | Check-out time: before 12:00. Please present valid ID card or Passport upon arrival.',
  },
  payment_receipt: {
    id: 'payment_receipt',
    headerTitleVi: 'HÓA ĐƠN THANH TOÁN / PHIẾU THU',
    headerTitleEn: 'PAYMENT RECEIPT & FOLIO',
    language: 'bilingual',
    showLogo: true,
    showVietQr: true,
    visibleFields: {
      bookingCode: true,
      guestPhone: true,
      showRoomNumber: false,
      roomType: true,
      dailyRates: true,
      serviceBreakdown: true,
      hourlySurcharge: true,
      depositPaid: true,
      balanceDue: true,
      staffName: true,
      signatureBox: true,
    },
    customFields: [],
    footerPolicyVi:
      'Cảm ơn Quý khách đã lưu trú tại Like Family Hotel. Rất hân hạnh được đón tiếp Quý khách trong những chuyến đi tiếp theo.',
    footerPolicyEn:
      'Thank you for staying at Like Family Hotel. We look forward to welcoming you back soon.',
  },
  registration_card: {
    id: 'registration_card',
    headerTitleVi: 'PHIẾU ĐĂNG KÝ NHẬN PHÒNG',
    headerTitleEn: 'GUEST REGISTRATION CARD',
    language: 'bilingual',
    showLogo: true,
    showVietQr: false,
    visibleFields: {
      bookingCode: true,
      guestPhone: true,
      guestIdNumber: true,
      showRoomNumber: false,
      roomType: true,
      dailyRates: false,
      occupantList: true,
      wifiInfo: true,
      staffName: true,
      signatureBox: true,
    },
    customFields: [],
    footerPolicyVi:
      'Tôi xác nhận các thông tin cá nhân trên là chính xác và đồng ý tuân thủ nội quy lưu trú của khách sạn.',
    footerPolicyEn:
      'I confirm the above registration details are accurate and agree to abide by the hotel house rules.',
  },
};

export const SAMPLE_ROOM_TYPES: RoomType[] = [
  {
    id: 'rt_std_single',
    name: 'Phòng Đơn Tiêu Chuẩn',
    shortCode: 'STD-1',
    maxAdults: 2,
    maxChildren: 1,
    description: '1 giường lớn 1m6, cửa sổ thoáng, điều hòa, bàn làm việc',
    isActive: true,
    sortOrder: 1,
    priceTiers: [
      { id: 't_std_weekday', tierName: 'Giá ngày thường', price: 350000, isDefault: true },
      { id: 't_std_weekend', tierName: 'Giá cuối tuần / Lễ', price: 450000 },
      { id: 't_std_loyal', tierName: 'Giá khách quen', price: 300000 },
      { id: 't_std_longstay', tierName: 'Giá ưu đãi ở dài ngày', price: 250000 },
    ],
    hourlyPricing: {
      firstHourPrice: 150000,
      secondHourPrice: 50000,
      additionalHourPrice: 30000,
    },
  },
  {
    id: 'rt_dbl_nobalk',
    name: 'Phòng Đôi Không Ban Công',
    shortCode: 'DBL-NB',
    maxAdults: 2,
    maxChildren: 1,
    description: '1 giường đôi 1m8 hoặc 2 giường đơn, rộng 24m²',
    isActive: true,
    sortOrder: 2,
    priceTiers: [
      { id: 't_dblnb_weekday', tierName: 'Giá ngày thường', price: 420000, isDefault: true },
      { id: 't_dblnb_weekend', tierName: 'Giá cuối tuần / Lễ', price: 520000 },
      { id: 't_dblnb_loyal', tierName: 'Giá khách quen', price: 370000 },
      { id: 't_dblnb_longstay', tierName: 'Giá ưu đãi ở dài ngày', price: 300000 },
    ],
    hourlyPricing: {
      firstHourPrice: 180000,
      secondHourPrice: 60000,
      additionalHourPrice: 40000,
    },
  },
  {
    id: 'rt_dbl_balk',
    name: 'Phòng Đôi Có Ban Công',
    shortCode: 'DBL-BC',
    maxAdults: 2,
    maxChildren: 1,
    description: '1 giường King 1m8, ban công riêng view phố, ghế thư giãn',
    isActive: true,
    sortOrder: 3,
    priceTiers: [
      { id: 't_dblbc_weekday', tierName: 'Giá ngày thường', price: 500000, isDefault: true },
      { id: 't_dblbc_weekend', tierName: 'Giá cuối tuần / Lễ', price: 620000 },
      { id: 't_dblbc_loyal', tierName: 'Giá khách quen', price: 450000 },
      { id: 't_dblbc_longstay', tierName: 'Giá ưu đãi ở dài ngày', price: 360000 },
    ],
    hourlyPricing: {
      firstHourPrice: 200000,
      secondHourPrice: 70000,
      additionalHourPrice: 50000,
    },
  },
  {
    id: 'rt_family',
    name: 'Phòng Gia Đình 2 Giường Lớn',
    shortCode: 'FAM-4',
    maxAdults: 4,
    maxChildren: 2,
    description: '2 giường 1m6, ban công rộng 34m², phù hợp gia đình/nhóm bạn',
    isActive: true,
    sortOrder: 4,
    priceTiers: [
      { id: 't_fam_weekday', tierName: 'Giá ngày thường', price: 680000, isDefault: true },
      { id: 't_fam_weekend', tierName: 'Giá cuối tuần / Lễ', price: 820000 },
      { id: 't_fam_loyal', tierName: 'Giá khách quen', price: 600000 },
      { id: 't_fam_longstay', tierName: 'Giá ưu đãi ở dài ngày', price: 480000 },
    ],
    hourlyPricing: {
      firstHourPrice: 250000,
      secondHourPrice: 80000,
      additionalHourPrice: 60000,
    },
  },
];

export function buildSampleRooms(): Room[] {
  const layout: Array<{ num: string; floor: string; typeId: string; typeName: string }> = [
    { num: '201', floor: 'Tầng 2', typeId: 'rt_std_single', typeName: 'Phòng Đơn Tiêu Chuẩn' },
    { num: '202', floor: 'Tầng 2', typeId: 'rt_dbl_nobalk', typeName: 'Phòng Đôi Không Ban Công' },
    { num: '203', floor: 'Tầng 2', typeId: 'rt_dbl_balk', typeName: 'Phòng Đôi Có Ban Công' },
    { num: '204', floor: 'Tầng 2', typeId: 'rt_family', typeName: 'Phòng Gia Đình 2 Giường Lớn' },
    { num: '301', floor: 'Tầng 3', typeId: 'rt_std_single', typeName: 'Phòng Đơn Tiêu Chuẩn' },
    { num: '302', floor: 'Tầng 3', typeId: 'rt_dbl_nobalk', typeName: 'Phòng Đôi Không Ban Công' },
    { num: '303', floor: 'Tầng 3', typeId: 'rt_dbl_balk', typeName: 'Phòng Đôi Có Ban Công' },
    { num: '304', floor: 'Tầng 3', typeId: 'rt_family', typeName: 'Phòng Gia Đình 2 Giường Lớn' },
    { num: '401', floor: 'Tầng 4', typeId: 'rt_std_single', typeName: 'Phòng Đơn Tiêu Chuẩn' },
    { num: '402', floor: 'Tầng 4', typeId: 'rt_dbl_nobalk', typeName: 'Phòng Đôi Không Ban Công' },
    { num: '403', floor: 'Tầng 4', typeId: 'rt_dbl_balk', typeName: 'Phòng Đôi Có Ban Công' },
    { num: '404', floor: 'Tầng 4', typeId: 'rt_family', typeName: 'Phòng Gia Đình 2 Giường Lớn' },
    { num: '501', floor: 'Tầng 5', typeId: 'rt_std_single', typeName: 'Phòng Đơn Tiêu Chuẩn' },
    { num: '502', floor: 'Tầng 5', typeId: 'rt_dbl_nobalk', typeName: 'Phòng Đôi Không Ban Công' },
    { num: '503', floor: 'Tầng 5', typeId: 'rt_dbl_balk', typeName: 'Phòng Đôi Có Ban Công' },
    { num: '504', floor: 'Tầng 5', typeId: 'rt_family', typeName: 'Phòng Gia Đình 2 Giường Lớn' },
  ];

  return layout.map((item, idx) => ({
    id: `room_${item.num}`,
    roomNumber: item.num,
    floor: item.floor,
    roomTypeId: item.typeId,
    roomTypeName: item.typeName,
    hkStatus: 'clean',
    currentBookingId: null,
    note: '',
    isActive: true,
    sortOrder: idx + 1,
  }));
}

export async function seedLikeFamilyHotelSampleData(performedBy: string): Promise<void> {
  const batch = writeBatch(db);
  const now = new Date().toISOString();

  batch.set(
    doc(db, 'hotel_config', 'main'),
    { ...DEFAULT_HOTEL_CONFIG, updatedAt: now },
    { merge: true }
  );

  for (const tpl of Object.values(DEFAULT_FORM_TEMPLATES)) {
    batch.set(
      doc(db, 'form_templates', tpl.id),
      { ...tpl, updatedAt: now, updatedBy: performedBy },
      { merge: true }
    );
  }

  for (const rt of SAMPLE_ROOM_TYPES) {
    batch.set(doc(db, 'room_types', rt.id), rt, { merge: true });
  }

  for (const r of buildSampleRooms()) {
    batch.set(doc(db, 'rooms', r.id), r, { merge: true });
  }

  await batch.commit();
}
