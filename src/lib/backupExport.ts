import * as XLSX from 'xlsx';
import type {
  AuditLog,
  Booking,
  BookingGroup,
  Guest,
  HotelConfig,
  OtaPayoutBatch,
  Room,
  RoomMaintenance,
  RoomType,
  ShiftHandover,
  StaffUser,
  Transaction,
} from '../types/pms';
import { writeAuditLog, type ActorInfo } from './pmsActions';
import { formatCountryBadge, resolveCountryForAsm } from './countries';
import { formatDateTimeVN, formatDateVN, getPaymentMethodLabel, todayISO } from './utils';

export interface FullBackupBundle {
  exportedAt: string;
  hotelConfig: HotelConfig;
  roomTypes: RoomType[];
  rooms: Room[];
  bookings: Booking[];
  groups: BookingGroup[];
  guests: Guest[];
  transactions: Transaction[];
  otaBatches: OtaPayoutBatch[];
  maintenances: RoomMaintenance[];
  shiftHandovers: ShiftHandover[];
  staffUsers: StaffUser[];
  auditLogs: AuditLog[];
}

export async function exportFullBackupExcel(
  bundle: FullBackupBundle,
  actor: ActorInfo
): Promise<string> {
  const wb = XLSX.utils.book_new();

  const appendSheet = (name: string, rows: Record<string, unknown>[]) => {
    const safeRows = rows.length > 0 ? rows : [{ thong_bao: 'Chưa có dữ liệu' }];
    const ws = XLSX.utils.json_to_sheet(safeRows);
    XLSX.utils.book_append_sheet(wb, ws, name.slice(0, 31));
  };

  appendSheet(
    'Phong',
    bundle.rooms.map((r) => ({
      SoPhong: r.roomNumber,
      Tang: r.floor,
      LoaiPhong: r.roomTypeName,
      TrangThaiSuDung: r.isActive === false ? 'Ngừng sử dụng' : 'Đang sử dụng',
      TrangThaiDon: r.hkStatus,
      GhiChu: r.note || '',
    }))
  );

  appendSheet(
    'DonDatPhong',
    bundle.bookings.map((b) => ({
      MaDon: b.bookingCode,
      HinhThuc: b.bookingMode === 'hourly' ? `Theo giờ (${b.hourlyHours || 1}h)` : 'Theo ngày/đêm',
      Phong: b.roomNumber,
      LoaiPhong: b.roomTypeName,
      KhachChinh: b.primaryGuestName,
      SoLanO: b.guestStayCount || 1,
      SDT: b.primaryGuestPhone,
      CheckIn: formatDateVN(b.checkIn),
      CheckOut: formatDateVN(b.checkOut),
      SoDem: b.bookingMode === 'hourly' ? 0 : b.nights,
      SoKhach: b.occupantCount,
      Nguon: b.source === 'ota' ? b.otaChannel : b.sourceLabel || b.source,
      TienPhongThucThu: b.grossRoomTotal,
      DichVu: b.serviceTotal,
      PhuThuGio: b.hourlySurcharge,
      DaCoc: b.depositPaid,
      KhachDaTra: b.guestPaid,
      HinhThucThanhToan: getPaymentMethodLabel(b.paymentMethod),
      TrangThai: b.status,
      TrangThaiCongNoOTA: b.otaSettlementStatus,
      Doan: b.groupName || '',
      GhiChu: b.note || '',
    }))
  );

  appendSheet(
    'KhachHang',
    bundle.guests.map((g) => ({
      HoTen: g.fullName,
      PhanLoai: g.guestCategory === 'foreigner' ? 'Nước ngoài' : 'Việt Nam',
      MaNhomKhach: g.customerGroupId || 'Chưa phân nhóm',
      SDT: g.phone,
      GioiTinh: g.gender,
      NgaySinh: formatDateVN(g.dob),
      QuocTich: formatCountryBadge(g.nationality) || g.nationality || '',
      SoGiayTo: g.idNumber,
      SoVisa: g.visaNumber || '',
      NgayCap: formatDateVN(g.idIssueDate),
      ThuongTru: g.address || '',
      NgayNhapCanh: formatDateVN(g.entryDate),
      HanTamTruVN: formatDateVN(g.stayPermitExpiryDate),
      SoLanO: g.totalStays,
      LanCuoi: formatDateVN(g.lastVisitDate),
    }))
  );

  appendSheet(
    'ThuChi',
    bundle.transactions.map((t) => ({
      Ngay: formatDateVN(t.date),
      Loai: t.type,
      ThuHayChi: t.direction === 'in' ? 'THU' : 'CHI',
      HangMuc: t.category,
      SoTien: t.amount,
      PhuongThuc: getPaymentMethodLabel(t.method),
      MaDon: t.bookingCode || '',
      Phong: t.roomNumber || '',
      TrangThai: t.status,
      NguoiTao: t.createdByName,
      GhiChu: t.note || '',
    }))
  );

  appendSheet(
    'DoiSoatOTA',
    bundle.otaBatches.map((o) => ({
      MaLo: o.batchCode,
      KenhOTA: o.otaChannel,
      NgayVeTien: formatDateVN(o.payoutDate),
      SoDon: o.bookingIds.length,
      TongCongNo: o.expectedNetTotal,
      ThucNhan: o.actualReceivedAmount,
      ChenhLech: o.bankFeeDiff,
      NguoiLap: o.createdBy,
    }))
  );

  appendSheet(
    'BaoTriPhong',
    bundle.maintenances.map((m) => ({
      Phong: m.roomNumber,
      SuCo: m.issueTitle,
      MoTa: m.description,
      ChiPhi: m.cost,
      TrangThai: m.status,
      NgayBao: formatDateTimeVN(m.reportedAt),
      HoanTat: m.completedAt ? formatDateTimeVN(m.completedAt) : '',
      NguoiThucHien: m.performedBy,
    }))
  );

  appendSheet(
    'BanGiaoCa',
    bundle.shiftHandovers.map((s) => ({
      Ngay: formatDateVN(s.shiftDate),
      NhanVien: s.staffName,
      TienDauCa: s.openingCash,
      ThuTienMat: s.cashInTotal,
      ChiTienMat: s.cashOutTotal,
      TonLyThuyet: s.expectedClosingCash,
      BanGiaoThucTe: s.actualHandoverCash,
      ChenhLech: s.variance,
      GhiChu: s.note || '',
    }))
  );

  appendSheet(
    'NhatKyThaoTac',
    bundle.auditLogs.map((l) => ({
      ThoiGian: formatDateTimeVN(l.timestamp),
      HanhDong: l.actionType,
      DoiTuong: l.targetLabel,
      LyDo: l.reason,
      NhanVien: l.performedByName,
    }))
  );

  const fileName = `LikeFamilyPMS_Backup_${formatDateVN(todayISO()).replace(/\//g, '-')}.xlsx`;
  XLSX.writeFile(wb, fileName);

  await writeAuditLog({
    actionType: 'full_backup',
    targetId: fileName,
    targetLabel: `Sao lưu Excel (${bundle.bookings.length} đơn, ${bundle.guests.length} khách)`,
    reason: 'SuperAdmin xuất file sao lưu toàn bộ dữ liệu Excel',
    actor,
  });

  return fileName;
}

export async function exportFullBackupJson(
  bundle: FullBackupBundle,
  actor: ActorInfo
): Promise<string> {
  const fileName = `LikeFamilyPMS_Backup_${formatDateVN(todayISO()).replace(/\//g, '-')}.json`;
  const blob = new Blob([JSON.stringify(bundle, null, 2)], {
    type: 'application/json;charset=utf-8',
  });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = fileName;
  a.click();
  URL.revokeObjectURL(url);

  await writeAuditLog({
    actionType: 'full_backup',
    targetId: fileName,
    targetLabel: `Sao lưu JSON (${bundle.bookings.length} đơn, ${bundle.guests.length} khách)`,
    reason: 'SuperAdmin xuất file sao lưu toàn bộ dữ liệu JSON',
    actor,
  });

  return fileName;
}

export function exportAsmForeignerCsv(bookings: Booking[]): void {
  const rows: Record<string, string>[] = [];
  for (const b of bookings) {
    if (b.status !== 'in_house' && b.status !== 'reserved') continue;
    for (const occ of b.occupants || []) {
      if (occ.guestCategory !== 'foreigner') continue;
      const country = resolveCountryForAsm(occ.nationality);
      rows.push({
        Phong: b.roomNumber,
        HoTen: occ.fullName,
        GioiTinh: occ.gender || '',
        NgaySinh: formatDateVN(occ.dob),
        MaQuocTich: country.code,
        MaQuocTichISO3: country.iso3,
        QuocTich: formatCountryBadge(occ.nationality) || country.nameVi || '',
        SoHoChieu: occ.idNumber || '',
        SoVisa: occ.visaNumber || '',
        NgayNhapCanh: formatDateVN(occ.entryDate),
        HanTamTruVN: formatDateVN(occ.stayPermitExpiryDate),
        NgayDenKS: formatDateVN(b.checkIn),
        NgayDuKienDi: formatDateVN(b.checkOut),
        TrangThaiASM: occ.asmStatus === 'declared_asm' ? 'Đã khai báo' : 'Chưa khai báo',
      });
    }
  }
  const wb = XLSX.utils.book_new();
  const ws = XLSX.utils.json_to_sheet(
    rows.length > 0 ? rows : [{ ThongBao: 'Không có khách nước ngoài đang lưu trú' }]
  );
  XLSX.utils.book_append_sheet(wb, ws, 'DanhSach_ASM');
  XLSX.writeFile(
    wb,
    `LikeFamily_KhaiBaoASM_${formatDateVN(todayISO()).replace(/\//g, '-')}.xlsx`
  );
}
