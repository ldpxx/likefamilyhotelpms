import React, { useEffect, useState } from 'react';
import { doc, setDoc } from 'firebase/firestore';
import { Monitor, Plus, Save, Trash2, Upload } from 'lucide-react';
import { db } from '../lib/firebase';
import { usePms } from '../context/PmsContext';
import type { Booking, FormTemplate, FormTemplateType } from '../types/pms';
import { compressLogoImage } from '../lib/imageCompression';
import { writeAuditLog } from '../lib/pmsActions';
import { buildVietQrUrl } from '../lib/vietqr';
import { FormPaperPreview } from './PrintableFormModal';
import { addDays, todayISO } from '../lib/utils';

const FIELD_LABELS: Array<{ key: string; label: string }> = [
  { key: 'bookingCode', label: 'Mã đơn đặt phòng' },
  { key: 'guestPhone', label: 'Số điện thoại khách' },
  { key: 'guestIdNumber', label: 'Số CCCD / Hộ chiếu' },
  { key: 'roomNumber', label: 'Số phòng' },
  { key: 'roomType', label: 'Tên loại phòng' },
  { key: 'dailyRates', label: 'Bảng kê đơn giá từng đêm' },
  { key: 'serviceBreakdown', label: 'Chi tiết dịch vụ / Minibar' },
  { key: 'hourlySurcharge', label: 'Phụ thu nhận sớm / trả muộn' },
  { key: 'occupantList', label: 'Danh sách toàn bộ khách ở cùng' },
  { key: 'depositPaid', label: 'Số tiền đã cọc / đã thanh toán' },
  { key: 'balanceDue', label: 'Số tiền còn lại phải thanh toán' },
  { key: 'wifiInfo', label: 'Mật khẩu Wi-Fi theo tầng' },
  { key: 'staffName', label: 'Tên nhân viên lập phiếu' },
  { key: 'signatureBox', label: 'Khung chữ ký Khách & Lễ tân' },
];

export const FormCustomizerView: React.FC = () => {
  const { formTemplates, hotelConfig, bookings, actor, isAdmin, staffProfile, notify } = usePms();
  const [activeId, setActiveId] = useState<FormTemplateType>('booking_confirmation');
  const [draft, setDraft] = useState<FormTemplate>(formTemplates[activeId]);
  const [saving, setSaving] = useState(false);

  const canEdit = isAdmin || Boolean(staffProfile?.permissions.canEditFormTemplates);

  useEffect(() => {
    setDraft(formTemplates[activeId]);
  }, [activeId, formTemplates]);

  // Sample booking for Live Preview (uses real latest booking if available)
  const previewBooking: Booking = bookings[0] || {
    id: 'preview',
    bookingCode: 'LF-261127-DEMO',
    bookingMode: 'daily',
    checkIn: todayISO(),
    checkOut: addDays(todayISO(), 2),
    primaryGuestId: 'g1',
    primaryGuestName: 'Nguyễn Minh Quân',
    primaryGuestNormalizedName: 'nguyen minh quan',
    primaryGuestPhone: '0905 888 999',
    primaryGuestIdNumber: '048091002345',
    occupants: [
      {
        occupantId: 'o1',
        guestId: 'g1',
        guestCategory: 'vietnamese',
        fullName: 'Nguyễn Minh Quân',
        phone: '0905 888 999',
        gender: 'Nam',
        dob: '1991-05-12',
        nationality: 'Việt Nam',
        idType: 'cccd',
        idNumber: '048091002345',
        asmStatus: 'not_applicable',
        isPrimary: true,
      },
    ],
    occupantCount: 1,
    hasForeigner: false,
    hasPendingAsm: false,
    hasStayPermitAlert: false,
    isReturningGuest: true,
    source: 'zalo',
    roomId: 'room_303',
    roomNumber: '303',
    floor: 'Tầng 3',
    roomTypeId: 'rt_dbl_balk',
    roomTypeName: 'Phòng Đôi Có Ban Công',
    dailyRates: [
      { date: todayISO(), rate: 500000 },
      { date: addDays(todayISO(), 1), rate: 500000 },
    ],
    nights: 2,
    grossRoomTotal: 1000000,
    otaCommissionAmount: 0,
    netRoomTotal: 1000000,
    serviceTotal: 40000,
    services: [
      {
        id: 's1',
        name: 'Nước suối Lavie',
        quantity: 2,
        unitPrice: 20000,
        total: 40000,
        addedAt: new Date().toISOString(),
        addedBy: actor.name,
      },
    ],
    hourlySurcharge: 0,
    depositPaid: 300000,
    guestPaid: 0,
    otaSettlementStatus: 'not_applicable',
    status: 'in_house',
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    createdBy: actor.name,
  };

  const vietQrUrl = buildVietQrUrl({
    bankAccount: hotelConfig.bankAccount,
    amount: 740000,
    addInfo: `THANH TOAN ${previewBooking.bookingCode}`,
  });

  const handleToggleField = (key: string) => {
    setDraft((prev) => ({
      ...prev,
      visibleFields: {
        ...prev.visibleFields,
        [key]: !prev.visibleFields?.[key],
      },
    }));
  };

  const handleLogoUpload = async (file: File | undefined) => {
    if (!file) return;
    try {
      const b64 = await compressLogoImage(file);
      setDraft((prev) => ({ ...prev, logoBase64: b64 }));
    } catch {
      notify('Không thể nén ảnh logo', 'error');
    }
  };

  const handleAddCustomField = () => {
    setDraft((prev) => ({
      ...prev,
      customFields: [
        ...(prev.customFields || []),
        {
          id: `cf_${Date.now()}`,
          labelVi: 'Thông tin thêm',
          labelEn: 'Additional Info',
          value: '',
          enabled: true,
        },
      ],
    }));
  };

  const handleSave = async () => {
    if (!canEdit) {
      notify('Chỉ tài khoản Admin (Chủ khách sạn) mới có quyền lưu mẫu biểu mẫu', 'error');
      return;
    }
    setSaving(true);
    try {
      const payload: FormTemplate = {
        ...draft,
        updatedAt: new Date().toISOString(),
        updatedBy: actor.name,
      };
      await setDoc(doc(db, 'form_templates', activeId), payload, { merge: true });
      await writeAuditLog({
        actionType: 'edit_form_template',
        targetId: activeId,
        targetLabel: `Cập nhật mẫu biểu mẫu ${activeId}`,
        reason: 'Admin tùy chỉnh trường hiển thị biểu mẫu trên Web App',
        actor,
      });
      notify('Đã lưu cấu hình biểu mẫu thành công');
    } catch (err) {
      notify(err instanceof Error ? err.message : 'Lỗi lưu biểu mẫu', 'error');
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="space-y-4">
      {/* Mobile-only notice (Form Customizer is Web App desktop only) */}
      <div className="md:hidden bg-[#FFFBEB] border border-[#FDE68A] rounded-2xl p-5 text-[13px] text-[#92400E] flex gap-3">
        <Monitor className="w-5 h-5 shrink-0 mt-0.5" strokeWidth={1.5} />
        <div>
          <div className="font-semibold">Trình tùy chỉnh biểu mẫu chỉ khả dụng trên máy tính (Web App)</div>
          <p className="mt-1">
            Để tránh thao tác nhầm bố cục hóa đơn, vui lòng mở mục này trên màn hình máy tính quầy lễ
            tân.
          </p>
        </div>
      </div>

      {/* Desktop Editor + Live Preview */}
      <div className="hidden md:block space-y-4">
        <div className="bg-white border border-[#E5E2DC] rounded-xl p-4 flex flex-wrap items-center justify-between gap-3">
          <div className="flex items-center gap-2">
            {(
              [
                ['booking_confirmation', '1. Xác nhận đặt phòng'],
                ['payment_receipt', '2. Hóa đơn & Phiếu thu'],
                ['registration_card', '3. Đăng ký nhận phòng'],
              ] as const
            ).map(([id, label]) => (
              <button
                key={id}
                type="button"
                onClick={() => setActiveId(id)}
                className={`h-9 px-3.5 rounded-lg text-[13px] font-medium transition-colors ${
                  activeId === id
                    ? 'bg-[#1B5E4B] text-white'
                    : 'bg-[#F1EFEA] text-[#57534E] hover:text-[#1C1B18]'
                }`}
              >
                {label}
              </button>
            ))}
          </div>

          {canEdit && (
            <button
              type="button"
              onClick={handleSave}
              disabled={saving}
              className="h-9 px-4 rounded-lg bg-[#1B5E4B] hover:bg-[#144839] disabled:opacity-50 text-white text-[13px] font-medium inline-flex items-center gap-2"
            >
              <Save className="w-4 h-4" strokeWidth={1.5} />
              {saving ? 'Đang lưu...' : 'Lưu mẫu biểu mẫu'}
            </button>
          )}
        </div>

        <div className="grid grid-cols-12 gap-5 items-start">
          {/* Left Settings Column */}
          <div className="col-span-5 bg-white border border-[#E5E2DC] rounded-2xl p-5 space-y-4">
            <h3 className="text-[14px] font-semibold text-[#1C1B18]">
              Cấu hình nội dung & Ẩn/Hiện trường dữ liệu
            </h3>

            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="block text-[11px] text-[#57534E] mb-1">Ngôn ngữ biểu mẫu</label>
                <select
                  disabled={!canEdit}
                  value={draft.language}
                  onChange={(e) =>
                    setDraft({ ...draft, language: e.target.value as FormTemplate['language'] })
                  }
                  className="w-full h-9 px-2.5 rounded-lg border border-[#E5E2DC] bg-white text-[13px]"
                >
                  <option value="bilingual">Song ngữ Việt – Anh</option>
                  <option value="vi">Chỉ Tiếng Việt</option>
                  <option value="en">Chỉ Tiếng Anh</option>
                </select>
              </div>
              <div className="flex items-end">
                <label className="w-full h-9 px-3 rounded-lg border border-[#E5E2DC] flex items-center justify-between text-[12px] cursor-pointer">
                  <span>Hiển thị mã VietQR</span>
                  <input
                    type="checkbox"
                    disabled={!canEdit}
                    checked={draft.showVietQr}
                    onChange={(e) => setDraft({ ...draft, showVietQr: e.target.checked })}
                    className="accent-[#1B5E4B]"
                  />
                </label>
              </div>
            </div>

            <div className="space-y-2.5">
              <div>
                <label className="block text-[11px] text-[#57534E] mb-1">Tiêu đề Tiếng Việt</label>
                <input
                  type="text"
                  disabled={!canEdit}
                  value={draft.headerTitleVi}
                  onChange={(e) => setDraft({ ...draft, headerTitleVi: e.target.value })}
                  className="w-full h-9 px-3 rounded-lg border border-[#E5E2DC] text-[13px]"
                />
              </div>
              <div>
                <label className="block text-[11px] text-[#57534E] mb-1">Tiêu đề Tiếng Anh</label>
                <input
                  type="text"
                  disabled={!canEdit}
                  value={draft.headerTitleEn}
                  onChange={(e) => setDraft({ ...draft, headerTitleEn: e.target.value })}
                  className="w-full h-9 px-3 rounded-lg border border-[#E5E2DC] text-[13px]"
                />
              </div>
              <div>
                <label className="block text-[11px] text-[#57534E] mb-1">Logo khách sạn (Base64)</label>
                <div className="flex items-center gap-2">
                  <label className="h-8 px-3 rounded-lg border border-[#E5E2DC] hover:bg-[#F7F6F3] text-[12px] font-medium inline-flex items-center gap-1.5 cursor-pointer">
                    <Upload className="w-3.5 h-3.5" strokeWidth={1.5} />
                    Tải logo lên
                    <input
                      type="file"
                      accept="image/*"
                      disabled={!canEdit}
                      className="hidden"
                      onChange={(e) => handleLogoUpload(e.target.files?.[0])}
                    />
                  </label>
                  {draft.logoBase64 && canEdit && (
                    <button
                      type="button"
                      onClick={() => setDraft({ ...draft, logoBase64: null })}
                      className="text-[12px] text-[#B91C1C]"
                    >
                      Gỡ logo
                    </button>
                  )}
                </div>
              </div>
            </div>

            {/* Field visibility switches */}
            <div className="pt-3 border-t border-[#E5E2DC] space-y-2">
              <div className="text-[12px] font-semibold text-[#57534E]">
                Bật / Tắt từng trường hiển thị
              </div>
              <div className="grid grid-cols-1 gap-1.5 max-h-64 overflow-y-auto pr-1">
                {FIELD_LABELS.map((f) => (
                  <label
                    key={f.key}
                    className="flex items-center justify-between px-3 py-1.5 rounded-lg bg-[#FAF9F6] border border-[#E5E2DC] text-[12px] cursor-pointer"
                  >
                    <span>{f.label}</span>
                    <input
                      type="checkbox"
                      disabled={!canEdit}
                      checked={Boolean(draft.visibleFields?.[f.key])}
                      onChange={() => handleToggleField(f.key)}
                      className="w-4 h-4 accent-[#1B5E4B]"
                    />
                  </label>
                ))}
              </div>
            </div>

            {/* Custom fields */}
            <div className="pt-3 border-t border-[#E5E2DC] space-y-2">
              <div className="flex items-center justify-between">
                <span className="text-[12px] font-semibold text-[#57534E]">
                  Trường tự định nghĩa
                </span>
                {canEdit && (
                  <button
                    type="button"
                    onClick={handleAddCustomField}
                    className="text-[12px] text-[#1B5E4B] font-medium inline-flex items-center gap-1"
                  >
                    <Plus className="w-3.5 h-3.5" strokeWidth={1.5} /> Thêm trường
                  </button>
                )}
              </div>
              {(draft.customFields || []).map((cf, idx) => (
                <div key={cf.id} className="flex items-center gap-1.5">
                  <input
                    type="text"
                    disabled={!canEdit}
                    value={cf.labelVi}
                    onChange={(e) => {
                      const next = [...draft.customFields];
                      next[idx] = { ...cf, labelVi: e.target.value };
                      setDraft({ ...draft, customFields: next });
                    }}
                    placeholder="Nhãn"
                    className="w-1/3 h-8 px-2 rounded-lg border border-[#E5E2DC] text-[12px]"
                  />
                  <input
                    type="text"
                    disabled={!canEdit}
                    value={cf.value}
                    onChange={(e) => {
                      const next = [...draft.customFields];
                      next[idx] = { ...cf, value: e.target.value };
                      setDraft({ ...draft, customFields: next });
                    }}
                    placeholder="Giá trị"
                    className="flex-1 h-8 px-2 rounded-lg border border-[#E5E2DC] text-[12px]"
                  />
                  {canEdit && (
                    <button
                      type="button"
                      onClick={() =>
                        setDraft({
                          ...draft,
                          customFields: draft.customFields.filter((c) => c.id !== cf.id),
                        })
                      }
                      className="p-1 text-[#8A847C] hover:text-[#B91C1C]"
                    >
                      <Trash2 className="w-3.5 h-3.5" strokeWidth={1.5} />
                    </button>
                  )}
                </div>
              ))}
            </div>

            {/* Footer policies */}
            <div className="pt-3 border-t border-[#E5E2DC] space-y-2">
              <label className="block text-[11px] text-[#57534E]">Nội quy / Chân trang (Tiếng Việt)</label>
              <textarea
                rows={2}
                disabled={!canEdit}
                value={draft.footerPolicyVi}
                onChange={(e) => setDraft({ ...draft, footerPolicyVi: e.target.value })}
                className="w-full p-2.5 rounded-lg border border-[#E5E2DC] text-[12px]"
              />
              <label className="block text-[11px] text-[#57534E]">Nội quy / Chân trang (Tiếng Anh)</label>
              <textarea
                rows={2}
                disabled={!canEdit}
                value={draft.footerPolicyEn}
                onChange={(e) => setDraft({ ...draft, footerPolicyEn: e.target.value })}
                className="w-full p-2.5 rounded-lg border border-[#E5E2DC] text-[12px]"
              />
            </div>
          </div>

          {/* Right Live Preview Column */}
          <div className="col-span-7 space-y-2">
            <div className="text-[12px] font-medium text-[#57534E] px-1">
              Xem trước trực tiếp theo thời gian thực (Live Preview)
            </div>
            <FormPaperPreview
              template={draft}
              booking={previewBooking}
              hotelName={hotelConfig.hotelName}
              hotelAddress={hotelConfig.address}
              hotelPhone={hotelConfig.phone}
              wifiPassword={hotelConfig.wifiByFloor?.[previewBooking.floor]}
              vietQrUrl={vietQrUrl}
              staffName={actor.name}
            />
          </div>
        </div>
      </div>
    </div>
  );
};
