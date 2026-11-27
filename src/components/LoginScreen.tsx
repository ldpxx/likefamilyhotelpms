import React, { useState } from 'react';
import { Building2, Eye, EyeOff, KeyRound, ShieldAlert, ShieldCheck, User } from 'lucide-react';
import { usePms } from '../context/PmsContext';

interface LoginScreenProps {
  onGoToSuperAdmin: () => void;
}

export const LoginScreen: React.FC<LoginScreenProps> = ({ onGoToSuperAdmin }) => {
  const { authBlockReason, loginWithStaffCredentials } = usePms();

  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleStaffSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    setLoading(true);
    try {
      await loginWithStaffCredentials(username, password);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Đăng nhập thất bại.');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="min-h-screen bg-[#F7F6F3] flex items-center justify-center p-6">
      <div className="w-full max-w-[440px] bg-white border border-[#E5E2DC] rounded-2xl p-8 shadow-sm">
        <div className="flex items-center gap-3 mb-6">
          <div className="w-10 h-10 rounded-xl bg-[#1B5E4B] text-white flex items-center justify-center shrink-0">
            <Building2 className="w-5 h-5" strokeWidth={1.5} />
          </div>
          <div>
            <h1 className="text-[18px] font-semibold text-[#1C1B18] leading-tight">
              Like Family PMS
            </h1>
            <p className="text-[13px] text-[#57534E]">
              Đăng nhập Chủ khách sạn & Nhân viên lễ tân
            </p>
          </div>
        </div>

        {authBlockReason && (
          <div className="mb-4 p-3.5 rounded-xl bg-[#FEF2F2] border border-[#FECACA] text-[#991B1B] flex gap-2.5">
            <ShieldAlert className="w-5 h-5 shrink-0 mt-0.5" strokeWidth={1.5} />
            <div className="text-[12px] leading-relaxed">{authBlockReason}</div>
          </div>
        )}

        {error && (
          <div className="mb-4 p-3 rounded-lg bg-[#FEF2F2] border border-[#FECACA] text-[13px] text-[#991B1B]">
            {error}
          </div>
        )}

        <form onSubmit={handleStaffSubmit} className="space-y-4">
          <div>
            <label className="block text-[13px] font-medium text-[#57534E] mb-1.5">
              Tên đăng nhập (Username)
            </label>
            <div className="relative">
              <User
                className="w-4 h-4 text-[#8A847C] absolute left-3 top-3"
                strokeWidth={1.5}
              />
              <input
                type="text"
                required
                autoComplete="username"
                value={username}
                onChange={(e) => setUsername(e.target.value)}
                placeholder="VD: letan01, chukhachsan"
                className="w-full h-10 pl-9 pr-3 rounded-lg border border-[#E5E2DC] bg-white text-[#1C1B18] focus:outline-none focus:border-[#1B5E4B]"
              />
            </div>
          </div>

          <div>
            <label className="block text-[13px] font-medium text-[#57534E] mb-1.5">
              Mật khẩu
            </label>
            <div className="relative">
              <KeyRound
                className="w-4 h-4 text-[#8A847C] absolute left-3 top-3"
                strokeWidth={1.5}
              />
              <input
                type={showPassword ? 'text' : 'password'}
                required
                autoComplete="current-password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                placeholder="Nhập mật khẩu nhân viên"
                className="w-full h-10 pl-9 pr-10 rounded-lg border border-[#E5E2DC] bg-white text-[#1C1B18] focus:outline-none focus:border-[#1B5E4B]"
              />
              <button
                type="button"
                onClick={() => setShowPassword((v) => !v)}
                className="absolute right-3 top-2.5 text-[#8A847C] hover:text-[#1C1B18]"
                tabIndex={-1}
              >
                {showPassword ? (
                  <EyeOff className="w-4 h-4" strokeWidth={1.5} />
                ) : (
                  <Eye className="w-4 h-4" strokeWidth={1.5} />
                )}
              </button>
            </div>
          </div>

          <button
            type="submit"
            disabled={loading}
            className="w-full h-10 rounded-lg bg-[#1B5E4B] hover:bg-[#144839] disabled:opacity-50 text-white text-[14px] font-medium transition-colors"
          >
            {loading ? 'Đang đăng nhập...' : 'Đăng nhập vào quầy lễ tân'}
          </button>

          <p className="text-[12px] text-[#8A847C] leading-relaxed">
            Tài khoản Chủ khách sạn và Nhân viên do SuperAdmin hoặc Quản lý tạo và cấp mật khẩu
            trong hệ thống.
          </p>
        </form>

        <div className="mt-6 pt-4 border-t border-[#E5E2DC] flex items-center justify-between text-[12px]">
          <span className="text-[#8A847C]">Quản trị hệ thống?</span>
          <button
            type="button"
            onClick={onGoToSuperAdmin}
            className="text-[#1B5E4B] hover:text-[#144839] font-medium inline-flex items-center gap-1.5"
          >
            <ShieldCheck className="w-3.5 h-3.5" strokeWidth={1.5} />
            Đăng nhập SuperAdmin →
          </button>
        </div>
      </div>
    </div>
  );
};
