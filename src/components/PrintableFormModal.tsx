import React, { useRef, useState } from 'react';
import { toPng } from 'html-to-image';
import { Download, Printer, X } from 'lucide-react';
import { usePms } from '../context/PmsContext';
import type { Booking, FormTemplate, FormTemplateType } from '../types/pms';
import {
  formatCurrency,
  formatDateVN,
  getBookingGuestBalance,
  todayISO,
} from '../lib/utils';
import { buildVietQrUrl } from '../lib/vietqr';

interface PrintableFormModalProps {
  booking: Booking;
  initialType: FormTemplateType;
  onClose: () => void;
}

export const FormPaperPreview: React.FC<{
  template: FormTemplate;
  booking: Booking;
  hotelName: string;
  hotelAddress: string;
  hotelPhone: string;
  wifiPassword?: string;
  vietQrUrl: string | null;
  staffName: string;
}> = ({
  template,
  booking,
  hotelName,
  hotelAddress,
  hotelPhone,
  wifiPassword,
  vietQrUrl,
  staffName,
}) => {
  const vf = template.visibleFields || {};
  const showVi = template.language === 'vi' || template.language === 'bilingual';
  const showEn = template.language === 'en' || template.language === 'bilingual';

  const balance = getBookingGuestBalance(booking);
  const grandTotal =
    booking.grossRoomTotal + (booking.serviceTotal || 0) + (booking.hourlySurcharge || 0);

  return (
    <div className="bg-white text-[#1C1B18] p-8 border border-[#E5E2DC] rounded-xl max-w-[740px] mx-auto space-y-5">
      {/* Header */}
      <div className="flex items-start justify-between gap-4 pb-4 border-b border-[#E5E2DC]">
        <div className="flex items-center gap-3">
          {template.logoBase64 && (
            <img
              src={template.logoBase64}
              alt="Logo"
              className="w-12 h-12 object-contain rounded-lg border border-[#E5E2DC] p-1"
            />
          )}
          <div>
            <div className="text-[16px] font-semibold text-[#1B5E4B]">
              {template.hotelNameOverride || hotelName}
            </div>
            <div className="text-[12px] text-[#57534E]">
              {template.hotelAddressOverride || hotelAddress}
            </div>
            <div className="text-[12px] text-[#57534E] font-mono-num">
              Tel: {template.hotelPhoneOverride || hotelPhone}
            </div>
          </div>
        </div>
        <div className="text-right">
          {showVi && (
            <div className="text-[15px] font-semibold text-[#1C1B18]">{template.headerTitleVi}</div>
          )}
          {showEn && (
            <div className="text-[12px] text-[#57534E] font-medium">{template.headerTitleEn}</div>
          )}
          {vf.bookingCode !== false && (
            <div className="mt-1 text-[12px] font-mono-num text-[#1B5E4B] font-semibold">
              #{booking.bookingCode}
            </div>
          )}
        </div>
      </div>

      {/* Guest & Stay Summary */}
      <div className="grid grid-cols-2 gap-4 text-[13px]">
        <div className="space-y-1">
          <div>
            <span className="text-[#57534E]">
              {showVi ? 'Khách hàng' : ''}
              {showVi && showEn ? ' / ' : ''}
              {showEn ? 'Guest' : ''}:
            </span>{' '}
            <strong className="font-semibold">{booking.primaryGuestName}</strong>
          </div>
          {vf.guestPhone !== false && (
            <div>
              <span className="text-[#57534E]">SĐT / Phone:</span>{' '}
              <span className="font-mono-num">{booking.primaryGuestPhone || '—'}</span>
            </div>
          )}
          {vf.guestIdNumber && (
            <div>
              <span className="text-[#57534E]">CCCD / Passport:</span>{' '}
              <span className="font-mono-num">{booking.primaryGuestIdNumber || '—'}</span>
            </div>
          )}
          {booking.groupName && (
            <div>
              <span className="text-[#57534E]">Đoàn / Group:</span> {booking.groupName}
            </div>
          )}
        </div>

        <div className="space-y-1 text-right">
          {vf.roomNumber !== false && (
            <div>
              <span className="text-[#57534E]">Phòng / Room:</span>{' '}
              <strong className="font-mono-num">P.{booking.roomNumber}</strong>
              {vf.roomType !== false && ` (${booking.roomTypeName})`}
            </div>
          )}
          <div>
            <span className="text-[#57534E]">Check-in:</span>{' '}
            <span className="font-mono-num font-medium">{formatDateVN(booking.checkIn)}</span>
          </div>
          <div>
            <span className="text-[#57534E]">Check-out:</span>{' '}
            <span className="font-mono-num font-medium">
              {formatDateVN(booking.checkOut)} ({booking.nights} đêm)
            </span>
          </div>
          {vf.wifiInfo && wifiPassword && (
            <div>
              <span className="text-[#57534E]">Wi-Fi:</span>{' '}
              <span className="font-mono-num">{wifiPassword}</span>
            </div>
          )}
        </div>
      </div>

      {/* Occupants List */}
      {vf.occupantList && booking.occupants.length > 0 && (
        <div className="space-y-1.5">
          <div className="text-[12px] font-semibold text-[#57534E]">
            Danh sách khách lưu trú / Registered Guests ({booking.occupants.length})
          </div>
          <table className="w-full text-[12px] border border-[#E5E2DC]">
            <thead className="bg-[#FAF9F6] text-[#57534E]">
              <tr>
                <th className="text-left px-3 py-1.5 font-medium">Họ tên / Name</th>
                <th className="text-left px-3 py-1.5 font-medium">Giấy tờ / ID</th>
                <th className="text-left px-3 py-1.5 font-medium">Quốc tịch</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-[#E5E2DC]">
              {booking.occupants.map((o) => (
                <tr key={o.occupantId}>
                  <td className="px-3 py-1.5 font-medium">{o.fullName}</td>
                  <td className="px-3 py-1.5 font-mono-num">{o.idNumber || '—'}</td>
                  <td className="px-3 py-1.5">{o.nationality || '—'}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {/* Daily Rates & Financial Breakdown */}
      {(vf.dailyRates || vf.serviceBreakdown || vf.balanceDue !== false) && (
        <div className="border border-[#E5E2DC] rounded-lg overflow-hidden">
          <table className="w-full text-[12px]">
            <thead className="bg-[#FAF9F6] border-b border-[#E5E2DC] text-[#57534E]">
              <tr>
                <th className="text-left px-3 py-2 font-medium">Hạng mục / Description</th>
                <th className="text-right px-3 py-2 font-medium">Thành tiền / Amount</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-[#F1EFEA]">
              {booking.bookingMode === 'hourly' ? (
                <tr>
                  <td className="px-3 py-1.5">
                    Tiền phòng theo giờ P.{booking.roomNumber} ({formatDateVN(booking.checkIn)} •{' '}
                    {booking.hourlyHours || 1} giờ)
                  </td>
                  <td className="px-3 py-1.5 text-right font-mono-num">
                    {formatCurrency(booking.grossRoomTotal)}
                  </td>
                </tr>
              ) : vf.dailyRates ? (
                booking.dailyRates.map((d) => (
                  <tr key={d.date}>
                    <td className="px-3 py-1.5">
                      Tiền phòng P.{booking.roomNumber} — Đêm {formatDateVN(d.date)}
                    </td>
                    <td className="px-3 py-1.5 text-right font-mono-num">
                      {formatCurrency(d.rate)}
                    </td>
                  </tr>
                ))
              ) : (
                <tr>
                  <td className="px-3 py-1.5">
                    Tiền phòng P.{booking.roomNumber} ({booking.nights} đêm)
                  </td>
                  <td className="px-3 py-1.5 text-right font-mono-num">
                    {formatCurrency(booking.grossRoomTotal)}
                  </td>
                </tr>
              )}

              {vf.serviceBreakdown &&
                (booking.services || []).map((s) => (
                  <tr key={s.id}>
                    <td className="px-3 py-1.5">
                      {s.name} (×{s.quantity})
                    </td>
                    <td className="px-3 py-1.5 text-right font-mono-num">
                      {formatCurrency(s.total)}
                    </td>
                  </tr>
                ))}

              {vf.hourlySurcharge && booking.hourlySurcharge > 0 && (
                <tr>
                  <td className="px-3 py-1.5">
                    Phụ thu giờ ({booking.hourlySurchargeNote || 'Nhận sớm / Trả muộn'})
                  </td>
                  <td className="px-3 py-1.5 text-right font-mono-num">
                    {formatCurrency(booking.hourlySurcharge)}
                  </td>
                </tr>
              )}
            </tbody>
            <tfoot className="bg-[#FAF9F6] border-t border-[#E5E2DC] text-[13px]">
              <tr>
                <td className="px-3 py-2 font-semibold">Tổng cộng / Total</td>
                <td className="px-3 py-2 text-right font-mono-num font-semibold">
                  {formatCurrency(grandTotal)}
                </td>
              </tr>
              {vf.depositPaid !== false && (booking.depositPaid > 0 || booking.guestPaid > 0) && (
                <tr>
                  <td className="px-3 py-1.5 text-[#57534E]">Đã thanh toán / Paid</td>
                  <td className="px-3 py-1.5 text-right font-mono-num text-[#15803D]">
                    -{formatCurrency((booking.depositPaid || 0) + (booking.guestPaid || 0))}
                  </td>
                </tr>
              )}
              {vf.balanceDue !== false && (
                <tr>
                  <td className="px-3 py-2 font-semibold text-[#1B5E4B]">
                    Còn lại phải thanh toán / Balance Due
                  </td>
                  <td className="px-3 py-2 text-right font-mono-num font-semibold text-[#1B5E4B]">
                    {formatCurrency(Math.max(0, balance))}
                  </td>
                </tr>
              )}
            </tfoot>
          </table>
        </div>
      )}

      {/* Custom Fields */}
      {(template.customFields || []).filter((c) => c.enabled).length > 0 && (
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 text-[12px] bg-[#FAF9F6] p-3 rounded-lg border border-[#E5E2DC]">
          {template.customFields
            .filter((c) => c.enabled)
            .map((cf) => (
              <div key={cf.id}>
                <span className="text-[#57534E]">
                  {showVi ? cf.labelVi : cf.labelEn}:
                </span>{' '}
                <span className="font-medium">{cf.value}</span>
              </div>
            ))}
        </div>
      )}

      {/* VietQR & Signature Section */}
      <div className="flex flex-wrap items-end justify-between gap-4 pt-2">
        <div className="flex-1 min-w-[240px] space-y-1.5 text-[11px] text-[#57534E]">
          {showVi && <p>{template.footerPolicyVi}</p>}
          {showEn && <p className="text-[#8A847C]">{template.footerPolicyEn}</p>}
          {vf.staffName !== false && (
            <p className="pt-2 text-[11px] text-[#8A847C]">
              Nhân viên lập phiếu: {staffName} • {formatDateVN(todayISO())}
            </p>
          )}
        </div>

        {template.showVietQr && vietQrUrl && (
          <div className="text-center border border-[#E5E2DC] rounded-xl p-2 bg-white">
            <img src={vietQrUrl} alt="VietQR" className="w-36 h-auto mx-auto" crossOrigin="anonymous" />
            <div className="text-[10px] font-mono-num text-[#57534E] mt-1">
              Quét mã VietQR thanh toán
            </div>
          </div>
        )}
      </div>

      {vf.signatureBox && (
        <div className="grid grid-cols-2 gap-8 pt-6 text-center text-[12px]">
          <div>
            <div className="font-medium">Chữ ký Khách hàng / Guest Signature</div>
            <div className="h-14 border-b border-dashed border-[#D0CBC2] mt-2" />
          </div>
          <div>
            <div className="font-medium">Đại diện Lễ tân / Receptionist</div>
            <div className="h-14 border-b border-dashed border-[#D0CBC2] mt-2" />
          </div>
        </div>
      )}
    </div>
  );
};

export const PrintableFormModal: React.FC<PrintableFormModalProps> = ({
  booking,
  initialType,
  onClose,
}) => {
  const { formTemplates, hotelConfig, actor, notify } = usePms();
  const [formType, setFormType] = useState<FormTemplateType>(initialType);
  const [exporting, setExporting] = useState(false);
  const paperRef = useRef<HTMLDivElement>(null);

  const template = formTemplates[formType];
  const balance = getBookingGuestBalance(booking);
  const vietQrUrl = buildVietQrUrl({
    bankAccount: hotelConfig.bankAccount,
    amount: Math.max(0, balance),
    addInfo: `THANH TOAN ${booking.bookingCode} P${booking.roomNumber}`,
  });

  const handleDownloadPng = async () => {
    if (!paperRef.current) return;
    setExporting(true);
    try {
      const dataUrl = await toPng(paperRef.current, {
        cacheBust: true,
        pixelRatio: 2,
        backgroundColor: '#FFFFFF',
      });
      const a = document.createElement('a');
      a.download = `${formType}_${booking.bookingCode}_P${booking.roomNumber}.png`;
      a.href = dataUrl;
      a.click();
      notify('Đã xuất ảnh PNG chất lượng cao để gửi Zalo / WhatsApp cho khách');
    } catch {
      notify('Không thể xuất PNG tự động (CORS ảnh QR). Hãy dùng nút In / Lưu PDF.', 'warning');
    } finally {
      setExporting(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 bg-black/50 flex items-center justify-center p-4 overflow-y-auto">
      <div className="bg-[#F7F6F3] border border-[#E5E2DC] rounded-2xl w-full max-w-4xl max-h-[94vh] flex flex-col overflow-hidden shadow-xl">
        <div className="no-print px-5 py-3.5 bg-white border-b border-[#E5E2DC] flex flex-wrap items-center justify-between gap-3">
          <div className="flex items-center gap-1.5">
            {(
              [
                ['booking_confirmation', 'Xác nhận đặt phòng'],
                ['payment_receipt', 'Hóa đơn thanh toán'],
                ['registration_card', 'Phiếu nhận phòng'],
              ] as const
            ).map(([id, label]) => (
              <button
                key={id}
                type="button"
                onClick={() => setFormType(id)}
                className={`h-8 px-3 rounded-lg text-[12px] font-medium transition-colors ${
                  formType === id
                    ? 'bg-[#1B5E4B] text-white'
                    : 'bg-[#F1EFEA] text-[#57534E] hover:text-[#1C1B18]'
                }`}
              >
                {label}
              </button>
            ))}
          </div>

          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={handleDownloadPng}
              disabled={exporting}
              className="h-8 px-3 rounded-lg bg-[#1B5E4B] hover:bg-[#144839] text-white text-[12px] font-medium inline-flex items-center gap-1.5"
            >
              <Download className="w-3.5 h-3.5" strokeWidth={1.5} />
              {exporting ? 'Đang xuất...' : 'Tải ảnh PNG gửi khách'}
            </button>
            <button
              type="button"
              onClick={() => window.print()}
              className="h-8 px-3 rounded-lg border border-[#E5E2DC] bg-white hover:bg-[#F7F6F3] text-[#1C1B18] text-[12px] font-medium inline-flex items-center gap-1.5"
            >
              <Printer className="w-3.5 h-3.5" strokeWidth={1.5} />
              In / Lưu PDF
            </button>
            <button
              type="button"
              onClick={onClose}
              className="w-8 h-8 rounded-lg hover:bg-[#F1EFEA] flex items-center justify-center text-[#57534E]"
            >
              <X className="w-4 h-4" strokeWidth={1.5} />
            </button>
          </div>
        </div>

        <div className="p-6 overflow-y-auto flex-1">
          <div ref={paperRef}>
            <FormPaperPreview
              template={template}
              booking={booking}
              hotelName={hotelConfig.hotelName}
              hotelAddress={hotelConfig.address}
              hotelPhone={hotelConfig.phone}
              wifiPassword={hotelConfig.wifiByFloor?.[booking.floor]}
              vietQrUrl={vietQrUrl}
              staffName={actor.name}
            />
          </div>
        </div>
      </div>
    </div>
  );
};
