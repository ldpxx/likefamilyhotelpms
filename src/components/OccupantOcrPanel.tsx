import React, { useEffect, useState } from 'react';
import {
  AlertTriangle,
  Camera,
  CheckCircle2,
  Globe,
  Loader2,
  Plus,
  RefreshCw,
  ScanLine,
  Trash2,
  UserPlus,
} from 'lucide-react';
import { usePms } from '../context/PmsContext';
import type { Booking, GuestCategory, Occupant } from '../types/pms';
import { compressDocumentImage, formatFileSizeKB } from '../lib/imageCompression';
import { GeminiOcrError, runGuestDocumentOcr } from '../lib/geminiOcr';
import {
  getGuestDocument,
  markOccupantAsmDeclared,
  saveBookingOccupants,
  saveGuestDocumentImages,
  upsertGuestProfile,
} from '../lib/pmsActions';
import {
  addDays,
  formatDateTimeVN,
  formatDateVN,
  generateId,
  todayISO,
} from '../lib/utils';
import { DateInputVN } from './DateInputVN';

interface OccupantOcrPanelProps {
  booking: Booking;
}

interface PhotoSlotState {
  storageBase64: string | null;
  ocrBase64: string | null;
  sizeBytes: number;
}

const EMPTY_SLOT: PhotoSlotState = { storageBase64: null, ocrBase64: null, sizeBytes: 0 };

export const OccupantOcrPanel: React.FC<OccupantOcrPanelProps> = ({ booking }) => {
  const { guests, actor, notify } = usePms();
  const [occupants, setOccupants] = useState<Occupant[]>(booking.occupants || []);
  const [activeOccId, setActiveOccId] = useState<string>(
    booking.occupants?.[0]?.occupantId || ''
  );

  // Local image slots for currently selected occupant (loaded lazily from `guest_documents`)
  const [frontSlot, setFrontSlot] = useState<PhotoSlotState>(EMPTY_SLOT);
  const [backSlot, setBackSlot] = useState<PhotoSlotState>(EMPTY_SLOT);
  const [stampSlot, setStampSlot] = useState<PhotoSlotState>(EMPTY_SLOT);
  const [loadingDoc, setLoadingDoc] = useState(false);

  const [scanning, setScanning] = useState(false);
  const [ocrError, setOcrError] = useState<string | null>(null);
  const [ocrSuccessNote, setOcrSuccessNote] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    setOccupants(booking.occupants || []);
    if (!booking.occupants.some((o) => o.occupantId === activeOccId)) {
      setActiveOccId(booking.occupants?.[0]?.occupantId || '');
    }
  }, [booking.id, booking.occupants]);

  const activeOcc = occupants.find((o) => o.occupantId === activeOccId) || occupants[0];

  // Load saved Base64 images from separate `guest_documents` collection on demand
  useEffect(() => {
    let cancelled = false;
    setOcrError(null);
    setOcrSuccessNote(null);

    if (!activeOcc?.documentId) {
      setFrontSlot(EMPTY_SLOT);
      setBackSlot(EMPTY_SLOT);
      setStampSlot(EMPTY_SLOT);
      return;
    }

    setLoadingDoc(true);
    getGuestDocument(activeOcc.documentId)
      .then((gd) => {
        if (cancelled) return;
        if (!gd || gd.isCleaned) {
          setFrontSlot(EMPTY_SLOT);
          setBackSlot(EMPTY_SLOT);
          setStampSlot(EMPTY_SLOT);
        } else {
          setFrontSlot({
            storageBase64: gd.frontImageBase64 || null,
            ocrBase64: gd.frontImageBase64 || null,
            sizeBytes: gd.frontImageBase64 ? Math.round((gd.frontImageBase64.length * 3) / 4) : 0,
          });
          setBackSlot({
            storageBase64: gd.backImageBase64 || null,
            ocrBase64: gd.backImageBase64 || null,
            sizeBytes: gd.backImageBase64 ? Math.round((gd.backImageBase64.length * 3) / 4) : 0,
          });
          setStampSlot({
            storageBase64: gd.entryStampImageBase64 || null,
            ocrBase64: gd.entryStampImageBase64 || null,
            sizeBytes: gd.entryStampImageBase64
              ? Math.round((gd.entryStampImageBase64.length * 3) / 4)
              : 0,
          });
        }
      })
      .finally(() => {
        if (!cancelled) setLoadingDoc(false);
      });

    return () => {
      cancelled = true;
    };
  }, [activeOcc?.occupantId, activeOcc?.documentId]);

  const updateActiveOcc = (patch: Partial<Occupant>) => {
    if (!activeOcc) return;
    setOccupants((prev) =>
      prev.map((o) => (o.occupantId === activeOcc.occupantId ? { ...o, ...patch } : o))
    );
  };

  const handleAddOccupant = () => {
    const newOcc: Occupant = {
      occupantId: generateId('occ'),
      guestId: generateId('guest'),
      guestCategory: 'vietnamese',
      fullName: '',
      phone: '',
      gender: '',
      dob: '',
      nationality: 'Việt Nam',
      idType: 'cccd',
      idNumber: '',
      visaNumber: '',
      idIssueDate: '',
      address: '',
      entryDate: '',
      stayPermitExpiryDate: '',
      asmStatus: 'not_applicable',
      isPrimary: false,
    };
    setOccupants((prev) => [...prev, newOcc]);
    setActiveOccId(newOcc.occupantId);
    setFrontSlot(EMPTY_SLOT);
    setBackSlot(EMPTY_SLOT);
    setStampSlot(EMPTY_SLOT);
  };

  const handleRemoveOccupant = (occId: string) => {
    if (occupants.length <= 1) return;
    const target = occupants.find((o) => o.occupantId === occId);
    if (target?.isPrimary) {
      notify('Không thể xóa khách đại diện chính', 'warning');
      return;
    }
    const next = occupants.filter((o) => o.occupantId !== occId);
    setOccupants(next);
    setActiveOccId(next[0].occupantId);
  };

  const handleFileUpload = async (
    slot: 'front' | 'back' | 'stamp',
    file: File | undefined
  ) => {
    if (!file) return;
    try {
      const compressed = await compressDocumentImage(file);
      const nextState: PhotoSlotState = {
        storageBase64: compressed.storageBase64,
        ocrBase64: compressed.ocrBase64,
        sizeBytes: compressed.storageSizeBytes,
      };
      if (slot === 'front') setFrontSlot(nextState);
      if (slot === 'back') setBackSlot(nextState);
      if (slot === 'stamp') setStampSlot(nextState);
      setOcrError(null);
    } catch (err) {
      notify(err instanceof Error ? err.message : 'Lỗi nén ảnh trên trình duyệt', 'error');
    }
  };

  const handleRunOcr = async (forceRefreshConfig = false) => {
    if (!activeOcc) return;
    setOcrError(null);
    setOcrSuccessNote(null);

    const images: Array<{ label: string; dataUrl: string }> = [];
    if (activeOcc.guestCategory === 'vietnamese') {
      if (frontSlot.ocrBase64) images.push({ label: 'Mặt trước CCCD', dataUrl: frontSlot.ocrBase64 });
      if (backSlot.ocrBase64) images.push({ label: 'Mặt sau CCCD', dataUrl: backSlot.ocrBase64 });
    } else {
      if (frontSlot.ocrBase64)
        images.push({ label: 'Trang nhân thân Hộ chiếu (Passport Bio Page)', dataUrl: frontSlot.ocrBase64 });
      if (backSlot.ocrBase64)
        images.push({ label: 'Thị thực / e-Visa', dataUrl: backSlot.ocrBase64 });
      if (stampSlot.ocrBase64)
        images.push({
          label: 'Trang có Dấu mộc nhập cảnh Việt Nam (Vietnam Immigration Entry Stamp)',
          dataUrl: stampSlot.ocrBase64,
        });
    }

    if (images.length === 0) {
      setOcrError('Vui lòng chụp hoặc tải lên ít nhất 1 ảnh giấy tờ trước khi chạy AI OCR.');
      return;
    }

    setScanning(true);
    try {
      const extracted = await runGuestDocumentOcr({
        category: activeOcc.guestCategory,
        images,
        forceRefreshConfig,
      });

      updateActiveOcc({
        fullName: extracted.fullName || activeOcc.fullName,
        idNumber: extracted.idNumber || activeOcc.idNumber,
        visaNumber: extracted.visaNumber || activeOcc.visaNumber,
        gender: extracted.gender || activeOcc.gender,
        dob: extracted.dob || activeOcc.dob,
        nationality: extracted.nationality || activeOcc.nationality,
        address: extracted.address || activeOcc.address,
        idIssueDate: extracted.idIssueDate || activeOcc.idIssueDate,
        entryDate: extracted.entryDate || activeOcc.entryDate,
        stayPermitExpiryDate: extracted.stayPermitExpiryDate || activeOcc.stayPermitExpiryDate,
      });

      setOcrSuccessNote(
        `Quét thành công bằng ${extracted.modelUsed}.${
          extracted.confidenceNote ? ` ${extracted.confidenceNote}` : ''
        }`
      );
      notify('AI OCR đã trích xuất thông tin vào biểu mẫu. Hãy kiểm tra và bấm Lưu hồ sơ.');
    } catch (err) {
      if (err instanceof GeminiOcrError) {
        setOcrError(err.message);
      } else {
        setOcrError(err instanceof Error ? err.message : 'Lỗi không xác định khi gọi AI OCR');
      }
    } finally {
      setScanning(false);
    }
  };

  const handleSaveAllOccupants = async () => {
    if (!activeOcc) return;
    if (!activeOcc.fullName.trim()) {
      notify('Vui lòng nhập Họ và tên khách trước khi lưu', 'warning');
      return;
    }
    setSaving(true);
    try {
      // 1. Upsert Guest in `guests` collection
      const { guestId } = await upsertGuestProfile(
        {
          id: activeOcc.guestId,
          guestCategory: activeOcc.guestCategory,
          fullName: activeOcc.fullName,
          phone: activeOcc.phone,
          gender: activeOcc.gender,
          dob: activeOcc.dob,
          nationality: activeOcc.nationality,
          idType: activeOcc.guestCategory === 'vietnamese' ? 'cccd' : 'visa_passport',
          idNumber: activeOcc.idNumber,
          visaNumber: activeOcc.visaNumber,
          idIssueDate: activeOcc.idIssueDate,
          address: activeOcc.address,
          entryDate: activeOcc.entryDate,
          stayPermitExpiryDate: activeOcc.stayPermitExpiryDate,
        },
        guests
      );

      // 2. Save Base64 compressed photos into SEPARATE `guest_documents` collection if any image present
      let documentId = activeOcc.documentId || null;
      const hasAnyPhoto = Boolean(
        frontSlot.storageBase64 || backSlot.storageBase64 || stampSlot.storageBase64
      );
      if (hasAnyPhoto) {
        const savedDoc = await saveGuestDocumentImages({
          documentId,
          guestId,
          bookingId: booking.id,
          occupantId: activeOcc.occupantId,
          guestName: activeOcc.fullName,
          guestCategory: activeOcc.guestCategory,
          frontImageBase64: frontSlot.storageBase64,
          backImageBase64: backSlot.storageBase64,
          entryStampImageBase64: stampSlot.storageBase64,
          actor,
        });
        documentId = savedDoc.id;
      }

      // 3. Update occupants list on booking (storing ONLY lightweight metadata, NEVER Base64!)
      const nextOccupants = occupants.map((o) => {
        if (o.occupantId !== activeOcc.occupantId) return o;
        return {
          ...o,
          guestId,
          documentId,
          hasFrontPhoto: Boolean(frontSlot.storageBase64),
          hasBackPhoto: Boolean(backSlot.storageBase64),
          hasStampPhoto: Boolean(stampSlot.storageBase64),
          asmStatus:
            o.guestCategory === 'foreigner'
              ? o.asmStatus === 'declared_asm'
                ? 'declared_asm'
                : 'pending_asm'
              : 'not_applicable',
        } as Occupant;
      });

      await saveBookingOccupants(booking, nextOccupants, actor);
      setOccupants(nextOccupants);
      notify('Đã lưu hồ sơ khách lưu trú & ảnh giấy tờ nén Base64 thành công');
    } catch (err) {
      notify(err instanceof Error ? err.message : 'Lỗi lưu hồ sơ khách', 'error');
    } finally {
      setSaving(false);
    }
  };

  const handleToggleAsm = async () => {
    if (!activeOcc || activeOcc.guestCategory !== 'foreigner') return;
    const nextDeclared = activeOcc.asmStatus !== 'declared_asm';
    await markOccupantAsmDeclared(booking, activeOcc.occupantId, nextDeclared, actor);
    notify(
      nextDeclared
        ? `Đã đánh dấu khai báo ASM cho ${activeOcc.fullName}`
        : `Đã chuyển lại trạng thái chờ khai báo ASM`
    );
  };

  const isPermitExpiredOrSoon =
    activeOcc?.guestCategory === 'foreigner' &&
    Boolean(activeOcc.stayPermitExpiryDate) &&
    (activeOcc.stayPermitExpiryDate! < booking.checkOut ||
      activeOcc.stayPermitExpiryDate! <= addDays(todayISO(), 2));

  return (
    <div className="space-y-4">
      {/* Occupant Tabs (Unlimited guests per room) */}
      <div className="flex flex-wrap items-center gap-2">
        {occupants.map((occ, idx) => (
          <button
            key={occ.occupantId}
            type="button"
            onClick={() => setActiveOccId(occ.occupantId)}
            className={`h-9 px-3 rounded-lg border text-[12px] font-medium inline-flex items-center gap-2 transition-colors ${
              occ.occupantId === activeOcc?.occupantId
                ? 'border-[#1B5E4B] bg-[#E8F2EE] text-[#1B5E4B]'
                : 'border-[#E5E2DC] bg-white text-[#57534E] hover:text-[#1C1B18]'
            }`}
          >
            <span>
              {occ.fullName || `Khách ${idx + 1}`}
              {occ.isPrimary ? ' (Chính)' : ''}
            </span>
            {occ.guestCategory === 'foreigner' && (
              <span
                className={`w-2 h-2 rounded-full ${
                  occ.asmStatus === 'declared_asm' ? 'bg-[#15803D]' : 'bg-[#D97706]'
                }`}
              />
            )}
          </button>
        ))}

        <button
          type="button"
          onClick={handleAddOccupant}
          className="h-9 px-3 rounded-lg border border-dashed border-[#1B5E4B] text-[#1B5E4B] hover:bg-[#E8F2EE]/50 text-[12px] font-medium inline-flex items-center gap-1.5"
        >
          <UserPlus className="w-3.5 h-3.5" strokeWidth={1.5} />
          Thêm khách lưu trú
        </button>
      </div>

      {activeOcc && (
        <div className="rounded-xl border border-[#E5E2DC] bg-[#FAF9F6] p-4 space-y-4">
          {/* Category Switch & ASM Status */}
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div className="inline-flex p-0.5 rounded-lg bg-[#E7E5E0] text-[12px]">
              {(['vietnamese', 'foreigner'] as GuestCategory[]).map((cat) => (
                <button
                  key={cat}
                  type="button"
                  onClick={() =>
                    updateActiveOcc({
                      guestCategory: cat,
                      idType: cat === 'vietnamese' ? 'cccd' : 'visa_passport',
                      nationality: cat === 'vietnamese' ? 'Việt Nam' : activeOcc.nationality === 'Việt Nam' ? '' : activeOcc.nationality,
                      asmStatus: cat === 'foreigner' ? 'pending_asm' : 'not_applicable',
                    })
                  }
                  className={`px-3 py-1 rounded-md font-medium ${
                    activeOcc.guestCategory === cat
                      ? 'bg-white text-[#1C1B18]'
                      : 'text-[#57534E]'
                  }`}
                >
                  {cat === 'vietnamese' ? 'Khách Việt Nam (CCCD 2 mặt)' : 'Khách Nước ngoài (3 ảnh + ASM)'}
                </button>
              ))}
            </div>

            <div className="flex items-center gap-2">
              {activeOcc.guestCategory === 'foreigner' && (
                <button
                  type="button"
                  onClick={handleToggleAsm}
                  className={`h-8 px-3 rounded-lg text-[12px] font-medium inline-flex items-center gap-1.5 border transition-colors ${
                    activeOcc.asmStatus === 'declared_asm'
                      ? 'bg-[#ECFDF5] border-[#A7F3D0] text-[#065F46]'
                      : 'bg-[#FFFBEB] border-[#FDE68A] text-[#92400E]'
                  }`}
                >
                  {activeOcc.asmStatus === 'declared_asm' ? (
                    <>
                      <CheckCircle2 className="w-3.5 h-3.5" strokeWidth={1.5} />
                      Đã khai báo ASM
                    </>
                  ) : (
                    <>
                      <Globe className="w-3.5 h-3.5" strokeWidth={1.5} />
                      Đánh dấu đã khai báo ASM
                    </>
                  )}
                </button>
              )}

              {!activeOcc.isPrimary && (
                <button
                  type="button"
                  onClick={() => handleRemoveOccupant(activeOcc.occupantId)}
                  className="h-8 px-2.5 rounded-lg border border-[#E5E2DC] bg-white hover:text-[#B91C1C] text-[12px] inline-flex items-center gap-1"
                >
                  <Trash2 className="w-3.5 h-3.5" strokeWidth={1.5} />
                  Xóa
                </button>
              )}
            </div>
          </div>

          {/* Stay Permit Overstay Alert */}
          {isPermitExpiredOrSoon && (
            <div className="p-3 rounded-xl bg-[#FEF2F2] border border-[#FECACA] text-[#991B1B] flex items-start gap-2.5 text-[12px]">
              <AlertTriangle className="w-4 h-4 shrink-0 mt-0.5" strokeWidth={1.5} />
              <div>
                <div className="font-semibold">
                  Cảnh báo thời hạn tạm trú tại Việt Nam ({formatDateVN(activeOcc.stayPermitExpiryDate)})
                </div>
                <p className="mt-0.5">
                  Hạn lưu trú trên dấu nhập cảnh hết hạn trước ngày trả phòng dự kiến (
                  {formatDateVN(booking.checkOut)}) hoặc chỉ còn ≤ 2 ngày. Lễ tân cần nhắc khách gia
                  hạn thị thực hoặc làm thủ tục trả phòng đúng hạn.
                </p>
              </div>
            </div>
          )}

          {/* Compressed Base64 Photo Upload Slots (2 for CCCD, 3 for Foreigner) */}
          <div className="space-y-2.5">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <div className="text-[12px] font-medium text-[#1C1B18]">
                Ảnh giấy tờ (Tự động nén Canvas ≤ 800px, JPEG 0.65 lưu Base64 trên Firestore — 0đ Storage)
              </div>
              <div className="flex items-center gap-2">
                <button
                  type="button"
                  onClick={() => handleRunOcr(false)}
                  disabled={scanning}
                  className="h-8 px-3.5 rounded-lg bg-[#1B5E4B] hover:bg-[#144839] disabled:opacity-50 text-white text-[12px] font-medium inline-flex items-center gap-1.5 transition-colors"
                >
                  {scanning ? (
                    <Loader2 className="w-3.5 h-3.5 animate-spin" />
                  ) : (
                    <ScanLine className="w-3.5 h-3.5" strokeWidth={1.5} />
                  )}
                  {scanning ? 'Đang quét Gemini Vision...' : 'Quét AI OCR tự điền'}
                </button>
              </div>
            </div>

            {loadingDoc ? (
              <div className="text-[12px] text-[#8A847C] py-4 text-center">
                Đang tải ảnh giấy tờ từ Firestore...
              </div>
            ) : (
              <div
                className={`grid gap-3 ${
                  activeOcc.guestCategory === 'vietnamese'
                    ? 'grid-cols-1 sm:grid-cols-2'
                    : 'grid-cols-1 sm:grid-cols-3'
                }`}
              >
                {/* Slot 1: CCCD Front OR Passport Bio Page */}
                <PhotoUploadCard
                  label={
                    activeOcc.guestCategory === 'vietnamese'
                      ? '1. Mặt trước CCCD'
                      : '1. Trang nhân thân Hộ chiếu'
                  }
                  slot={frontSlot}
                  onSelectFile={(f) => handleFileUpload('front', f)}
                  onClear={() => setFrontSlot(EMPTY_SLOT)}
                />

                {/* Slot 2: CCCD Back OR Visa / e-Visa */}
                <PhotoUploadCard
                  label={
                    activeOcc.guestCategory === 'vietnamese'
                      ? '2. Mặt sau CCCD (Ngày cấp)'
                      : '2. Thị thực / e-Visa'
                  }
                  slot={backSlot}
                  onSelectFile={(f) => handleFileUpload('back', f)}
                  onClear={() => setBackSlot(EMPTY_SLOT)}
                />

                {/* Slot 3 (Foreigner only): Vietnam Entry Stamp */}
                {activeOcc.guestCategory === 'foreigner' && (
                  <PhotoUploadCard
                    label="3. Trang có Dấu mộc nhập cảnh (Ưu tiên lấy hạn)"
                    slot={stampSlot}
                    onSelectFile={(f) => handleFileUpload('stamp', f)}
                    onClear={() => setStampSlot(EMPTY_SLOT)}
                  />
                )}
              </div>
            )}

            {/* Honest Zero-Mock Error Banner */}
            {ocrError && (
              <div className="p-3 rounded-xl bg-[#FEF2F2] border border-[#FECACA] text-[#991B1B] text-[12px] space-y-2">
                <div className="font-medium">Không thể tự động trích xuất OCR:</div>
                <p>{ocrError}</p>
                <div className="flex flex-wrap gap-2">
                  <button
                    type="button"
                    onClick={() => handleRunOcr(true)}
                    disabled={scanning}
                    className="h-7 px-2.5 rounded-md bg-white border border-[#FECACA] text-[#991B1B] font-medium inline-flex items-center gap-1"
                  >
                    <RefreshCw className="w-3 h-3" strokeWidth={1.5} />
                    Thử quét lại (Làm mới cấu hình)
                  </button>
                  <span className="text-[11px] text-[#7F1D1D] self-center">
                    Hoặc nhập trực tiếp các trường bên dưới trong khi đối chiếu ảnh gốc.
                  </span>
                </div>
              </div>
            )}

            {ocrSuccessNote && (
              <div className="p-2.5 rounded-lg bg-[#ECFDF5] border border-[#A7F3D0] text-[#065F46] text-[12px]">
                {ocrSuccessNote}
              </div>
            )}
          </div>

          {/* Structured Guest Data Form (Exact required fields) */}
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3 pt-2 border-t border-[#E5E2DC]">
            <div>
              <label className="block text-[11px] font-medium text-[#57534E] mb-1">
                Họ và tên *
              </label>
              <input
                type="text"
                value={activeOcc.fullName}
                onChange={(e) => updateActiveOcc({ fullName: e.target.value })}
                className="w-full h-9 px-3 rounded-lg border border-[#E5E2DC] bg-white text-[13px]"
              />
            </div>

            <div>
              <label className="block text-[11px] font-medium text-[#57534E] mb-1">
                {activeOcc.guestCategory === 'vietnamese' ? 'Số CCCD' : 'Số Hộ chiếu'}
              </label>
              <input
                type="text"
                value={activeOcc.idNumber}
                onChange={(e) => updateActiveOcc({ idNumber: e.target.value })}
                className="w-full h-9 px-3 rounded-lg border border-[#E5E2DC] bg-white text-[13px] font-mono-num"
              />
            </div>

            {activeOcc.guestCategory === 'foreigner' ? (
              <div>
                <label className="block text-[11px] font-medium text-[#57534E] mb-1">
                  Mã số Visa / e-Visa
                </label>
                <input
                  type="text"
                  value={activeOcc.visaNumber || ''}
                  onChange={(e) => updateActiveOcc({ visaNumber: e.target.value })}
                  className="w-full h-9 px-3 rounded-lg border border-[#E5E2DC] bg-white text-[13px] font-mono-num"
                />
              </div>
            ) : (
              <div>
                <label className="block text-[11px] font-medium text-[#57534E] mb-1">
                  Ngày cấp CCCD (dd/mm/YYYY)
                </label>
                <DateInputVN
                  value={activeOcc.idIssueDate || ''}
                  onChange={(v) => updateActiveOcc({ idIssueDate: v })}
                />
              </div>
            )}

            <div>
              <label className="block text-[11px] font-medium text-[#57534E] mb-1">Giới tính</label>
              <select
                value={activeOcc.gender}
                onChange={(e) => updateActiveOcc({ gender: e.target.value })}
                className="w-full h-9 px-3 rounded-lg border border-[#E5E2DC] bg-white text-[13px]"
              >
                <option value="">-- Chọn --</option>
                <option value="Nam">Nam</option>
                <option value="Nữ">Nữ</option>
                <option value="Khác">Khác</option>
              </select>
            </div>

            <div>
              <label className="block text-[11px] font-medium text-[#57534E] mb-1">
                Số điện thoại
              </label>
              <input
                type="tel"
                value={activeOcc.phone}
                onChange={(e) => updateActiveOcc({ phone: e.target.value })}
                className="w-full h-9 px-3 rounded-lg border border-[#E5E2DC] bg-white text-[13px] font-mono-num"
              />
            </div>

            {activeOcc.guestCategory === 'vietnamese' ? (
              <div className="sm:col-span-2 lg:col-span-3">
                <label className="block text-[11px] font-medium text-[#57534E] mb-1">
                  Thường trú
                </label>
                <input
                  type="text"
                  value={activeOcc.address || ''}
                  onChange={(e) => updateActiveOcc({ address: e.target.value })}
                  className="w-full h-9 px-3 rounded-lg border border-[#E5E2DC] bg-white text-[13px]"
                />
              </div>
            ) : (
              <>
                <div>
                  <label className="block text-[11px] font-medium text-[#57534E] mb-1">
                    Ngày sinh (dd/mm/YYYY)
                  </label>
                  <DateInputVN
                    value={activeOcc.dob || ''}
                    onChange={(v) => updateActiveOcc({ dob: v })}
                  />
                </div>
                <div>
                  <label className="block text-[11px] font-medium text-[#57534E] mb-1">
                    Quốc tịch
                  </label>
                  <input
                    type="text"
                    value={activeOcc.nationality}
                    onChange={(e) => updateActiveOcc({ nationality: e.target.value })}
                    placeholder="Korea, USA, Australia..."
                    className="w-full h-9 px-3 rounded-lg border border-[#E5E2DC] bg-white text-[13px]"
                  />
                </div>
                <div>
                  <label className="block text-[11px] font-medium text-[#57534E] mb-1">
                    Ngày nhập cảnh VN (dd/mm/YYYY)
                  </label>
                  <DateInputVN
                    value={activeOcc.entryDate || ''}
                    onChange={(v) => updateActiveOcc({ entryDate: v })}
                  />
                </div>
                <div>
                  <label className="block text-[11px] font-medium text-[#991B1B] mb-1">
                    Hạn lưu trú VN (Ưu tiên dấu nhập cảnh)
                  </label>
                  <DateInputVN
                    value={activeOcc.stayPermitExpiryDate || ''}
                    onChange={(v) => updateActiveOcc({ stayPermitExpiryDate: v })}
                  />
                </div>
              </>
            )}
          </div>

          <div className="flex items-center justify-between pt-2">
            <div className="text-[11px] text-[#8A847C]">
              {activeOcc.asmStatus === 'declared_asm' && activeOcc.asmDeclaredAt
                ? `Đã khai báo ASM lúc ${formatDateTimeVN(activeOcc.asmDeclaredAt)} bởi ${activeOcc.asmDeclaredBy}`
                : 'Hồ sơ khách sẽ tự động đồng bộ vào Kho Khách Hàng để nhận diện Khách hàng thân quen.'}
            </div>
            <button
              type="button"
              onClick={handleSaveAllOccupants}
              disabled={saving}
              className="h-9 px-4 rounded-lg bg-[#1B5E4B] hover:bg-[#144839] disabled:opacity-50 text-white text-[13px] font-medium transition-colors"
            >
              {saving ? 'Đang lưu...' : 'Lưu hồ sơ & ảnh giấy tờ'}
            </button>
          </div>
        </div>
      )}
    </div>
  );
};

const PhotoUploadCard: React.FC<{
  label: string;
  slot: PhotoSlotState;
  onSelectFile: (file: File | undefined) => void;
  onClear: () => void;
}> = ({ label, slot, onSelectFile, onClear }) => {
  return (
    <div className="rounded-xl border border-[#E5E2DC] bg-white p-2.5 flex flex-col justify-between gap-2">
      <div className="flex items-center justify-between gap-1">
        <span className="text-[11px] font-medium text-[#57534E] leading-tight">{label}</span>
        {slot.storageBase64 && (
          <span className="text-[10px] font-mono-num text-[#15803D] shrink-0">
            {formatFileSizeKB(slot.sizeBytes)}
          </span>
        )}
      </div>

      {slot.storageBase64 ? (
        <div className="relative group rounded-lg overflow-hidden border border-[#E5E2DC] bg-[#F7F6F3] h-32">
          <img
            src={slot.storageBase64}
            alt={label}
            className="w-full h-full object-contain"
          />
          <button
            type="button"
            onClick={onClear}
            className="absolute top-1.5 right-1.5 w-6 h-6 rounded-md bg-black/65 text-white flex items-center justify-center opacity-0 group-hover:opacity-100 transition-opacity"
            title="Xóa ảnh"
          >
            <Trash2 className="w-3.5 h-3.5" strokeWidth={1.5} />
          </button>
        </div>
      ) : (
        <label className="h-32 rounded-lg border border-dashed border-[#D0CBC2] hover:border-[#1B5E4B] bg-[#FAF9F6] flex flex-col items-center justify-center gap-1.5 cursor-pointer text-[#8A847C] hover:text-[#1B5E4B] transition-colors">
          <Camera className="w-5 h-5" strokeWidth={1.5} />
          <span className="text-[11px] font-medium">Chụp / Tải ảnh lên</span>
          <input
            type="file"
            accept="image/*"
            capture="environment"
            className="hidden"
            onChange={(e) => {
              onSelectFile(e.target.files?.[0]);
              e.target.value = '';
            }}
          />
        </label>
      )}

      {slot.storageBase64 && (
        <label className="text-center text-[11px] text-[#1B5E4B] hover:underline cursor-pointer inline-flex items-center justify-center gap-1">
          <Plus className="w-3 h-3" strokeWidth={1.5} /> Thay ảnh khác
          <input
            type="file"
            accept="image/*"
            capture="environment"
            className="hidden"
            onChange={(e) => {
              onSelectFile(e.target.files?.[0]);
              e.target.value = '';
            }}
          />
        </label>
      )}
    </div>
  );
};
