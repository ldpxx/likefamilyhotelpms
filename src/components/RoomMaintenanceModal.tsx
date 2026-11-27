import React, { useMemo, useState } from 'react';
import { CheckCircle2, Wrench, X } from 'lucide-react';
import { usePms } from '../context/PmsContext';
import type { PaymentMethod, Room } from '../types/pms';
import { completeRoomMaintenance, createRoomMaintenance } from '../lib/pmsActions';
import { formatCurrency, formatDateVN } from '../lib/utils';

interface RoomMaintenanceModalProps {
  room: Room;
  onClose: () => void;
}

export const RoomMaintenanceModal: React.FC<RoomMaintenanceModalProps> = ({ room, onClose }) => {
  const { maintenances, actor, notify } = usePms();
  const [issueTitle, setIssueTitle] = useState('');
  const [description, setDescription] = useState('');
  const [cost, setCost] = useState(0);
  const [paymentMethod, setPaymentMethod] = useState<PaymentMethod>('cash');
  const [markRoomAsMaintenance, setMarkRoomAsMaintenance] = useState(false);
  const [isCompletedNow, setIsCompletedNow] = useState(true);
  const [saving, setSaving] = useState(false);

  const roomLogs = useMemo(
    () => maintenances.filter((m) => m.roomId === room.id),
    [maintenances, room.id]
  );

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!issueTitle.trim()) return;
    setSaving(true);
    try {
      await createRoomMaintenance({
        room,
        issueTitle,
        description,
        cost,
        markRoomAsMaintenance,
        isCompletedNow,
        paymentMethod,
        actor,
      });
      setIssueTitle('');
      setDescription('');
      setCost(0);
      notify(
        `Đã ghi nhận bảo trì P.${room.roomNumber}${
          cost > 0 ? ` và tự động hạch toán chi phí ${formatCurrency(cost)}` : ''
        }`
      );
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 bg-black/45 flex items-center justify-center p-4">
      <div className="bg-white border border-[#E5E2DC] rounded-2xl w-full max-w-2xl max-h-[90vh] flex flex-col overflow-hidden shadow-xl">
        <div className="px-6 py-4 border-b border-[#E5E2DC] flex items-center justify-between">
          <div className="flex items-center gap-2">
            <Wrench className="w-5 h-5 text-[#1B5E4B]" strokeWidth={1.5} />
            <div>
              <h2 className="text-[15px] font-semibold text-[#1C1B18]">
                Nhật ký Bảo trì & Thiết bị — P.{room.roomNumber} ({room.floor})
              </h2>
              <p className="text-[12px] text-[#57534E]">
                Chi phí sửa chữa sẽ tự động liên kết sang Sổ Chi Phí tài chính
              </p>
            </div>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="w-8 h-8 rounded-lg hover:bg-[#F1EFEA] flex items-center justify-center text-[#57534E]"
          >
            <X className="w-4 h-4" strokeWidth={1.5} />
          </button>
        </div>

        <div className="p-6 overflow-y-auto space-y-5">
          <form onSubmit={handleSubmit} className="rounded-xl border border-[#E5E2DC] bg-[#FAF9F6] p-4 space-y-3">
            <div className="text-[13px] font-semibold text-[#1C1B18]">Ghi nhận đợt bảo trì / sửa chữa</div>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5">
              <input
                type="text"
                required
                value={issueTitle}
                onChange={(e) => setIssueTitle(e.target.value)}
                placeholder="VD: Vệ sinh điều hòa, thay khóa từ..."
                className="h-9 px-3 rounded-lg border border-[#E5E2DC] bg-white text-[13px]"
              />
              <div className="flex gap-2">
                <input
                  type="number"
                  min={0}
                  step={10000}
                  value={cost}
                  onChange={(e) => setCost(Math.max(0, Number(e.target.value) || 0))}
                  placeholder="Chi phí (VNĐ)"
                  className="flex-1 h-9 px-3 rounded-lg border border-[#E5E2DC] bg-white font-mono-num text-[13px]"
                />
                <select
                  value={paymentMethod}
                  onChange={(e) => setPaymentMethod(e.target.value as PaymentMethod)}
                  className="h-9 px-2.5 rounded-lg border border-[#E5E2DC] bg-white text-[12px]"
                >
                  <option value="cash">Tiền mặt</option>
                  <option value="bank_transfer">Chuyển khoản</option>
                </select>
              </div>
            </div>
            <input
              type="text"
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              placeholder="Mô tả chi tiết thợ sửa, linh kiện thay thế..."
              className="w-full h-9 px-3 rounded-lg border border-[#E5E2DC] bg-white text-[13px]"
            />
            <div className="flex flex-wrap items-center justify-between gap-2">
              <div className="flex flex-wrap gap-4 text-[12px] text-[#57534E]">
                <label className="inline-flex items-center gap-1.5 cursor-pointer">
                  <input
                    type="checkbox"
                    checked={isCompletedNow}
                    onChange={(e) => setIsCompletedNow(e.target.checked)}
                    className="accent-[#1B5E4B]"
                  />
                  Đã sửa xong ngay
                </label>
                {!isCompletedNow && (
                  <label className="inline-flex items-center gap-1.5 cursor-pointer text-[#B91C1C]">
                    <input
                      type="checkbox"
                      checked={markRoomAsMaintenance}
                      onChange={(e) => setMarkRoomAsMaintenance(e.target.checked)}
                      className="accent-[#B91C1C]"
                    />
                    Khóa phòng để sửa chữa
                  </label>
                )}
              </div>
              <button
                type="submit"
                disabled={saving}
                className="h-8 px-4 rounded-lg bg-[#1B5E4B] hover:bg-[#144839] text-white text-[12px] font-medium"
              >
                {saving ? 'Đang lưu...' : 'Lưu nhật ký'}
              </button>
            </div>
          </form>

          <div className="space-y-2">
            <div className="text-[12px] font-semibold text-[#57534E]">
              Lịch sử bảo trì P.{room.roomNumber} ({roomLogs.length} lượt)
            </div>
            {roomLogs.length === 0 ? (
              <p className="text-[13px] text-[#8A847C]">Chưa có lịch sử sửa chữa cho phòng này.</p>
            ) : (
              <div className="divide-y divide-[#E5E2DC] border border-[#E5E2DC] rounded-xl">
                {roomLogs.map((m) => (
                  <div key={m.id} className="p-3.5 flex items-center justify-between gap-3">
                    <div>
                      <div className="text-[13px] font-medium text-[#1C1B18]">{m.issueTitle}</div>
                      {m.description && (
                        <div className="text-[12px] text-[#57534E]">{m.description}</div>
                      )}
                      <div className="text-[11px] text-[#8A847C] mt-0.5">
                        {formatDateVN(m.reportedAt)} • {m.performedBy}
                      </div>
                    </div>
                    <div className="text-right shrink-0 space-y-1">
                      <div className="font-mono-num text-[13px] font-semibold text-[#B91C1C]">
                        {formatCurrency(m.cost)}
                      </div>
                      {m.status === 'completed' ? (
                        <span className="inline-flex items-center gap-1 text-[11px] text-[#15803D]">
                          <CheckCircle2 className="w-3.5 h-3.5" strokeWidth={1.5} /> Hoàn tất
                        </span>
                      ) : (
                        <button
                          type="button"
                          onClick={async () => {
                            await completeRoomMaintenance(m, room, actor);
                            notify(`Đã hoàn tất bảo trì P.${room.roomNumber}`);
                          }}
                          className="h-7 px-2.5 rounded-md bg-[#1B5E4B] text-white text-[11px] font-medium"
                        >
                          Đánh dấu xong
                        </button>
                      )}
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
};
